import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { round, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as expenseRepository from './expense.repository.js';
import * as accountRepository from '../accounting/account.repository.js';
import * as journalRepository from '../accounting/journal.repository.js';
import * as supplierRepository from '../suppliers/supplier.repository.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import { SYSTEM_ACCOUNT, NON_CATEGORY_EXPENSE_CODES } from '../accounting/system-accounts.js';
import { SOURCE_TYPE } from '../accounting/journal.service.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';

// Expense business rules. No Prisma calls here.
//
// THE CENTRAL RULE, the same one every document in this system follows:
//   Creating or editing an expense NEVER touches the ledger or the bank balance.
//   Only posting does, and posting happens in ONE transaction covering the status
//   change and the journal entry.
//
// A CATEGORY IS AN ACCOUNT. `expenseAccountId` is an EXPENSE account in the
// company's own chart. There is no category table and no name matching in the
// posting logic, which is why the expense report, the profit and loss and the
// general ledger are always the same number.
//
// GST IS NOT INVOLVED. Nothing here reads a GSTIN, a place of supply or a tax
// rate. A shop with no registration records rent exactly as a registered company
// does. Input tax credit on expenses is a future GST enhancement - see the
// limitations in docs/architecture.md.

const MONEY_DP = 4;

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toPublicExpense(expense) {
  return {
    id: expense.id,
    expenseNumber: expense.expenseNumber,
    expenseDate: toBusinessDate(expense.expenseDate),
    status: expense.status,
    amount: toMoneyString(expense.amount, 2),
    description: expense.description,

    category: {
      accountId: expense.expenseAccount.id,
      code: expense.expenseAccount.code,
      // The snapshot, so renaming an account does not rewrite an old expense.
      name: expense.categoryNameSnapshot,
      currentName: expense.expenseAccount.name,
    },

    paymentMode: expense.paymentMode,
    paidFrom: {
      accountId: expense.paymentAccount.id,
      code: expense.paymentAccount.code,
      name: expense.paymentAccountNameSnapshot,
      currentName: expense.paymentAccount.name,
    },

    // Informational only: an expense raises no payable.
    supplier: expense.supplier
      ? { id: expense.supplier.id, name: expense.supplierNameSnapshot }
      : null,

    referenceNumber: expense.referenceNumber,
    notes: expense.notes,

    // Only a POSTED expense has an accounting effect.
    affectsAccounts: expense.status === 'POSTED',

    createdBy: expense.createdBy ? { id: expense.createdBy.id, name: expense.createdBy.name } : null,
    postedBy: expense.postedBy ? { id: expense.postedBy.id, name: expense.postedBy.name } : null,
    postedAt: expense.postedAt,
    cancelledBy: expense.cancelledBy
      ? { id: expense.cancelledBy.id, name: expense.cancelledBy.name }
      : null,
    cancelledAt: expense.cancelledAt,
    reversedBy: expense.reversedBy
      ? { id: expense.reversedBy.id, name: expense.reversedBy.name }
      : null,
    reversedAt: expense.reversedAt,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

// --- validation ------------------------------------------------------------

/**
 * The category must be an EXPENSE account of THIS company, active, and not one
 * of the accounts another document flow maintains.
 *
 * Cost of Goods Sold is the one that matters: posting rent to it would silently
 * corrupt gross profit, and gross profit is the number a shopkeeper trusts most.
 */
async function loadCategoryAccount(companyId, expenseAccountId) {
  const account = await accountRepository.findByIdAndCompany(expenseAccountId, companyId);

  // Another company's account is reported exactly like a non-existent one.
  if (!account) {
    throw ApiError.business(404, 'EXPENSE_CATEGORY_NOT_FOUND', 'Expense category not found');
  }
  if (account.type !== 'EXPENSE') {
    throw ApiError.business(
      422,
      'INVALID_EXPENSE_CATEGORY',
      `${account.code} ${account.name} is a ${account.type} account. An expense category must be an EXPENSE account.`,
    );
  }
  if (NON_CATEGORY_EXPENSE_CODES.includes(account.code)) {
    throw ApiError.business(
      422,
      'INVALID_EXPENSE_CATEGORY',
      `${account.code} ${account.name} is maintained by another part of the system and cannot be used as an expense category`,
    );
  }
  if (!account.isActive) {
    throw ApiError.business(
      422,
      'EXPENSE_CATEGORY_INACTIVE',
      `Category "${account.name}" is inactive`,
    );
  }

  return account;
}

/**
 * Where the money left from.
 *
 * The payment mode picks the system Cash or Bank account, exactly as supplier and
 * customer payments do. A business with a second bank account may name one
 * explicitly, and it must be an active ASSET account of this company.
 */
async function loadPaymentAccount(companyId, { paymentMode, paymentAccountId }) {
  if (paymentAccountId) {
    const account = await accountRepository.findByIdAndCompany(paymentAccountId, companyId);

    if (!account) {
      throw ApiError.business(404, 'PAYMENT_ACCOUNT_NOT_FOUND', 'Payment account not found');
    }
    if (account.type !== 'ASSET') {
      throw ApiError.business(
        422,
        'INVALID_PAYMENT_ACCOUNT',
        `${account.code} ${account.name} is a ${account.type} account. Money can only be paid out of an ASSET account.`,
      );
    }
    if (!account.isActive) {
      throw ApiError.business(
        422,
        'PAYMENT_ACCOUNT_INACTIVE',
        `Payment account "${account.name}" is inactive`,
      );
    }

    return account;
  }

  const code = paymentMode === 'CASH' ? SYSTEM_ACCOUNT.CASH : SYSTEM_ACCOUNT.BANK;
  const account = await accountRepository.findByCodeAndCompany(code, companyId);

  // Unreachable: the system chart is seeded for every company and its accounts
  // cannot be deleted. Fail loudly rather than post to nowhere.
  if (!account) {
    throw ApiError.business(
      422,
      'PAYMENT_ACCOUNT_NOT_FOUND',
      `The ${paymentMode === 'CASH' ? 'Cash' : 'Bank'} account is missing from the chart of accounts`,
    );
  }
  if (!account.isActive) {
    throw ApiError.business(
      422,
      'PAYMENT_ACCOUNT_INACTIVE',
      `Account ${account.code} ${account.name} is inactive and cannot be paid from`,
    );
  }

  return account;
}

/** A vendor is optional and purely informational, but must be ours. */
async function loadSupplier(companyId, supplierId) {
  if (!supplierId) return null;

  const supplier = await supplierRepository.findByIdAndCompany(supplierId, companyId);
  if (!supplier) throw ApiError.business(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  if (!supplier.isActive) {
    throw ApiError.business(422, 'SUPPLIER_INACTIVE', `Supplier "${supplier.name}" is inactive`);
  }

  return supplier;
}

/** Loads and checks everything an expense refers to, in one place. */
async function loadAndValidateReferences(companyId, input) {
  const [category, paymentAccount, supplier] = await Promise.all([
    loadCategoryAccount(companyId, input.expenseAccountId),
    loadPaymentAccount(companyId, input),
    loadSupplier(companyId, input.supplierId),
  ]);

  if (!isGreaterThan(input.amount, 0)) {
    throw ApiError.business(422, 'INVALID_EXPENSE_AMOUNT', 'An expense amount must be more than zero');
  }

  return { category, paymentAccount, supplier };
}

function assertIsDraft(expense) {
  if (expense.status === 'POSTED') {
    throw ApiError.business(
      409,
      'EXPENSE_ALREADY_POSTED',
      'A posted expense is a historical record and cannot be changed',
    );
  }
  if (expense.status !== 'DRAFT') {
    throw ApiError.business(
      409,
      'EXPENSE_NOT_DRAFT',
      `This expense is ${expense.status.toLowerCase()}`,
    );
  }
}

/** The row fields an expense stores, shared by create and edit. */
function toRow(input, { category, paymentAccount, supplier }) {
  return {
    expenseDate: input.expenseDate,
    expenseAccountId: category.id,
    categoryNameSnapshot: category.name,
    description: input.description ?? null,
    amount: round(input.amount, MONEY_DP),
    paymentMode: input.paymentMode,
    paymentAccountId: paymentAccount.id,
    paymentAccountNameSnapshot: paymentAccount.name,
    supplierId: supplier ? supplier.id : null,
    supplierNameSnapshot: supplier ? supplier.name : null,
    referenceNumber: input.referenceNumber ?? null,
    notes: input.notes ?? null,
  };
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT. Deliberately has no ledger and no cash effect. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;
  const references = await loadAndValidateReferences(companyId, input);

  const expense = await withRetryableTransaction(async (tx) => {
    const expenseNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.EXPENSE,
      prefix: 'EXP',
      date: input.expenseDate,
    });

    return expenseRepository.createDraft(tx, {
      companyId,
      expenseNumber,
      status: 'DRAFT',
      createdById: currentUser.id,
      ...toRow(input, references),
    });
  });

  return toPublicExpense(expense);
}

/** Replaces a draft. Only DRAFT expenses can be edited. */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await expenseRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  assertIsDraft(existing);

  const references = await loadAndValidateReferences(companyId, input);

  const expense = await withRetryableTransaction(async (tx) =>
    expenseRepository.updateDraft(tx, { id, companyId, data: toRow(input, references) }),
  );

  // updateDraft only matches rows still in DRAFT, so null means it was posted or
  // cancelled between our read and our write.
  if (!expense) {
    throw ApiError.business(409, 'EXPENSE_NOT_DRAFT', 'Only a draft expense can be edited');
  }

  return toPublicExpense(expense);
}

/**
 * Posts the expense: the one place it affects the books.
 *
 * One transaction covers the status change and the journal entry. If the journal
 * fails - an inactive account, a broken chart - the expense stays a draft and no
 * money is recorded as having left.
 *
 * The row is locked first, so two simultaneous posts serialise and the second
 * sees POSTED. Even if that guard were bypassed, the journal's unique constraint
 * on (companyId, sourceType, sourceId) makes a second entry impossible.
 */
export async function post(currentUser, id) {
  const { companyId } = currentUser;

  const expense = await withRetryableTransaction(async (tx) => {
    const locked = await expenseRepository.lockForPosting(tx, id, companyId);

    if (!locked) throw ApiError.business(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
    if (locked.status === 'POSTED') {
      throw ApiError.business(409, 'EXPENSE_ALREADY_POSTED', 'This expense has already been posted');
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(409, 'EXPENSE_NOT_DRAFT', 'Only a draft expense can be posted');
    }

    // The category and the payment account may have been deactivated since the
    // draft was written.
    await loadCategoryAccount(companyId, locked.expenseAccountId);
    await loadPaymentAccount(companyId, { paymentAccountId: locked.paymentAccountId });

    // The general ledger entry, in this same transaction.
    await glPostingService.recordExpensePosted(tx, currentUser, locked);

    const updated = await expenseRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'POSTED', postedById: currentUser.id, postedAt: new Date() },
    });

    if (!updated) {
      throw ApiError.business(409, 'EXPENSE_NOT_DRAFT', 'Only a draft expense can be posted');
    }

    return updated;
  });

  return toPublicExpense(expense);
}

