import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, subtract, round, toDecimal, toMoneyString, isGreaterThan, isZero } from '../../utils/money.js';
import * as supplierPayableRepository from './supplier-payable.repository.js';
import * as supplierLedgerRepository from './supplier-ledger.repository.js';
import * as supplierRepository from '../suppliers/supplier.repository.js';

// The supplier sub-ledger.
//
// THIS IS NOT DOUBLE-ENTRY ACCOUNTING. It answers one question - what do we owe
// each supplier, and against which bills. A general ledger comes later.
//
// SIGN CONVENTION (from the supplier account's side, standard accounting):
//   CREDIT increases what we owe   -> a purchase
//   DEBIT  reduces what we owe     -> a payment, or a purchase return
//   balance = sum(credit) - sum(debit).  Positive means we owe the supplier.
//
// TWO STRUCTURES, ONE SOURCE OF TRUTH PER QUESTION:
//   "What is this supplier's balance?"  -> derived from SupplierLedgerEntry.
//   "How much is left on THIS bill?"    -> SupplierPayable.outstandingAmount,
//                                          maintained inside the same transaction.
// They answer different questions, so they cannot contradict each other.

const MONEY_DP = 4;

export const LEDGER_REFERENCE_TYPE = {
  PURCHASE: 'PURCHASE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  /// A balance that existed before the business started using this system.
  /// Not a document: there is no invoice or bill behind it.
  OPENING_BALANCE: 'OPENING_BALANCE',
};

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toPublicPayable(payable) {
  return {
    id: payable.id,
    supplier: { id: payable.supplier.id, name: payable.supplier.name },
    // Null on an OPENING BALANCE: money already owed to the supplier when the
    // business started here, with no bill behind it.
    purchase: payable.purchase
      ? {
          id: payable.purchase.id,
          purchaseNumber: payable.purchase.purchaseNumber,
          invoiceNumber: payable.purchase.invoiceNumber,
          invoiceDate: toBusinessDate(payable.purchase.invoiceDate),
        }
      : null,
    source: payable.purchase ? 'PURCHASE' : 'OPENING_BALANCE',
    originalAmount: toMoneyString(payable.originalAmount, 2),
    creditAmount: toMoneyString(payable.creditAmount, 2),
    paidAmount: toMoneyString(payable.paidAmount, 2),
    outstandingAmount: toMoneyString(payable.outstandingAmount, 2),
    dueDate: toBusinessDate(payable.dueDate),
    status: payable.status,
    createdAt: payable.createdAt,
    updatedAt: payable.updatedAt,
  };
}

// --- pure amount rules -----------------------------------------------------

/**
 * What is left on a bill, and what that makes its status.
 *
 * Outstanding is never negative: if returns and payments together exceed the
 * bill, the surplus is a supplier credit and shows up in the supplier BALANCE,
 * not as a negative number on this bill.
 *
 * Exported so it can be unit tested without a database.
 */
