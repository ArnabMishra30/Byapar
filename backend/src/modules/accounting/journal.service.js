import { ApiError } from '../../utils/api-error.js';
import { assertPostingAllowed } from '../periods/period-guard.service.js';
import { assertSubscriptionAllowsPosting } from '../platform/subscription-guard.service.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import {
  add,
  subtract,
  round,
  toDecimal,
  toMoneyString,
  isGreaterThan,
  isZero,
} from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';
import * as journalRepository from './journal.repository.js';
import * as accountRepository from './account.repository.js';
import {
  SYSTEM_ACCOUNT_CODES,
  SYSTEM_ACCOUNT_PARENTS,
  systemAccountRows,
} from './system-accounts.js';

// The double-entry posting engine. No Prisma calls here.
//
// PRECISION POLICY (identical to every other money value in the project):
//   Journal amounts are stored Decimal(18,4) and rounded ONCE, here, as the line
//   is built. Nothing downstream re-rounds. Reports sum already-rounded values,
//   so a report total always equals the sum of its visible lines.
//
// THE FIVE RULES A JOURNAL ENTRY MUST SATISFY (all enforced below, and the first
// three again by CHECK constraints in the database):
//   1. at least two lines
//   2. a line has either a debit or a credit, never both
//   3. neither may be negative
//   4. a zero-value line is not allowed
//   5. total debits == total credits

const MONEY_DP = 4;

export const SOURCE_TYPE = {
  PURCHASE: 'PURCHASE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  SALES_INVOICE: 'SALES_INVOICE',
  SALES_RETURN: 'SALES_RETURN',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  EXPENSE: 'EXPENSE',
  /// A posted expense undone. Unique per expense, which makes reversal idempotent.
  EXPENSE_REVERSAL: 'EXPENSE_REVERSAL',
  REVERSAL: 'REVERSAL',
  /// The one-off entry that establishes a company's books. Stored with the
  /// COMPANY's own id as sourceId, so the existing
  /// @@unique([companyId, sourceType, sourceId]) makes a second initialization
  /// impossible at the database - not merely guarded against in code.
  OPENING_BALANCE: 'OPENING_BALANCE',
};

// --- the sign convention ---------------------------------------------------

/**
 * A signed balance in the account's own natural direction.
 *
 *   ASSET, EXPENSE              debit - credit
 *   LIABILITY, EQUITY, REVENUE  credit - debit
 *
 * A positive result always means "more of what this account is for". Exported so
 * it can be unit tested without a database.
 */
export function deriveAccountBalance(type, debitTotal, creditTotal) {
  const debit = toDecimal(debitTotal ?? 0);
  const credit = toDecimal(creditTotal ?? 0);

  return type === 'ASSET' || type === 'EXPENSE'
    ? subtract(debit, credit)
    : subtract(credit, debit);
}

/** Which side increases this account. Used by the API responses and the docs. */
export function normalBalanceSide(type) {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

// --- line validation -------------------------------------------------------

/**
 * Rounds, drops nothing, and enforces rules 1-5 above.
 *
 * A line whose debit AND credit are both zero is REJECTED rather than silently
 * dropped: a caller that produced one has a bug, and hiding it would let a
 * lopsided entry through. Callers that legitimately have nothing to post for a
 * component must not build the line at all.
 *
 * @param {Array<{ accountCode?: string, accountId?: string, description?: string,
 *                 debit?: any, credit?: any }>} lines
 */
export function normalizeJournalLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw ApiError.business(
      422,
      'JOURNAL_TOO_FEW_LINES',
      'A journal entry must have at least two lines',
    );
  }

  const normalized = lines.map((line, index) => {
    const debit = round(toDecimal(line.debit ?? 0), MONEY_DP);
    const credit = round(toDecimal(line.credit ?? 0), MONEY_DP);

    if (isGreaterThan(0, debit) || isGreaterThan(0, credit)) {
      throw ApiError.business(
        422,
        'JOURNAL_NEGATIVE_AMOUNT',
        `Journal line ${index + 1}: debit and credit must not be negative`,
      );
    }
    if (!isZero(debit) && !isZero(credit)) {
      throw ApiError.business(
        422,
        'JOURNAL_LINE_BOTH_SIDES',
        `Journal line ${index + 1}: a line may carry a debit or a credit, not both`,
      );
    }
    if (isZero(debit) && isZero(credit)) {
      throw ApiError.business(
        422,
        'JOURNAL_ZERO_LINE',
        `Journal line ${index + 1}: a journal line must have a non-zero amount`,
      );
    }

    return { ...line, lineNumber: index + 1, debit, credit };
  });

  const totalDebit = normalized.reduce((sum, line) => add(sum, line.debit), toDecimal(0));
  const totalCredit = normalized.reduce((sum, line) => add(sum, line.credit), toDecimal(0));

  if (!subtract(totalDebit, totalCredit).isZero()) {
    throw ApiError.business(
      422,
      'JOURNAL_UNBALANCED',
      `Journal entry is unbalanced: debits ${toMoneyString(totalDebit, 2)}, credits ${toMoneyString(totalCredit, 2)}`,
    );
  }

  return { lines: normalized, totalDebit, totalCredit };
}