/**
 * Cancels a DRAFT.
 *
 * A posted expense cannot be cancelled: money left the business and the ledger
 * says so. Undoing it is a reversal, which is a new entry rather than a deletion.
 */
export async function cancel(currentUser, id) {
  const { companyId } = currentUser;

  const existing = await expenseRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'EXPENSE_NOT_FOUND', 'Expense not found');

  if (existing.status === 'POSTED') {
    throw ApiError.business(
      409,
      'EXPENSE_ALREADY_POSTED',
      'A posted expense cannot be cancelled. Reverse it instead.',
    );
  }
  assertIsDraft(existing);

  const expense = await withRetryableTransaction(async (tx) =>
    expenseRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!expense) {
    throw ApiError.business(409, 'EXPENSE_NOT_DRAFT', 'Only a draft expense can be cancelled');
  }

  return toPublicExpense(expense);
}

/**
 * Reverses a POSTED expense.
 *
 * The original expense and its journal entry are never touched. A new entry swaps
 * the two sides, so the category and the bank balance both return to where they
 * were, and both postings stay visible in the ledger.
 *
 * This exists because an expense has no "return" document: a mistyped amount
 * would otherwise be permanently wrong with no remedy.
 *
 * Idempotent by construction: the reversal is stored as sourceType
 * EXPENSE_REVERSAL with the expense's own id, and that pair is unique.
 */
