import { prisma } from '../../config/prisma.js';
import { subtract, toDecimal } from '../../utils/money.js';

// All Prisma access for the credit and collections layer.
//
// EVERY QUERY HERE IS A READ, except `lockCustomerForCredit`, which takes a row
// lock and writes nothing. This module owns no financial fact: the balances it
// returns are the ones the customer and supplier sub-ledgers already maintain
// inside their posting transactions, and the aggregates are aggregates of those.
//
// Nothing in this file filters by document status. It does not need to: a
// sub-ledger entry only exists because a document was POSTED, so drafts and
// cancelled documents are absent by construction rather than by a WHERE clause
// that could be forgotten.

// --- the customer row lock -------------------------------------------------

/**
 * Locks one customer for the duration of a posting transaction.
 *
 * This is what makes the credit limit hold under concurrency. Two invoices for
 * the same customer posting at once would otherwise both read the same balance,
 * both find room under the limit, and both commit - leaving the customer over
 * their limit with neither posting at fault.
 *
 * Sales posting is the ONLY flow that takes this lock, and it takes it before
 * any inventory lock, so the order is total and no cycle with another flow is
 * possible.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function lockCustomerForCredit(tx, customerId, companyId) {
  await tx.$queryRaw`
    SELECT id FROM customers WHERE id = ${customerId} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.customer.findFirst({
    where: { id: customerId, companyId },
    select: { id: true, name: true, creditLimit: true, creditDays: true, isActive: true },
  });
}

// --- balances --------------------------------------------------------------

/**
 * What a customer owes, from the ledger: sum(debit) - sum(credit).
 *
 * Positive means they owe us. Negative means we are holding their money.
 */
export async function customerLedgerBalance(companyId, customerId, client = prisma) {
  const totals = await client.customerLedgerEntry.aggregate({
    where: { companyId, customerId },
    _sum: { debit: true, credit: true },
  });

  return subtract(totals._sum.debit ?? 0, totals._sum.credit ?? 0);
}

/** The same for a supplier, whose sign convention is the mirror image. */
export async function supplierLedgerBalance(companyId, supplierId, client = prisma) {
  const totals = await client.supplierLedgerEntry.aggregate({
    where: { companyId, supplierId },
    _sum: { debit: true, credit: true },
  });

  // A supplier ledger credits what we owe, so the balance is credit - debit.
  return subtract(totals._sum.credit ?? 0, totals._sum.debit ?? 0);
}

/**
 * Ledger balances for many customers at once, so a list of parties costs one
 * query rather than one per row.
 *
 * @returns {Promise<Map<string, Decimal>>} customerId -> balance
 */
export async function customerLedgerBalances(companyId, customerIds = null) {
  const where = { companyId };
  if (customerIds) {
    if (customerIds.length === 0) return new Map();
    where.customerId = { in: customerIds };
  }

  const rows = await prisma.customerLedgerEntry.groupBy({
    by: ['customerId'],
    where,
    _sum: { debit: true, credit: true },
  });

  return new Map(
    rows.map((row) => [row.customerId, subtract(row._sum.debit ?? 0, row._sum.credit ?? 0)]),
  );
}

// --- parties ---------------------------------------------------------------

/** Every customer that has a credit limit set, or a balance worth reporting. */
export function findCustomersWithCredit(companyId) {
  return prisma.customer.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      phone: true,
      isActive: true,
      creditLimit: true,
      creditDays: true,
    },
    orderBy: { name: 'asc' },
  });
}

export function findCustomerById(companyId, customerId) {
  return prisma.customer.findFirst({
    where: { id: customerId, companyId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      isActive: true,
      creditLimit: true,
      creditDays: true,
      openingBalance: true,
    },
  });
}

export function findSupplierById(companyId, supplierId) {
  return prisma.supplier.findFirst({
    where: { id: supplierId, companyId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      isActive: true,
      creditLimit: true,
      creditDays: true,
      openingBalance: true,
    },
  });
}

// --- outstanding, overdue and what falls due -------------------------------

