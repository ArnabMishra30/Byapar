import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, subtract, toDecimal, toMoneyString } from '../../utils/money.js';
import * as accountRepository from './account.repository.js';
import * as journalRepository from './journal.repository.js';
import { systemAccountRows, SYSTEM_ACCOUNT_PARENTS } from './system-accounts.js';
import { deriveAccountBalance, normalBalanceSide } from './journal.service.js';

// Chart of accounts business rules. No Prisma calls here.
//
// WHAT IS PROTECTED, AND WHY
//   code      never changes, on any account. It is the stable key the posting
//             engine resolves system accounts by, and the thing a bookkeeper
//             recognises an account from in old reports.
//   type      never changes. Changing it would silently flip the sign of every
//             balance ever computed from the account's existing entries.
//   isSystem  set by the seeder only. A system account can be renamed and
//             re-parented, but never deleted and never deactivated - a document
//             flow depends on it being postable.
//
// Deactivating a normal account stops NEW postings to it. Its history stays
// fully readable: the ledger, the trial balance and every report still include
// it, because hiding posted entries would make the books stop balancing.

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toPublicAccount(account) {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    normalBalance: normalBalanceSide(account.type),
    parent: account.parent
      ? { id: account.parent.id, code: account.parent.code, name: account.parent.name }
      : null,
    parentId: account.parentId ?? null,
    isSystem: account.isSystem,
    isActive: account.isActive,
    description: account.description ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

// --- seeding ---------------------------------------------------------------

/**
 * Gives a company its system accounts. Idempotent: an account that already
 * exists is skipped, never overwritten, so a company that has renamed "Bank"
 * keeps its name.
 *
 * @param {string} companyId
 * @param {import('@prisma/client').PrismaClient} [client] pass a transaction client to join it
 */
export async function initializeSystemAccounts(companyId, client) {
  await accountRepository.createMany(systemAccountRows(companyId), client);
  // The GST accounts hang under the aggregate tax accounts, so a company's chart
  // reads as a tree. Done second because a parent must exist first.
  await accountRepository.linkParentsByCode(companyId, SYSTEM_ACCOUNT_PARENTS, client);
}

// --- validation ------------------------------------------------------------

async function loadOwnAccount(companyId, id) {
  const account = await accountRepository.findByIdAndCompany(id, companyId);
  // Another company's account is reported exactly like a non-existent one.
  if (!account) throw ApiError.business(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  return account;
}

/**
 * A parent must exist in THIS company, and attaching to it must not create a
 * cycle. The cycle check walks the parent chain in the database, so a chain of
 * any depth is rejected - not just a direct A -> B -> A.
 */
async function assertParentUsable(companyId, parentId, childId) {
  if (!parentId) return;

  const parent = await accountRepository.findByIdAndCompany(parentId, companyId);
  if (!parent) {
    // A parent in another company is not "forbidden", it does not exist here.
    throw ApiError.business(404, 'ACCOUNT_PARENT_NOT_FOUND', 'Parent account not found');
  }
  if (childId && parent.id === childId) {
    throw ApiError.business(422, 'ACCOUNT_CIRCULAR_PARENT', 'An account cannot be its own parent');
  }

  if (childId) {
    const chain = await accountRepository.findParentChainIds(companyId, parentId);
    if (chain.some((row) => row.id === childId)) {
      throw ApiError.business(
        422,
        'ACCOUNT_CIRCULAR_PARENT',
        'That parent is below this account, which would create a circular hierarchy',
      );
    }
  }
}

async function assertCodeFree(companyId, code) {
  const existing = await accountRepository.findByCodeAndCompany(code, companyId);
  if (existing) {
    throw ApiError.business(409, 'ACCOUNT_CODE_TAKEN', `Account code ${code} is already in use`);
  }
}

// --- writes ----------------------------------------------------------------

export async function create(currentUser, input) {
  const { companyId } = currentUser;

  await assertCodeFree(companyId, input.code);
  await assertParentUsable(companyId, input.parentId ?? null, null);

  const account = await accountRepository.create({
    companyId,
    code: input.code,
    name: input.name,
    type: input.type,
    parentId: input.parentId ?? null,
    description: input.description ?? null,
    // Only the seeder creates system accounts. A client can never claim one.
    isSystem: false,
    isActive: input.isActive ?? true,
  });

  return toPublicAccount(account);
}

/** Name, description, parent and active flag. Never code, never type. */
export async function update(currentUser, id, input) {
  const { companyId } = currentUser;
  const existing = await loadOwnAccount(companyId, id);

  if (input.parentId !== undefined) {
    await assertParentUsable(companyId, input.parentId, id);
  }

  if (input.isActive === false && existing.isSystem) {
    throw ApiError.business(
      422,
      'ACCOUNT_SYSTEM_PROTECTED',
      `${existing.code} ${existing.name} is a system account and cannot be deactivated`,
    );
  }

  const data = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.parentId !== undefined) data.parentId = input.parentId;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const account = await accountRepository.update(id, companyId, data);
  if (!account) throw ApiError.business(404, 'ACCOUNT_NOT_FOUND', 'Account not found');

  return toPublicAccount(account);
}

/**
 * Physical delete, allowed only for an account nothing depends on.
 *
 * A system account is never deletable. A normal account that has ever been
 * posted to is never deletable either - deleting it would orphan history that
 * the trial balance still has to explain. Deactivate it instead.
 */
export async function remove(currentUser, id) {
  const { companyId } = currentUser;
  const existing = await loadOwnAccount(companyId, id);

  if (existing.isSystem) {
    throw ApiError.business(
      422,
      'ACCOUNT_SYSTEM_PROTECTED',
      `${existing.code} ${existing.name} is a system account and cannot be deleted`,
    );
  }

  const [lineCount, childCount] = await Promise.all([
    accountRepository.countJournalLines(id, companyId),
    accountRepository.countChildren(id, companyId),
  ]);

  if (lineCount > 0) {
    throw ApiError.business(
      422,
      'ACCOUNT_IN_USE',
      'This account has journal entries and cannot be deleted. Deactivate it instead.',
    );
  }
  if (childCount > 0) {
    throw ApiError.business(
      422,
      'ACCOUNT_HAS_CHILDREN',
      'This account has child accounts and cannot be deleted',
    );
  }

  await accountRepository.deleteById(id, companyId);
  return { id, deleted: true };
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await accountRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    accounts: items.map(toPublicAccount),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const account = await loadOwnAccount(currentUser.companyId, id);

  const [totals] = await journalRepository.sumLinesGroupedByAccount(currentUser.companyId, {
    accountId: id,
  });

  const debitTotal = totals?._sum.debit ?? toDecimal(0);
  const creditTotal = totals?._sum.credit ?? toDecimal(0);

  return {
    ...toPublicAccount(account),
    // Derived from the journal every time. There is no balance column.
    debitTotal: toMoneyString(debitTotal, 2),
    creditTotal: toMoneyString(creditTotal, 2),
    balance: toMoneyString(deriveAccountBalance(account.type, debitTotal, creditTotal), 2),
  };
}

/**
 * One account's ledger: every posted line in date order with a running balance
 * in the account's natural direction.
 *
 * `dateFrom` never loses history - everything before it forms the opening
 * balance, exactly like the supplier and customer ledgers.
 */
export async function getLedger(currentUser, id, query = {}) {
  const { companyId } = currentUser;
  const account = await loadOwnAccount(companyId, id);

  let openingBalance = toDecimal(0);
  if (query.dateFrom) {
    const before = await journalRepository.sumLinesBefore(companyId, id, query.dateFrom);
    openingBalance = deriveAccountBalance(
      account.type,
      before._sum.debit ?? 0,
      before._sum.credit ?? 0,
    );
  }

  const { items, total } = await journalRepository.findLines(companyId, {
    skip: query.skip ?? 0,
    take: query.take ?? 500,
    accountId: id,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    sourceType: query.sourceType,
    sourceId: query.sourceId,
  });

  const isDebitNormal = normalBalanceSide(account.type) === 'DEBIT';

  let balance = openingBalance;
  const entries = items.map((row) => {
    const movement = isDebitNormal
      ? subtract(row.debit, row.credit)
      : subtract(row.credit, row.debit);
    balance = add(balance, movement);

    return {
      id: row.id,
      date: toBusinessDate(row.entryDate),
      journalEntryId: row.journalEntry.id,
      journalNumber: row.journalEntry.journalNumber,
      sourceType: row.journalEntry.sourceType,
      sourceId: row.journalEntry.sourceId,
      description: row.description ?? row.journalEntry.description,
      debit: toMoneyString(row.debit, 2),
      credit: toMoneyString(row.credit, 2),
      balance: toMoneyString(balance, 2),
    };
  });

  return {
    account: toPublicAccount(account),
    normalBalance: normalBalanceSide(account.type),
    openingBalance: toMoneyString(openingBalance, 2),
    entries,
    closingBalance: toMoneyString(balance, 2),
    totalEntries: total,
  };
}
