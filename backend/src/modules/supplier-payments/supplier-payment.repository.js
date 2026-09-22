import { prisma } from '../../config/prisma.js';

// All Prisma access for supplier payments and their allocations.

const ALLOCATION_FIELDS = {
  id: true,
  amount: true,
  payable: {
    select: {
      id: true,
      outstandingAmount: true,
      purchase: { select: { id: true, purchaseNumber: true, invoiceNumber: true } },
    },
  },
};

const PAYMENT_FIELDS = {
  id: true,
  paymentNumber: true,
  paymentDate: true,
  amount: true,
  allocatedAmount: true,
  unallocatedAmount: true,
  paymentMethod: true,
  referenceNumber: true,
  notes: true,
  status: true,
  postedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  allocations: { select: ALLOCATION_FIELDS, orderBy: { createdAt: 'asc' } },
};

const LIST_FIELDS = { ...PAYMENT_FIELDS, allocations: false };

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.supplierPayment.findFirst({ where: { id, companyId }, select: PAYMENT_FIELDS });
}

/**
 * Locks the payment row for the rest of the transaction, so two concurrent
 * posts of the same payment serialise and the second sees POSTED.
 *
 * MUST be called inside a transaction.
 */
export async function lockForPosting(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM supplier_payments WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.supplierPayment.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      status: true,
      supplierId: true,
      paymentNumber: true,
      paymentDate: true,
      amount: true,
      // Needed by the journal entry: cash and bank are different accounts.
      paymentMethod: true,
      allocations: { select: { id: true, supplierPayableId: true, amount: true } },
    },
  });
}

/**
 * @param {{ skip: number, take: number, supplierId?: string, status?: string,
 *           paymentMethod?: string, search?: string, fromDate?: Date, toDate?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, supplierId, status, paymentMethod, search, fromDate, toDate },
) {
  const where = { companyId };
  if (supplierId) where.supplierId = supplierId;
  if (status) where.status = status;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (search) {
    where.OR = [
      { paymentNumber: { contains: search, mode: 'insensitive' } },
      { referenceNumber: { contains: search, mode: 'insensitive' } },
      { supplier: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (fromDate || toDate) {
    where.paymentDate = {};
    if (fromDate) where.paymentDate.gte = fromDate;
    if (toDate) where.paymentDate.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.supplierPayment.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.supplierPayment.count({ where }),
  ]);

  return { items, total };
}

export function createDraft(tx, { payment, allocations }) {
  return tx.supplierPayment.create({
    data: { ...payment, allocations: { create: allocations } },
    select: PAYMENT_FIELDS,
  });
}

/** Replaces the header and the whole allocation list of a draft. Drafts only. */
export async function updateDraft(tx, { id, companyId, payment, allocations }) {
  await tx.supplierPaymentAllocation.deleteMany({ where: { supplierPaymentId: id } });

  const result = await tx.supplierPayment.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data: payment,
  });
  if (result.count === 0) return null;

  if (allocations.length > 0) {
    await tx.supplierPaymentAllocation.createMany({
      data: allocations.map((allocation) => ({ ...allocation, supplierPaymentId: id })),
    });
  }

  return findByIdAndCompany(id, companyId, tx);
}

export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const result = await tx.supplierPayment.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

/** How much of a payable has already been settled by POSTED payments. */
export function sumPostedAllocationsForPayable(payableId, companyId, client = prisma) {
  return client.supplierPaymentAllocation.aggregate({
    where: { supplierPayableId: payableId, payment: { companyId, status: 'POSTED' } },
    _sum: { amount: true },
  });
}
