import { prisma } from '../../config/prisma.js';

// All Prisma access for supplier payables. Every method is company scoped.

const PAYABLE_FIELDS = {
  id: true,
  originalAmount: true,
  creditAmount: true,
  paidAmount: true,
  outstandingAmount: true,
  dueDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  purchase: {
    select: {
      id: true,
      purchaseNumber: true,
      invoiceNumber: true,
      invoiceDate: true,
      supplierNameSnapshot: true,
    },
  },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.supplierPayable.findFirst({ where: { id, companyId }, select: PAYABLE_FIELDS });
}

export function findByPurchase(purchaseId, companyId, client = prisma) {
  return client.supplierPayable.findFirst({
    where: { purchaseId, companyId },
    select: PAYABLE_FIELDS,
  });
}

/**
 * Locks one payable row for the rest of the transaction and returns the amounts
 * needed to validate an allocation.
 *
 * MUST be called inside a transaction. Callers must lock several payables in a
 * deterministic order (sorted by id) so concurrent payments cannot deadlock.
 */
export async function lockForUpdate(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM supplier_payables WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.supplierPayable.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      supplierId: true,
      originalAmount: true,
      creditAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
    },
  });
}

/** Locks the payable belonging to a purchase. Used when posting a return. */
export async function lockByPurchase(tx, purchaseId, companyId) {
  await tx.$queryRaw`
    SELECT id FROM supplier_payables
    WHERE "purchaseId" = ${purchaseId} AND "companyId" = ${companyId}
    FOR UPDATE
  `;

  return tx.supplierPayable.findFirst({
    where: { purchaseId, companyId },
    select: {
      id: true,
      supplierId: true,
      originalAmount: true,
      creditAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
    },
  });
}

export function create(tx, data) {
  return tx.supplierPayable.create({ data, select: { id: true } });
}

/** Applies recomputed amounts. Only ever called with values the service derived. */
export function updateAmounts(tx, id, { creditAmount, paidAmount, outstandingAmount, status }) {
  return tx.supplierPayable.update({
    where: { id },
    data: { creditAmount, paidAmount, outstandingAmount, status },
    select: { id: true },
  });
}

/**
 * @param {{ skip: number, take: number, supplierId?: string, status?: string,
 *           onlyOutstanding?: boolean, dueDateFrom?: Date, dueDateTo?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, supplierId, status, onlyOutstanding, dueDateFrom, dueDateTo },
) {
  const where = { companyId };
  if (supplierId) where.supplierId = supplierId;
  if (status) where.status = status;
  if (onlyOutstanding) where.outstandingAmount = { gt: 0 };
  if (dueDateFrom || dueDateTo) {
    where.dueDate = {};
    if (dueDateFrom) where.dueDate.gte = dueDateFrom;
    if (dueDateTo) where.dueDate.lte = dueDateTo;
  }

  const [items, total] = await Promise.all([
    prisma.supplierPayable.findMany({
      where,
      select: PAYABLE_FIELDS,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      skip,
      take,
    }),
    prisma.supplierPayable.count({ where }),
  ]);

  return { items, total };
}

/** Bills a supplier still owes money on, oldest first. */
export function findOutstandingBySupplier(supplierId, companyId) {
  return prisma.supplierPayable.findMany({
    where: { companyId, supplierId, outstandingAmount: { gt: 0 } },
    select: PAYABLE_FIELDS,
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
}

export function sumOutstandingBySupplier(supplierId, companyId) {
  return prisma.supplierPayable.aggregate({
    where: { companyId, supplierId },
    _sum: { originalAmount: true, creditAmount: true, paidAmount: true, outstandingAmount: true },
  });
}