// --- account resolution ----------------------------------------------------

/**
 * Every system account of a company, keyed by code, creating any that are
 * missing.
 *
 * The insert is `skipDuplicates`, so it is safe to run concurrently and safe to
 * run on a company created before this phase existed - which is exactly why a
 * posting can never fail with "no chart of accounts".
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<Map<string, { id: string, code: string, isActive: boolean }>>}
 */
export async function resolveSystemAccounts(tx, companyId) {
  let accounts = await accountRepository.findManyByCodes(companyId, SYSTEM_ACCOUNT_CODES, tx);

  if (accounts.length < SYSTEM_ACCOUNT_CODES.length) {
    await accountRepository.createMany(systemAccountRows(companyId), tx);
    await accountRepository.linkParentsByCode(companyId, SYSTEM_ACCOUNT_PARENTS, tx);
    accounts = await accountRepository.findManyByCodes(companyId, SYSTEM_ACCOUNT_CODES, tx);
  }

  return new Map(accounts.map((account) => [account.code, account]));
}

// --- writing an entry ------------------------------------------------------

/**
 * Writes one POSTED journal entry inside a transaction the CALLER owns.
 *
 * This is the single entry point every document flow uses. It is always the LAST
 * thing a posting transaction does, after the stock movements and the sub-ledger,
 * which gives every posting the same lock order and makes a deadlock between two
 * different document types impossible.
 *
 * If anything here throws, the caller's transaction rolls back - the document
 * stays a draft, the stock never moved and the sub-ledger never changed.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: string, companyId: string }} currentUser
 * @param {{ entryDate: Date, description: string, sourceType: string, sourceId: string,
 *           lines: Array<{ accountCode: string, description?: string, debit?: any, credit?: any }> }} input
 */
