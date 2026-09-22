import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, subtract, round, toDecimal, toMoneyString, isGreaterThan, isZero } from '../../utils/money.js';
import * as customerReceivableRepository from './customer-receivable.repository.js';
import * as customerLedgerRepository from './customer-ledger.repository.js';
import * as customerRepository from '../customers/customer.repository.js';

// The customer sub-ledger - the mirror of the supplier one.
//
// THIS IS NOT DOUBLE-ENTRY ACCOUNTING. It answers one question: what does each
// customer owe us, and against which invoices.
//
// SIGN CONVENTION (from the customer account's side, standard accounting):
//   DEBIT  increases what they owe us -> a sale
//   CREDIT reduces it                 -> a payment (later: a sales return)
//   balance = sum(debit) - sum(credit). Positive means the customer owes us.
// This is the opposite direction to the supplier ledger, and deliberately so:
// a customer is a debtor, a supplier is a creditor.
//
// TWO STRUCTURES, ONE SOURCE OF TRUTH PER QUESTION:
//   "What is this customer's balance?" -> derived from CustomerLedgerEntry.
//   "How much is left on THIS invoice?" -> CustomerReceivable.outstandingAmount,
//                                          maintained in the same transaction.

const MONEY_DP = 4;

export const LEDGER_REFERENCE_TYPE = {
  SALES_INVOICE: 'SALES_INVOICE',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  SALES_RETURN: 'SALES_RETURN',
  /// A balance that existed before the business started using this system.
  /// Not a document: there is no invoice or bill behind it.
  OPENING_BALANCE: 'OPENING_BALANCE',
};

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toPublicReceivable(receivable) {
  return {
    id: receivable.id,
    customer: { id: receivable.customer.id, name: receivable.customer.name },
    // Null on an OPENING BALANCE: money the customer already owed when the
    // business started here, with no sale behind it. `source` says which this
    // is, so a client never has to infer it from a missing object.
    salesInvoice: receivable.salesInvoice
      ? {
          id: receivable.salesInvoice.id,
          invoiceNumber: receivable.salesInvoice.invoiceNumber,
          invoiceDate: toBusinessDate(receivable.salesInvoice.invoiceDate),
          status: receivable.salesInvoice.status,
        }
      : null,
    source: receivable.salesInvoice ? 'SALES_INVOICE' : 'OPENING_BALANCE',
    originalAmount: toMoneyString(receivable.originalAmount, 2),
    creditAmount: toMoneyString(receivable.creditAmount, 2),
    paidAmount: toMoneyString(receivable.paidAmount, 2),
    outstandingAmount: toMoneyString(receivable.outstandingAmount, 2),
    dueDate: toBusinessDate(receivable.dueDate),
    status: receivable.status,
    createdAt: receivable.createdAt,
    updatedAt: receivable.updatedAt,
  };
}

// --- pure amount rules -----------------------------------------------------

/**
 * What is left on an invoice, and what that makes its status.
 *
 * Outstanding is never negative: if credits and payments together exceed the
 * invoice, the surplus is customer credit and shows in the customer BALANCE,
 * not as a negative number on this invoice.
 *
 * Exported so it can be unit tested without a database.
 */
export function deriveReceivableState({ originalAmount, creditAmount = 0, paidAmount }) {
  const settled = add(creditAmount, paidAmount);
  const raw = subtract(originalAmount, settled);
  const outstandingAmount = isGreaterThan(0, raw) ? toDecimal(0) : round(raw, MONEY_DP);

  let status;
  if (isZero(settled)) {
    status = 'OPEN';
  } else if (!isZero(outstandingAmount)) {
    status = 'PARTIALLY_PAID';
  } else if (isGreaterThan(paidAmount, 0)) {
    status = 'PAID';
  } else {
    // Fully settled by returns rather than by money.
    status = 'CREDITED';
  }

  return { outstandingAmount, status };
}

// --- writes called from inside other modules' transactions -----------------

