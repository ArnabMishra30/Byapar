import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';
import * as accountRepository from '../accounting/account.repository.js';
import * as journalRepository from '../accounting/journal.repository.js';
import { createPostedEntryWithinTransaction, deriveAccountBalance } from '../accounting/journal.service.js';
import * as journalService from '../accounting/journal.service.js';

// MONEY ACCOUNTS: the shop's own places money sits - Cash drawer, SBI current,
// HDFC savings, PhonePe / UPI, the owner's pocket.
//
// Each one IS an account in the general ledger: an ASSET under the system Cash
// (1000) or Bank (1010) account. That is why the Cash & Bank report, the
// dashboard and every statement already see them, and why a balance is always
// read from the ledger, never kept anywhere else.
//
//   expense paid / supplier paid   Cr that account
//   customer money received        Dr that account
//   transfer between two accounts  Dr to, Cr from   (sourceType MONEY_TRANSFER)
//   opening balance                Dr account, Cr Owner's Capital
//
// The system Cash and Bank accounts themselves are the first two money
// accounts, so every older payment and expense stays exactly where it was.

const DETAIL_KEYS = ['bankName', 'accountNumber', 'ifsc', 'upiId', 'holderName'];

/** Only the reference fields that were sent; blank clears one. */
function cleanDetails(input = {}) {
  const out = {};
  for (const key of DETAIL_KEYS) {
    if (input[key] !== undefined) out[key] = input[key] === '' ? null : input[key];
  }
  return out;
}

export const SOURCE = {
  TRANSFER: 'MONEY_TRANSFER',
  OPENING: 'MONEY_ACCOUNT_OPENING',
};

const money = (value) => toMoneyString(value ?? 0, 2);

async function allMoneyAccounts(companyId, client = prisma) {
  const accounts = await accountRepository.findCashAndBankAccounts(
    companyId,
    [SYSTEM_ACCOUNT.CASH, SYSTEM_ACCOUNT.BANK],
    client,
  );
  const roots = new Map(accounts.filter((a) => !a.parentId).map((a) => [a.id, a]));
  return accounts.map((account) => {
    const root = account.parentId ? roots.get(account.parentId) : account;
    return { ...account, kind: root?.code === SYSTEM_ACCOUNT.CASH ? 'CASH' : 'BANK' };
  });
}

/** "••••4521": enough to recognise the account, not enough to misuse it. */
export function maskAccountNumber(value) {
  if (!value) return null;
  const digits = String(value);
  return digits.length <= 4 ? digits : `••••${digits.slice(-4)}`;
}

/** The reference details; the full account number only for the owner. */
function details(account, showFull) {
  return {
    bankName: account.bankName ?? null,
    accountNumber: showFull ? account.accountNumber ?? null : maskAccountNumber(account.accountNumber),
    accountNumberMasked: maskAccountNumber(account.accountNumber),
    ifsc: account.ifsc ?? null,
    upiId: account.upiId ?? null,
    holderName: account.holderName ?? null,
  };
}

function toPublic(account, balances, showFull = false) {
  const row = balances.find((entry) => entry.accountId === account.id);
  const balance = deriveAccountBalance('ASSET', row?._sum.debit ?? 0, row?._sum.credit ?? 0);
  return {
    id: account.id,
    name: account.name,
    code: account.code,
    kind: account.kind,
    isSystem: Boolean(account.isSystem),
    isActive: account.isActive,
    balance: money(balance),
    ...details(account, showFull),
  };
}

/** Every money account with its balance, straight from the ledger. */
export async function list(currentUser, { activeOnly = false } = {}) {
  const { companyId } = currentUser;
  const [accounts, balances] = await Promise.all([
    allMoneyAccounts(companyId),
    journalRepository.sumLinesGroupedByAccount(companyId, {}),
  ]);
  return accounts
    .filter((account) => !activeOnly || account.isActive)
    .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'CASH' ? -1 : 1))
    .map((account) => toPublic(account, balances, currentUser.role === 'ADMIN'));
}

/**
 * The account to pay from / receive into, checked: this company's, one of its
 * money accounts, and switched on. Anything else - another company's id, a
 * revenue account - gets the same refusal.
 */