/** Open receivables per customer: how much, on how many invoices. */
export function groupOutstandingReceivables(companyId) {
  return prisma.customerReceivable.groupBy({
    by: ['customerId'],
    where: { companyId, outstandingAmount: { gt: 0 } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

/**
 * Overdue receivables per customer, as of a date.
 *
 * An invoice with no due date is never overdue: nobody agreed a date, so nothing
 * has been missed. It still counts as outstanding.
 */
export function groupOverdueReceivables(companyId, asOfDate) {
  return prisma.customerReceivable.groupBy({
    by: ['customerId'],
    where: {
      companyId,
      outstandingAmount: { gt: 0 },
      dueDate: { not: null, lt: asOfDate },
    },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

/** What falls due inside a window and is not yet paid - the collection list. */
export function groupReceivablesDueBetween(companyId, fromDate, toDate) {
  return prisma.customerReceivable.groupBy({
    by: ['customerId'],
    where: {
      companyId,
      outstandingAmount: { gt: 0 },
      dueDate: { not: null, gte: fromDate, lte: toDate },
    },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

/** The earliest unpaid due date per customer, for "how long overdue". */
export function findEarliestDueDates(companyId) {
  return prisma.customerReceivable.groupBy({
    by: ['customerId'],
    where: { companyId, outstandingAmount: { gt: 0 }, dueDate: { not: null } },
    _min: { dueDate: true },
  });
}

/** Open receivables with their dates, for ageing by document rather than party. */
export function findOpenReceivables(companyId) {
  return prisma.customerReceivable.findMany({
    where: { companyId, outstandingAmount: { gt: 0 } },
    select: {
      id: true,
      customerId: true,
      outstandingAmount: true,
      originalAmount: true,
      dueDate: true,
      customer: { select: { id: true, name: true } },
      salesInvoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
}

/** The supplier-side mirror, for payables ageing. */
export function findOpenPayables(companyId) {
  return prisma.supplierPayable.findMany({
    where: { companyId, outstandingAmount: { gt: 0 } },
    select: {
      id: true,
      supplierId: true,
      outstandingAmount: true,
      originalAmount: true,
      dueDate: true,
      supplier: { select: { id: true, name: true } },
      purchase: { select: { id: true, purchaseNumber: true, invoiceDate: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
}

// --- what was actually collected -------------------------------------------

/**
 * Posted receipts in a period. Only POSTED: a draft receipt has collected
 * nothing, and a cancelled one never did.
 */
export function sumCollections(companyId, { fromDate, toDate } = {}) {
  const where = { companyId, status: 'POSTED' };
  if (fromDate || toDate) {
    where.paymentDate = {};
    if (fromDate) where.paymentDate.gte = fromDate;
    if (toDate) where.paymentDate.lte = toDate;
  }

  return prisma.customerPayment.aggregate({
    where,
    _sum: { amount: true, allocatedAmount: true, unallocatedAmount: true },
    _count: { _all: true },
  });
}

/** The supplier-side mirror: money paid out in a period. */
export function sumSupplierPayments(companyId, { fromDate, toDate } = {}) {
  const where = { companyId, status: 'POSTED' };
  if (fromDate || toDate) {
    where.paymentDate = {};
    if (fromDate) where.paymentDate.gte = fromDate;
    if (toDate) where.paymentDate.lte = toDate;
  }

  return prisma.supplierPayment.aggregate({
    where,
    _sum: { amount: true, allocatedAmount: true, unallocatedAmount: true },
    _count: { _all: true },
  });
}

/** Collections per customer in a period, for "who actually paid". */
export function groupCollectionsByCustomer(companyId, { fromDate, toDate } = {}) {
  const where = { companyId, status: 'POSTED' };
  if (fromDate || toDate) {
    where.paymentDate = {};
    if (fromDate) where.paymentDate.gte = fromDate;
    if (toDate) where.paymentDate.lte = toDate;
  }

  return prisma.customerPayment.groupBy({
    by: ['customerId'],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });
}

// --- statements ------------------------------------------------------------

/**
 * A customer's ledger entries with their source documents attached.
 *
 * The statement needs a document NUMBER per line, and the ledger entry carries
 * only a reference type and id. Rather than duplicating the number onto the
 * ledger - a second copy of a fact that would then need keeping in step - the
 * documents are fetched alongside and joined in the service.
 */
export function findCustomerLedgerEntries(companyId, customerId, { fromDate, toDate } = {}) {
  const where = { companyId, customerId };
  if (fromDate || toDate) {
    where.entryDate = {};
    if (fromDate) where.entryDate.gte = fromDate;
    if (toDate) where.entryDate.lte = toDate;
  }

  return prisma.customerLedgerEntry.findMany({
    where,
    select: {
      id: true,
      entryType: true,
      entryDate: true,
      debit: true,
      credit: true,
      referenceType: true,
      referenceId: true,
      receivableId: true,
      description: true,
      createdAt: true,
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });
}

export function findSupplierLedgerEntries(companyId, supplierId, { fromDate, toDate } = {}) {
  const where = { companyId, supplierId };
  if (fromDate || toDate) {
    where.entryDate = {};
    if (fromDate) where.entryDate.gte = fromDate;
    if (toDate) where.entryDate.lte = toDate;
  }

  return prisma.supplierLedgerEntry.findMany({
    where,
    select: {
      id: true,
      entryType: true,
      entryDate: true,
      debit: true,
      credit: true,
      referenceType: true,
      referenceId: true,
      payableId: true,
      description: true,
      createdAt: true,
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });
}

/** Everything before a date, so a windowed statement still opens correctly. */
export async function customerBalanceBefore(companyId, customerId, fromDate) {
  const totals = await prisma.customerLedgerEntry.aggregate({
    where: { companyId, customerId, entryDate: { lt: fromDate } },
    _sum: { debit: true, credit: true },
  });

  return subtract(totals._sum.debit ?? 0, totals._sum.credit ?? 0);
}

export async function supplierBalanceBefore(companyId, supplierId, fromDate) {
  const totals = await prisma.supplierLedgerEntry.aggregate({
    where: { companyId, supplierId, entryDate: { lt: fromDate } },
    _sum: { debit: true, credit: true },
  });

  return subtract(totals._sum.credit ?? 0, totals._sum.debit ?? 0);
}

/**
 * The document numbers behind a set of ledger references, in one query per
 * document type rather than one per line.
 *
 * @returns {Promise<Map<string, {number: string, date: Date|null}>>} keyed by
 *   `${referenceType}:${referenceId}`
 */
export async function findDocumentNumbers(companyId, references) {
  const idsFor = (type) => [
    ...new Set(references.filter((r) => r.referenceType === type).map((r) => r.referenceId)),
  ];

  const key = (type, id) => `${type}:${id}`;
  const found = new Map();

  const collect = async (type, ids, load) => {
    if (ids.length === 0) return;
    for (const row of await load(ids)) found.set(key(type, row.id), row);
  };

  await Promise.all([
    collect(
      'SALES_INVOICE',
      idsFor('SALES_INVOICE'),
      async (ids) =>
        (
          await prisma.salesInvoice.findMany({
            where: { companyId, id: { in: ids } },
            select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true },
          })
        ).map((row) => ({ id: row.id, number: row.invoiceNumber, date: row.invoiceDate, dueDate: row.dueDate })),
    ),
    collect(
      'CUSTOMER_PAYMENT',
      idsFor('CUSTOMER_PAYMENT'),
      async (ids) =>
        (
          await prisma.customerPayment.findMany({
            where: { companyId, id: { in: ids } },
            select: { id: true, paymentNumber: true, paymentDate: true, paymentMethod: true, referenceNumber: true },
          })
        ).map((row) => ({
          id: row.id,
          number: row.paymentNumber,
          date: row.paymentDate,
          method: row.paymentMethod,
          reference: row.referenceNumber,
        })),
    ),
    collect(
      'SALES_RETURN',
      idsFor('SALES_RETURN'),
      async (ids) =>
        (
          await prisma.salesReturn.findMany({
            where: { companyId, id: { in: ids } },
            select: { id: true, returnNumber: true, returnDate: true },
          })
        ).map((row) => ({ id: row.id, number: row.returnNumber, date: row.returnDate })),
    ),
    collect(
      'PURCHASE',
      idsFor('PURCHASE'),
      async (ids) =>
        (
          await prisma.purchase.findMany({
            where: { companyId, id: { in: ids } },
            select: { id: true, purchaseNumber: true, invoiceNumber: true, invoiceDate: true, dueDate: true },
          })
        ).map((row) => ({
          id: row.id,
          number: row.purchaseNumber,
          supplierInvoiceNumber: row.invoiceNumber,
          date: row.invoiceDate,
          dueDate: row.dueDate,
        })),
    ),
    collect(
      'SUPPLIER_PAYMENT',
      idsFor('SUPPLIER_PAYMENT'),
      async (ids) =>
        (
          await prisma.supplierPayment.findMany({
            where: { companyId, id: { in: ids } },
            select: { id: true, paymentNumber: true, paymentDate: true, paymentMethod: true, referenceNumber: true },
          })
        ).map((row) => ({
          id: row.id,
          number: row.paymentNumber,
          date: row.paymentDate,
          method: row.paymentMethod,
          reference: row.referenceNumber,
        })),
    ),
    collect(
      'PURCHASE_RETURN',
      idsFor('PURCHASE_RETURN'),
      async (ids) =>
        (
          await prisma.purchaseReturn.findMany({
            where: { companyId, id: { in: ids } },
            select: { id: true, returnNumber: true, returnDate: true },
          })
        ).map((row) => ({ id: row.id, number: row.returnNumber, date: row.returnDate })),
    ),
  ]);

  return found;
}

export { toDecimal };