/**
 * Raises the receivable for a sales invoice being posted.
 *
 * Called from SalesService.post INSIDE its transaction, so the invoice, the
 * stock movements and the receivable all commit together or not at all.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function recordSalePosted(tx, currentUser, salesInvoice) {
  const { companyId } = currentUser;

  const receivable = await customerReceivableRepository.create(tx, {
    companyId,
    customerId: salesInvoice.customerId,
    salesInvoiceId: salesInvoice.id,
    originalAmount: salesInvoice.grandTotal,
    paidAmount: 0,
    outstandingAmount: salesInvoice.grandTotal,
    dueDate: salesInvoice.dueDate ?? null,
    status: 'OPEN',
  });

  await customerLedgerRepository.create(tx, {
    companyId,
    customerId: salesInvoice.customerId,
    entryType: 'SALE',
    entryDate: salesInvoice.invoiceDate,
    // A sale increases what the customer owes us.
    debit: salesInvoice.grandTotal,
    credit: 0,
    referenceType: LEDGER_REFERENCE_TYPE.SALES_INVOICE,
    referenceId: salesInvoice.id,
    receivableId: receivable.id,
    description: `Sales invoice ${salesInvoice.invoiceNumber}`,
    createdById: currentUser.id,
  });

  return receivable;
}

/**
 * Credits the customer for a sales return being posted.
 *
 * Called from SalesReturnService.post INSIDE its transaction. It reduces the
 * receivable raised by the original invoice - it never creates a new one.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function recordSalesReturnPosted(tx, currentUser, salesReturn) {
  const { companyId } = currentUser;

  const receivable = await customerReceivableRepository.lockBySalesInvoice(
    tx,
    salesReturn.salesInvoiceId,
    companyId,
  );

  // Every posted invoice has a receivable, so this should be unreachable. If it
  // ever happens the return must fail rather than silently skip the credit.
  if (!receivable) {
    throw ApiError.business(
      422,
      'CUSTOMER_RECEIVABLE_NOT_FOUND',
      'No receivable exists for the invoice being returned',
    );
  }

  const creditAmount = add(receivable.creditAmount, salesReturn.grandTotal);
  const { outstandingAmount, status } = deriveReceivableState({
    originalAmount: receivable.originalAmount,
    creditAmount,
    paidAmount: receivable.paidAmount,
  });

  await customerReceivableRepository.updateAmounts(tx, receivable.id, {
    creditAmount: round(creditAmount, MONEY_DP),
    paidAmount: receivable.paidAmount,
    outstandingAmount,
    status,
  });

  await customerLedgerRepository.create(tx, {
    companyId,
    customerId: receivable.customerId,
    entryType: 'SALES_RETURN',
    entryDate: salesReturn.returnDate,
    // A return reduces what the customer owes us.
    credit: salesReturn.grandTotal,
    debit: 0,
    referenceType: LEDGER_REFERENCE_TYPE.SALES_RETURN,
    referenceId: salesReturn.id,
    receivableId: receivable.id,
    description: `Sales return ${salesReturn.returnNumber}`,
    createdById: currentUser.id,
  });

  return receivable;
}

// --- reads -----------------------------------------------------------------

export async function listReceivables(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await customerReceivableRepository.findManyByCompany(
    currentUser.companyId,
    { skip, take, ...filters },
  );

  return {
    receivables: items.map(toPublicReceivable),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getReceivableById(currentUser, id) {
  const receivable = await customerReceivableRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!receivable) {
    throw ApiError.business(404, 'CUSTOMER_RECEIVABLE_NOT_FOUND', 'Customer receivable not found');
  }
  return toPublicReceivable(receivable);
}

/** Another company's customer is reported exactly like a non-existent one. */
async function assertCustomer(companyId, customerId) {
  const customer = await customerRepository.findByIdAndCompany(customerId, companyId);
  if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  return customer;
}

/**
 * The customer ledger: every entry in date order with a running balance.
 * `fromDate` does not lose history - everything before it forms the opening
 * balance.
 */
export async function getCustomerLedger(currentUser, customerId, query = {}) {
  const { companyId } = currentUser;
  const customer = await assertCustomer(companyId, customerId);

  let openingBalance = toDecimal(0);
  if (query.fromDate) {
    const before = await customerLedgerRepository.sumByCustomerBefore(
      customerId,
      companyId,
      query.fromDate,
    );
    openingBalance = subtract(before._sum.debit ?? 0, before._sum.credit ?? 0);
  }

  const rows = await customerLedgerRepository.findByCustomer(customerId, companyId, {
    fromDate: query.fromDate,
    toDate: query.toDate,
  });

  let balance = openingBalance;
  const entries = rows.map((row) => {
    balance = subtract(add(balance, row.debit), row.credit);
    return {
      id: row.id,
      date: toBusinessDate(row.entryDate),
      type: row.entryType,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      receivableId: row.receivableId,
      description: row.description,
      debit: toMoneyString(row.debit, 2),
      credit: toMoneyString(row.credit, 2),
      balance: toMoneyString(balance, 2),
      createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
      createdAt: row.createdAt,
    };
  });

  return {
    customer: { id: customer.id, name: customer.name },
    // Positive means the customer owes us.
    openingBalance: toMoneyString(openingBalance, 2),
    entries,
    closingBalance: toMoneyString(balance, 2),
  };
}

/**
 * A customer's position at a glance.
 *
 * `outstandingAmount` is derived from the ledger, the single source of truth for
 * a balance. `invoiceOutstanding` sums the per-invoice figures; the two differ
 * only by unallocated advances, reported as `unallocatedCredit`.
 */
export async function getCustomerOutstanding(currentUser, customerId) {
  const { companyId } = currentUser;
  const customer = await assertCustomer(companyId, customerId);

  const [byType, receivableTotals] = await Promise.all([
    customerLedgerRepository.sumByCustomerGroupedByType(customerId, companyId),
    customerReceivableRepository.sumByCustomer(customerId, companyId),
  ]);

  const totalFor = (type, side) => {
    const row = byType.find((entry) => entry.entryType === type);
    return row ? (row._sum[side] ?? toDecimal(0)) : toDecimal(0);
  };

  const totalSales = totalFor('SALE', 'debit');
  const totalPayments = totalFor('PAYMENT', 'credit');
  const totalReturns = totalFor('SALES_RETURN', 'credit');

  const outstanding = subtract(subtract(totalSales, totalPayments), totalReturns);
  const invoiceOutstanding = receivableTotals._sum.outstandingAmount ?? toDecimal(0);

  return {
    customer: { id: customer.id, name: customer.name },
    totalSales: toMoneyString(totalSales, 2),
    totalPayments: toMoneyString(totalPayments, 2),
    totalReturns: toMoneyString(totalReturns, 2),
    // Positive: they owe us. Negative: we hold their money (an advance).
    outstandingAmount: toMoneyString(outstanding, 2),
    invoiceOutstanding: toMoneyString(invoiceOutstanding, 2),
    unallocatedCredit: toMoneyString(subtract(invoiceOutstanding, outstanding), 2),
  };
}

export async function listOutstandingReceivables(currentUser, customerId) {
  const { companyId } = currentUser;
  await assertCustomer(companyId, customerId);

  const receivables = await customerReceivableRepository.findOutstandingByCustomer(
    customerId,
    companyId,
  );
  return receivables.map(toPublicReceivable);
}
