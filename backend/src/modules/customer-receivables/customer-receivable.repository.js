import { prisma } from '../../config/prisma.js';

// All Prisma access for customer receivables. Every method is company scoped.

const RECEIVABLE_FIELDS = {
  id: true,
  originalAmount: true,
  creditAmount: true,
  paidAmount: true,
  outstandingAmount: true,
  dueDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
  salesInvoice: {
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      status: true,
      customerNameSnapshot: true,
    },
  },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.customerReceivable.findFirst({ where: { id, companyId }, select: RECEIVABLE_FIELDS });
}

export function findBySalesInvoice(salesInvoiceId, companyId, client = prisma) {
  return client.customerReceivable.findFirst({
    where: { salesInvoiceId, companyId },
    select: RECEIVABLE_FIELDS,
  });
}

/**
 * Locks one receivable for the rest of the transaction and returns the amounts
 * needed to validate an allocation.
 *
 * MUST be called inside a transaction. Callers must lock several receivables in
 * a deterministic order (sorted by id) so concurrent payments cannot deadlock.
 */
export async function lockForUpdate(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM customer_receivables WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.customerReceivable.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      customerId: true,
      originalAmount: true,
      creditAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
      salesInvoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });
}

export function create(tx, data) {
  return tx.customerReceivable.create({ data, select: { id: true } });
}

export function updateAmounts(tx, id, { creditAmount, paidAmount, outstandingAmount, status }) {
  return tx.customerReceivable.update({
    where: { id },
    data: { creditAmount, paidAmount, outstandingAmount, status },
    select: { id: true },
  });
}

/**
 * Locks the receivable belonging to a sales invoice. Used when posting a return.
 * MUST be called inside a transaction.
 */
export async function lockBySalesInvoice(tx, salesInvoiceId, companyId) {
  await tx.$queryRaw`
    SELECT id FROM customer_receivables
    WHERE "salesInvoiceId" = ${salesInvoiceId} AND "companyId" = ${companyId}
    FOR UPDATE
  `;

  return tx.customerReceivable.findFirst({
    where: { salesInvoiceId, companyId },
    select: {
      id: true,
      customerId: true,
      originalAmount: true,
      creditAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
    },
  });
}

/**
 * @param {{ skip: number, take: number, customerId?: string, status?: string,
 *           onlyOutstanding?: boolean, dueDateFrom?: Date, dueDateTo?: Date,
 *           invoiceNumber?: string }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, customerId, status, onlyOutstanding, dueDateFrom, dueDateTo, invoiceNumber },
) {
  const where = { companyId };
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (onlyOutstanding) where.outstandingAmount = { gt: 0 };
  if (invoiceNumber) {
    where.salesInvoice = { invoiceNumber: { contains: invoiceNumber, mode: 'insensitive' } };
  }
  if (dueDateFrom || dueDateTo) {
    where.dueDate = {};
    if (dueDateFrom) where.dueDate.gte = dueDateFrom;
    if (dueDateTo) where.dueDate.lte = dueDateTo;
  }

  const [items, total] = await Promise.all([
    prisma.customerReceivable.findMany({
      where,
      select: RECEIVABLE_FIELDS,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      skip,
      take,
    }),
    prisma.customerReceivable.count({ where }),
  ]);

  return { items, total };
}

/** Invoices a customer still owes money on, oldest first. */
export function findOutstandingByCustomer(customerId, companyId) {
  return prisma.customerReceivable.findMany({
    where: { companyId, customerId, outstandingAmount: { gt: 0 } },
    select: RECEIVABLE_FIELDS,
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
}

export function sumByCustomer(customerId, companyId) {
  return prisma.customerReceivable.aggregate({
    where: { companyId, customerId },
    _sum: { originalAmount: true, creditAmount: true, paidAmount: true, outstandingAmount: true },
  });
}