export async function reverse(currentUser, id) {
  const { companyId } = currentUser;

  const expense = await withRetryableTransaction(async (tx) => {
    const locked = await expenseRepository.lockForPosting(tx, id, companyId);

    if (!locked) throw ApiError.business(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
    if (locked.status === 'REVERSED') {
      throw ApiError.business(
        409,
        'EXPENSE_ALREADY_REVERSED',
        'This expense has already been reversed',
      );
    }
    if (locked.status !== 'POSTED') {
      throw ApiError.business(
        409,
        'EXPENSE_NOT_POSTED',
        'Only a posted expense can be reversed',
      );
    }

    const original = await journalRepository.findBySource(
      companyId,
      SOURCE_TYPE.EXPENSE,
      locked.id,
      tx,
    );

    await glPostingService.recordExpenseReversed(tx, currentUser, locked, original);

    const updated = await expenseRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'POSTED',
      data: { status: 'REVERSED', reversedById: currentUser.id, reversedAt: new Date() },
    });

    if (!updated) {
      throw ApiError.business(409, 'EXPENSE_NOT_POSTED', 'Only a posted expense can be reversed');
    }

    return updated;
  });

  return toPublicExpense(expense);
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await expenseRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    expenses: items.map(toPublicExpense),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const expense = await expenseRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!expense) throw ApiError.business(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  return toPublicExpense(expense);
}

/**
 * The categories a user may choose from: every active EXPENSE account except the
 * ones other document flows maintain.
 *
 * A business that wants its own category creates an EXPENSE account through the
 * ordinary chart-of-accounts API, and it appears here at once. There is no
 * separate category master to keep in step.
 */
export async function listCategories(currentUser) {
  const accounts = await accountRepository.findAllByCompany(currentUser.companyId);

  return accounts
    .filter(
      (account) =>
        account.type === 'EXPENSE' &&
        account.isActive &&
        !NON_CATEGORY_EXPENSE_CODES.includes(account.code),
    )
    .map((account) => ({
      accountId: account.id,
      code: account.code,
      name: account.name,
      isSystem: account.isSystem,
    }));
}