export async function createPostedEntryWithinTransaction(tx, currentUser, input) {
  const { companyId } = currentUser;

  // A zero-value document (everything discounted away, nothing costed) has no
  // accounting effect at all. Recording an empty entry would be worse than
  // recording none: it would claim an effect that does not exist.
  if (!input.lines || input.lines.length === 0) return null;

  const { lines, totalDebit, totalCredit } = normalizeJournalLines(input.lines);

  // THE ACCOUNTING PERIOD GUARD.
  //
  // Every posted document in this system reaches this function, and reaches it
  // last, inside its own transaction. Refusing here refuses the whole posting:
  // the stock never moved, the sub-ledger never changed, the document stays a
  // draft. One check, every path, no route able to slip past it.
  await assertPostingAllowed(
    tx,
    companyId,
    input.entryDate,
    input.description ?? 'This document',
  );

  // THE SUBSCRIPTION GUARD, in the same place and for the same reason.
  //
  // A shop whose plan has run out may still read every page of its books; what
  // it may not do is record new business. This is the one function that decides
  // that, because this is the one function every posting reaches.
  await assertSubscriptionAllowsPosting(tx, companyId, input.description ?? 'This document');

  const accounts = await resolveSystemAccounts(tx, companyId);

  // A line may name its account by stable system CODE - which is how every
  // document flow with fixed accounts does it - or by ID, which is what an
  // expense needs: its category may be an account the business created itself
  // and so has no system code. Ids are loaded company-scoped, so a line can
  // never reach into another company's chart.
  const explicitIds = [...new Set(lines.map((line) => line.accountId).filter(Boolean))];
  const byId = new Map(
    explicitIds.length === 0
      ? []
      : (await accountRepository.findManyByIds(companyId, explicitIds, tx)).map((account) => [
          account.id,
          account,
        ]),
  );

  const resolved = lines.map((line) => {
    const account = line.accountId ? byId.get(line.accountId) : accounts.get(line.accountCode);

    // For a code this is unreachable - resolveSystemAccounts recreates anything
    // missing. For an id it means the account does not belong to this company.
    if (!account) {
      throw ApiError.business(
        422,
        'ACCOUNT_NOT_FOUND',
        line.accountId
          ? 'An account on this entry does not exist in this company'
          : `System account ${line.accountCode} is missing from the chart of accounts`,
      );
    }
    if (!account.isActive) {
      throw ApiError.business(
        422,
        'ACCOUNT_INACTIVE',
        `Account ${account.code} ${account.name} is inactive and cannot be posted to`,
      );
    }

    return {
      companyId,
      accountId: account.id,
      lineNumber: line.lineNumber,
      description: line.description ?? null,
      debit: line.debit,
      credit: line.credit,
      entryDate: input.entryDate,
    };
  });

  const journalNumber = await nextDocumentNumber(tx, {
    companyId,
    documentType: DOCUMENT_TYPE.JOURNAL_ENTRY,
    prefix: 'JV',
    date: input.entryDate,
  });

  return journalRepository.createEntry(tx, {
    entry: {
      companyId,
      journalNumber,
      entryDate: input.entryDate,
      description: input.description ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: 'POSTED',
      totalDebit: round(totalDebit, MONEY_DP),
      totalCredit: round(totalCredit, MONEY_DP),
      reversalOfId: input.reversalOfId ?? null,
      createdById: currentUser.id,
      postedAt: new Date(),
    },
    lines: resolved,
  });
}

// --- reversal --------------------------------------------------------------

/**
 * Reverses a posted entry with a NEW entry that swaps every debit and credit.
 *
 * The original is never touched. Idempotency is structural: the reversal is
 * stored as sourceType REVERSAL with the original entry's id, and
 * (companyId, sourceType, sourceId) is unique - so a second reversal of the same
 * entry cannot exist even if two requests arrive together.
 *
 * This is an accounting correction tool. No document flow uses it: reversing a
 * document's journal without reversing the document itself makes the GL diverge
 * from the sub-ledger on purpose. See docs/architecture.md.
 */