export async function assertMoneyAccount(companyId, accountId, client = prisma) {
  const accounts = await allMoneyAccounts(companyId, client);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    throw ApiError.badRequest('Account not found', [
      { field: 'body.moneyAccountId', message: 'Choose one of your cash / bank accounts' },
    ]);
  }
  if (!account.isActive) {
    throw ApiError.business(422, 'MONEY_ACCOUNT_INACTIVE', `"${account.name}" is switched off`);
  }
  return account;
}

/** The next free code under a root: 1000-01, 1000-02... / 1010-01, ... */
async function nextCode(tx, companyId, rootCode) {
  const existing = await tx.account.findMany({
    where: { companyId, code: { startsWith: `${rootCode}-` } },
    select: { code: true },
  });
  const used = new Set(existing.map((a) => Number(a.code.split('-')[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  return `${rootCode}-${String(n).padStart(2, '0')}`;
}

export async function create(currentUser, { name, kind, openingBalance, openingDate, ...reference }) {
  const { companyId } = currentUser;
  const rootCode = kind === 'CASH' ? SYSTEM_ACCOUNT.CASH : SYSTEM_ACCOUNT.BANK;

  const id = await withRetryableTransaction(async (tx) => {
    const root = await tx.account.findFirst({ where: { companyId, code: rootCode } });
    if (!root) throw ApiError.business(422, 'CHART_INCOMPLETE', 'The Cash / Bank account is missing');
    const clash = await tx.account.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw ApiError.business(409, 'MONEY_ACCOUNT_NAME_TAKEN', `An account called "${name}" already exists`);

    const account = await tx.account.create({
      data: {
        companyId,
        code: await nextCode(tx, companyId, rootCode),
        name,
        type: 'ASSET',
        parentId: root.id,
        description: kind === 'CASH' ? 'Cash kept by the shop' : 'Bank account or wallet',
        ...cleanDetails(reference),
      },
      select: { id: true },
    });

    // What is in it on day one: brought in against Owner's Capital, the same
    // way the opening-balances screen brings in cash and bank.
    if (openingBalance && isGreaterThan(openingBalance, 0)) {
      await createPostedEntryWithinTransaction(tx, currentUser, {
        entryDate: openingDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        description: `Opening balance - ${name}`,
        sourceType: SOURCE.OPENING,
        sourceId: account.id,
        lines: [
          { accountId: account.id, debit: openingBalance, description: `Opening balance - ${name}` },
          { accountCode: SYSTEM_ACCOUNT.OWNERS_CAPITAL, credit: openingBalance, description: `Opening balance - ${name}` },
        ],
      });
    }
    return account.id;
  });

  return (await list(currentUser)).find((a) => a.id === id);
}

/** Rename, or switch off / on. History and balance are untouched. */
export async function update(currentUser, id, { name, isActive, ...reference }) {
  const { companyId } = currentUser;
  const account = (await allMoneyAccounts(companyId)).find((a) => a.id === id);
  if (!account) throw ApiError.business(404, 'MONEY_ACCOUNT_NOT_FOUND', 'Account not found');
  if (isActive === false && account.isSystem) {
    throw ApiError.business(422, 'SYSTEM_ACCOUNT', 'The main Cash and Bank accounts cannot be switched off. Rename them instead.');
  }
  if (name) {
    const clash = await prisma.account.findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' }, NOT: { id } },
      select: { id: true },
    });
    if (clash) throw ApiError.business(409, 'MONEY_ACCOUNT_NAME_TAKEN', `An account called "${name}" already exists`);
  }
  await prisma.account.updateMany({
    where: { id, companyId },
    data: {
      ...(name ? { name } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
      ...cleanDetails(reference),
    },
  });
  return (await list(currentUser)).find((a) => a.id === id);
}

// --- transfers between the shop's own accounts ----------------------------------

/**
 * Cash into the bank, wallet to bank... One balanced journal entry.
 *
 * IDEMPOTENCY (QA finding M2): a client may pass `idempotencyKey` - a UUID
 * generated once for a submit attempt and re-sent on every retry/double-click.
 * It becomes the journal entry's sourceId, so the (companyId, sourceType,
 * sourceId) unique index guarantees at most ONE transfer per key: a repeated
 * request returns the transfer that was already recorded rather than creating a
 * second one. We deliberately do NOT derive the key from the amount/accounts/
 * date, because two genuinely-separate transfers can be identical and must both
 * go through. Without a key the historical behaviour (a fresh id, no dedup) is
 * preserved, so existing callers are unaffected.
 */
export async function transfer(
  currentUser,
  { fromAccountId, toAccountId, amount, date, notes, idempotencyKey },
) {
  const { companyId } = currentUser;
  if (fromAccountId === toAccountId) {
    throw ApiError.badRequest('Choose two different accounts', [{ field: 'body.toAccountId', message: 'Same as "from"' }]);
  }

  const sourceId = idempotencyKey ?? randomUUID();

  // Fast path: this key already produced a transfer, so return it unchanged.
  if (idempotencyKey) {
    const existing = await findTransferBySource(companyId, sourceId);
    if (existing) return toPublicTransfer(existing);
  }

  let entry;
  try {
    entry = await withRetryableTransaction(async (tx) => {
      // Re-check inside the transaction: if two requests with the same key race,
      // the first commits and the second - retried by the wrapper after the
      // unique-constraint rollback - finds the winner here and reuses it instead
      // of inserting a duplicate.
      if (idempotencyKey) {
        const existing = await findTransferBySource(companyId, sourceId, tx);
        if (existing) return existing;
      }

      const [from, to] = await Promise.all([
        assertMoneyAccount(companyId, fromAccountId, tx),
        assertMoneyAccount(companyId, toAccountId, tx),
      ]);
      const description = `Transfer: ${from.name} → ${to.name}${notes ? ` - ${notes}` : ''}`;
      return createPostedEntryWithinTransaction(tx, currentUser, {
        entryDate: date,
        description,
        sourceType: SOURCE.TRANSFER,
        sourceId,
        lines: [
          { accountId: to.id, debit: amount, description },
          { accountId: from.id, credit: amount, description },
        ],
      });
    });
  } catch (err) {
    // Belt and suspenders: if a race still surfaced the unique violation after
    // the retries were spent, the winner's transfer is on record - return it.
    if (idempotencyKey) {
      const existing = await findTransferBySource(companyId, sourceId);
      if (existing) return toPublicTransfer(existing);
    }
    throw err;
  }

  return toPublicTransfer(await prisma.journalEntry.findUnique({ where: { id: entry.id }, select: TRANSFER_FIELDS }));
}

const TRANSFER_FIELDS = {
  id: true,
  journalNumber: true,
  entryDate: true,
  description: true,
  createdAt: true,
  lines: { select: { debit: true, credit: true, account: { select: { id: true, name: true } } } },
  reversedBy: { select: { id: true } },
};

/**
 * A previously-recorded transfer that carried this idempotency key, if any.
 * The (companyId, sourceType, sourceId) unique index makes this a point lookup.
 */
async function findTransferBySource(companyId, sourceId, client = prisma) {
  return client.journalEntry.findUnique({
    where: {
      companyId_sourceType_sourceId: { companyId, sourceType: SOURCE.TRANSFER, sourceId },
    },
    select: TRANSFER_FIELDS,
  });
}

function toPublicTransfer(entry) {
  const to = entry.lines.find((l) => isGreaterThan(l.debit, 0));
  const from = entry.lines.find((l) => isGreaterThan(l.credit, 0));
  return {
    id: entry.id,
    number: entry.journalNumber,
    date: entry.entryDate.toISOString().slice(0, 10),
    from: from?.account ?? null,
    to: to?.account ?? null,
    amount: money(to?.debit ?? toDecimal(0)),
    description: entry.description,
    isReversed: Boolean(entry.reversedBy && entry.reversedBy.length !== 0),
  };
}

export async function listTransfers(currentUser) {
  const entries = await prisma.journalEntry.findMany({
    where: { companyId: currentUser.companyId, sourceType: SOURCE.TRANSFER },
    select: TRANSFER_FIELDS,
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return entries.map(toPublicTransfer);
}

/** Undo a transfer: the ordinary journal reversal (a new, opposite entry). */
export async function reverseTransfer(currentUser, id) {
  const entry = await prisma.journalEntry.findFirst({
    where: { id, companyId: currentUser.companyId, sourceType: SOURCE.TRANSFER },
    select: { id: true },
  });
  if (!entry) throw ApiError.business(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
  await journalService.reverse(currentUser, id, { reason: 'Transfer undone' });
  return { reversed: true };
}
