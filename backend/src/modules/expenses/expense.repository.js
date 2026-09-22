import { prisma } from '../../config/prisma.js';

// All Prisma access for expenses. Every method is company scoped.

const EXPENSE_FIELDS = {
  id: true,
  expenseNumber: true,
  expenseDate: true,
  status: true,
  amount: true,
  description: true,
  paymentMode: true,
  referenceNumber: true,
  notes: true,
  categoryNameSnapshot: true,
  paymentAccountNameSnapshot: true,
  supplierNameSnapshot: true,
  expenseAccountId: true,
  paymentAccountId: true,
  supplierId: true,
  postedAt: true,
  cancelledAt: true,
  reversedAt: true,
  createdAt: true,
  updatedAt: true,
  expenseAccount: { select: { id: true, code: true, name: true, type: true } },
  paymentAccount: { select: { id: true, code: true, name: true, type: true } },
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  reversedBy: { select: { id: true, name: true } },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.expense.findFirst({ where: { id, companyId }, select: EXPENSE_FIELDS });
}

/**
 * Locks the expense row for the rest of the transaction. A second concurrent
 * post waits here and then sees the status it was changed to.
 *
 * MUST be called inside a transaction.
 */
export async function lockForPosting(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM expenses WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.expense.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      status: true,
      expenseNumber: true,
      expenseDate: true,
      amount: true,
      expenseAccountId: true,
      paymentAccountId: true,
      categoryNameSnapshot: true,
      paymentAccountNameSnapshot: true,
    },
  });
}

/**
 * @param {{ skip: number, take: number, search?: string, status?: string,
 *           expenseAccountId?: string, paymentMode?: string,
 *           paymentAccountId?: string, supplierId?: string,
 *           fromDate?: Date, toDate?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  {
    skip,
    take,
    search,
    status,
    expenseAccountId,
    paymentMode,
    paymentAccountId,
    supplierId,
    fromDate,
    toDate,
  },
) {
  const where = buildWhere(companyId, {
    status,
    expenseAccountId,
    paymentMode,
    paymentAccountId,
    supplierId,
    fromDate,
    toDate,
  });

  if (search) {
    where.OR = [
      { expenseNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { referenceNumber: { contains: search, mode: 'insensitive' } },
      { categoryNameSnapshot: { contains: search, mode: 'insensitive' } },
      { supplierNameSnapshot: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      select: EXPENSE_FIELDS,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.expense.count({ where }),
  ]);

  return { items, total };
}

/** The filter every listing and every total in the expense report shares. */
export function buildWhere(
  companyId,
  { status, expenseAccountId, paymentMode, paymentAccountId, supplierId, fromDate, toDate },
) {
  const where = { companyId };

  if (status) where.status = status;
  if (expenseAccountId) where.expenseAccountId = expenseAccountId;
  if (paymentMode) where.paymentMode = paymentMode;
  if (paymentAccountId) where.paymentAccountId = paymentAccountId;
  if (supplierId) where.supplierId = supplierId;

  if (fromDate || toDate) {
    where.expenseDate = {};
    if (fromDate) where.expenseDate.gte = fromDate;
    if (toDate) where.expenseDate.lte = toDate;
  }

  return where;
}

export function createDraft(tx, data) {
  return tx.expense.create({ data, select: EXPENSE_FIELDS });
}

/**
 * Replaces a draft. Guarded by status, so an expense that was posted or
 * cancelled between the read and the write is never edited.
 */
export async function updateDraft(tx, { id, companyId, data }) {
  const result = await tx.expense.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

/** A status transition, guarded by the status it must be coming from. */
export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const result = await tx.expense.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

// --- reporting aggregates --------------------------------------------------

/**
 * Totals for a filtered set of expenses.
 *
 * `status` is supplied by the caller: the report deliberately totals POSTED
 * expenses only, and counts drafts and cancelled ones separately so they are
 * visible without ever reaching a financial figure.
 */
export async function sumByCompany(companyId, filters) {
  const where = buildWhere(companyId, filters);

  const [aggregate, count] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.count({ where }),
  ]);

  return { amount: aggregate._sum.amount, documentCount: count };
}

/** Expenses grouped by their category account. */
export function groupByCategory(companyId, filters) {
  return prisma.expense.groupBy({
    by: ['expenseAccountId', 'categoryNameSnapshot'],
    where: buildWhere(companyId, filters),
    _sum: { amount: true },
    _count: { _all: true },
  });
}

/** Expenses grouped by how they were paid. */
export function groupByPaymentMode(companyId, filters) {
  return prisma.expense.groupBy({
    by: ['paymentMode'],
    where: buildWhere(companyId, filters),
    _sum: { amount: true },
    _count: { _all: true },
  });
}

/** Expenses grouped by the account the money left. */
export function groupByPaymentAccount(companyId, filters) {
  return prisma.expense.groupBy({
    by: ['paymentAccountId', 'paymentAccountNameSnapshot'],
    where: buildWhere(companyId, filters),
    _sum: { amount: true },
    _count: { _all: true },
  });
}

/** Expenses grouped by business date, for a trend. */
export function groupByDate(companyId, filters) {
  return prisma.expense.groupBy({
    by: ['expenseDate'],
    where: buildWhere(companyId, filters),
    _sum: { amount: true },
    _count: { _all: true },
  });
}

/** Counts per status, so drafts and cancelled expenses stay visible. */
export function countByStatus(companyId, filters) {
  const { status, ...rest } = filters;
  void status;

  return prisma.expense.groupBy({
    by: ['status'],
    where: buildWhere(companyId, rest),
    _sum: { amount: true },
    _count: { _all: true },
  });
}