export async function reverse(currentUser, id, input = {}) {
  const { companyId } = currentUser;

  const entry = await withRetryableTransaction(async (tx) => {
    // Locking the original serialises two simultaneous reversals of it.
    const original = await journalRepository.lockEntry(tx, id, companyId);

    if (!original) {
      throw ApiError.business(404, 'JOURNAL_ENTRY_NOT_FOUND', 'Journal entry not found');
    }
    if (original.status !== 'POSTED') {
      throw ApiError.business(
        422,
        'JOURNAL_ENTRY_NOT_POSTED',
        'Only a posted journal entry can be reversed',
      );
    }
    if (original.sourceType === SOURCE_TYPE.REVERSAL) {
      throw ApiError.business(
        422,
        'JOURNAL_ENTRY_IS_REVERSAL',
        'A reversing entry cannot itself be reversed',
      );
    }

    // A reversal is a NEW posting and obeys the period rule like any other. It
    // is dated on the date the caller gives, or the original's date, so a
    // reversal cannot quietly reopen a closed period.
    await assertPostingAllowed(
      tx,
      companyId,
      input.entryDate ?? original.entryDate,
      'This reversal',
    );

    const already = await journalRepository.findBySource(
      companyId,
      SOURCE_TYPE.REVERSAL,
      original.id,
      tx,
    );
    if (already) {
      throw ApiError.business(
        409,
        'JOURNAL_ENTRY_ALREADY_REVERSED',
        `This entry was already reversed by ${already.journalNumber}`,
      );
    }

    return journalRepository.createEntry(tx, {
      entry: {
        companyId,
        journalNumber: await nextDocumentNumber(tx, {
          companyId,
          documentType: DOCUMENT_TYPE.JOURNAL_ENTRY,
          prefix: 'JV',
          // Same date as the original, so the period it belongs to nets to zero.
          date: original.entryDate,
        }),
        entryDate: original.entryDate,
        description:
          input.description ?? `Reversal of ${original.journalNumber}: ${original.description ?? ''}`.trim(),
        sourceType: SOURCE_TYPE.REVERSAL,
        sourceId: original.id,
        status: 'POSTED',
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        reversalOfId: original.id,
        createdById: currentUser.id,
        postedAt: new Date(),
      },
      // Debit and credit swapped; the account, the date and the order are kept.
      lines: original.lines.map((line) => ({
        companyId,
        accountId: line.accountId,
        lineNumber: line.lineNumber,
        description: line.description,
        debit: line.credit,
        credit: line.debit,
        entryDate: original.entryDate,
      })),
    });
  });

  return toPublicEntry(entry);
}

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toPublicLine(line) {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    account: line.account
      ? {
          id: line.account.id,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
        }
      : { id: line.accountId },
    description: line.description,
    debit: toMoneyString(line.debit, 2),
    credit: toMoneyString(line.credit, 2),
  };
}

export function toPublicEntry(entry) {
  return {
    id: entry.id,
    journalNumber: entry.journalNumber,
    entryDate: toBusinessDate(entry.entryDate),
    description: entry.description,
    // Follow these two back to the document that explains this entry.
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    status: entry.status,
    totalDebit: toMoneyString(entry.totalDebit, 2),
    totalCredit: toMoneyString(entry.totalCredit, 2),
    isBalanced: subtract(entry.totalDebit, entry.totalCredit).isZero(),
    reversalOf: entry.reversalOf
      ? { id: entry.reversalOf.id, journalNumber: entry.reversalOf.journalNumber }
      : null,
    reversedBy:
      entry.reversedBy && entry.reversedBy.length > 0
        ? { id: entry.reversedBy[0].id, journalNumber: entry.reversedBy[0].journalNumber }
        : null,
    lines: entry.lines ? entry.lines.map(toPublicLine) : undefined,
    createdBy: entry.createdBy ? { id: entry.createdBy.id, name: entry.createdBy.name } : null,
    postedAt: entry.postedAt,
    createdAt: entry.createdAt,
  };
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await journalRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    journalEntries: items.map(toPublicEntry),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const entry = await journalRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!entry) throw ApiError.business(404, 'JOURNAL_ENTRY_NOT_FOUND', 'Journal entry not found');
  return toPublicEntry(entry);
}

/** "Why does this ledger entry exist?" - answered from the source document. */
export async function getBySource(currentUser, sourceType, sourceId) {
  const entry = await journalRepository.findBySource(currentUser.companyId, sourceType, sourceId);
  if (!entry) {
    throw ApiError.business(404, 'JOURNAL_ENTRY_NOT_FOUND', 'No journal entry for that document');
  }
  return toPublicEntry(entry);
}

/**
 * The general ledger: posted journal lines across every account, newest filters
 * applied, with a running balance in the account's natural direction when a
 * single account is being viewed.
 */
export async function listGeneralLedger(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await journalRepository.findLines(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    entries: items.map((line) => ({
      id: line.id,
      date: toBusinessDate(line.entryDate),
      account: {
        id: line.account.id,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
      },
      journalEntry: {
        id: line.journalEntry.id,
        journalNumber: line.journalEntry.journalNumber,
        description: line.journalEntry.description,
      },
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      description: line.description,
      debit: toMoneyString(line.debit, 2),
      credit: toMoneyString(line.credit, 2),
    })),
    pagination: buildPagination({ page, limit, total }),
  };
}