export function derivePayableState({ originalAmount, creditAmount, paidAmount }) {
  const settled = add(creditAmount, paidAmount);
  const raw = subtract(originalAmount, settled);
  const outstandingAmount = isGreaterThan(0, raw) ? toDecimal(0) : round(raw, MONEY_DP);

  let status;
  if (!isZero(outstandingAmount) && isZero(settled)) {
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
 * Raises the payable for a purchase being posted.
 *
 * Called from PurchaseService.post INSIDE its transaction, so the bill, the
 * stock and the payable all commit together or not at all.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function recordPurchasePosted(tx, currentUser, purchase) {
  const { companyId } = currentUser;

  const payable = await supplierPayableRepository.create(tx, {
    companyId,
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    originalAmount: purchase.grandTotal,
    creditAmount: 0,
    paidAmount: 0,
    outstandingAmount: purchase.grandTotal,
    dueDate: purchase.dueDate ?? null,
    status: 'OPEN',
  });

  await supplierLedgerRepository.create(tx, {
    companyId,
    supplierId: purchase.supplierId,
    entryType: 'PURCHASE',
    entryDate: purchase.invoiceDate,
    // A purchase increases what we owe.
    credit: purchase.grandTotal,
    debit: 0,
    referenceType: LEDGER_REFERENCE_TYPE.PURCHASE,
    referenceId: purchase.id,
    payableId: payable.id,
    description: `Purchase ${purchase.purchaseNumber}`,
    createdById: currentUser.id,
  });

  return payable;
}

/**
 * Credits the supplier for a purchase return being posted.
 *
 * Called from PurchaseReturnService.post INSIDE its transaction. It reduces the
 * payable raised by the original purchase - it never creates a new payable.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function recordPurchaseReturnPosted(tx, currentUser, purchaseReturn) {
  const { companyId } = currentUser;

  const payable = await supplierPayableRepository.lockByPurchase(
    tx,
    purchaseReturn.purchaseId,
    companyId,
  );

  // Every posted purchase has a payable, so this should be unreachable. If it
  // ever happens the return must fail rather than silently skip the credit.
  if (!payable) {
    throw ApiError.business(
      422,
      'SUPPLIER_PAYABLE_NOT_FOUND',
      'No payable exists for the purchase being returned',
    );
  }

  const creditAmount = add(payable.creditAmount, purchaseReturn.grandTotal);
  const { outstandingAmount, status } = derivePayableState({
    originalAmount: payable.originalAmount,
    creditAmount,
    paidAmount: payable.paidAmount,
  });

  await supplierPayableRepository.updateAmounts(tx, payable.id, {
    creditAmount: round(creditAmount, MONEY_DP),
    paidAmount: payable.paidAmount,
    outstandingAmount,
    status,
  });

  await supplierLedgerRepository.create(tx, {
    companyId,
    supplierId: payable.supplierId,
    entryType: 'PURCHASE_RETURN',
    entryDate: purchaseReturn.returnDate,
    // A return reduces what we owe.
    debit: purchaseReturn.grandTotal,
    credit: 0,
    referenceType: LEDGER_REFERENCE_TYPE.PURCHASE_RETURN,
    referenceId: purchaseReturn.id,
    payableId: payable.id,
    description: `Purchase return ${purchaseReturn.returnNumber}`,
    createdById: currentUser.id,
  });

  return payable;
}

// --- reads -----------------------------------------------------------------

export async function listPayables(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await supplierPayableRepository.findManyByCompany(
    currentUser.companyId,
    { skip, take, ...filters },
  );

  return {
    payables: items.map(toPublicPayable),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getPayableById(currentUser, id) {
  const payable = await supplierPayableRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!payable) {
    throw ApiError.business(404, 'SUPPLIER_PAYABLE_NOT_FOUND', 'Supplier payable not found');
  }
  return toPublicPayable(payable);
}

/** Another company's supplier is reported exactly like a non-existent one. */
async function assertSupplier(companyId, supplierId) {
  const supplier = await supplierRepository.findByIdAndCompany(supplierId, companyId);
  if (!supplier) throw ApiError.business(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  return supplier;
}

/**
 * The supplier ledger: every entry in date order with a running balance.
 * `fromDate` does not lose history - everything before it is collapsed into the
 * opening balance.
 */
export async function getSupplierLedger(currentUser, supplierId, query = {}) {
  const { companyId } = currentUser;
  const supplier = await assertSupplier(companyId, supplierId);

  let openingBalance = toDecimal(0);
  if (query.fromDate) {
    const before = await supplierLedgerRepository.sumBySupplierBefore(
      supplierId,
      companyId,
      query.fromDate,
    );
    openingBalance = subtract(before._sum.credit ?? 0, before._sum.debit ?? 0);
  }

  const rows = await supplierLedgerRepository.findBySupplier(supplierId, companyId, {
    fromDate: query.fromDate,
    toDate: query.toDate,
  });

  let balance = openingBalance;
  const entries = rows.map((row) => {
    balance = subtract(add(balance, row.credit), row.debit);
    return {
      id: row.id,
      date: toBusinessDate(row.entryDate),
      type: row.entryType,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      payableId: row.payableId,
      description: row.description,
      debit: toMoneyString(row.debit, 2),
      credit: toMoneyString(row.credit, 2),
      balance: toMoneyString(balance, 2),
      createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
      createdAt: row.createdAt,
    };
  });

  return {
    supplier: { id: supplier.id, name: supplier.name },
    // Positive means we owe the supplier.
    openingBalance: toMoneyString(openingBalance, 2),
    entries,
    closingBalance: toMoneyString(balance, 2),
  };
}

/**
 * A supplier's position at a glance.
 *
 * `outstandingAmount` is derived from the ledger, which is the single source of
 * truth for a balance. `billOutstanding` sums the per-bill figures; the two
 * differ only by unallocated advances, which is exactly what `unallocatedCredit`
 * reports.
 */
export async function getSupplierOutstanding(currentUser, supplierId) {
  const { companyId } = currentUser;
  const supplier = await assertSupplier(companyId, supplierId);

  const [byType, payableTotals] = await Promise.all([
    supplierLedgerRepository.sumBySupplierGroupedByType(supplierId, companyId),
    supplierPayableRepository.sumOutstandingBySupplier(supplierId, companyId),
  ]);

  const totalFor = (type, side) => {
    const row = byType.find((entry) => entry.entryType === type);
    return row ? (row._sum[side] ?? toDecimal(0)) : toDecimal(0);
  };

  const totalPurchases = totalFor('PURCHASE', 'credit');
  const totalReturns = totalFor('PURCHASE_RETURN', 'debit');
  const totalPayments = totalFor('PAYMENT', 'debit');

  const outstanding = subtract(subtract(totalPurchases, totalReturns), totalPayments);
  const billOutstanding = payableTotals._sum.outstandingAmount ?? toDecimal(0);

  return {
    supplier: { id: supplier.id, name: supplier.name },
    totalPurchases: toMoneyString(totalPurchases, 2),
    totalReturns: toMoneyString(totalReturns, 2),
    totalPayments: toMoneyString(totalPayments, 2),
    // Positive: we owe them. Negative: we are in credit (advances paid).
    outstandingAmount: toMoneyString(outstanding, 2),
    // Sum of what is still open on individual bills.
    billOutstanding: toMoneyString(billOutstanding, 2),
    // Money paid that is not yet applied to any bill.
    unallocatedCredit: toMoneyString(subtract(billOutstanding, outstanding), 2),
  };
}

export async function listOutstandingPayables(currentUser, supplierId) {
  const { companyId } = currentUser;
  await assertSupplier(companyId, supplierId);

  const payables = await supplierPayableRepository.findOutstandingBySupplier(supplierId, companyId);
  return payables.map(toPublicPayable);
}
