import { prisma } from '../../config/prisma.js';

// All Prisma access for purchase returns. Every method is company scoped.

const ITEM_FIELDS = {
  id: true,
  lineNumber: true,
  purchaseItemId: true,
  productId: true,
  quantity: true,
  unitCost: true,
  lineTotal: true,
  productNameSnapshot: true,
  skuSnapshot: true,
  taxAmount: true,
  taxRateSnapshot: true,
  hsnCodeSnapshot: true,
  taxTreatmentSnapshot: true,
  cgstRateSnapshot: true,
  sgstRateSnapshot: true,
  igstRateSnapshot: true,
  cessRateSnapshot: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  cessAmount: true,
};

const RETURN_FIELDS = {
  id: true,
  returnNumber: true,
  returnDate: true,
  status: true,
  reason: true,
  notes: true,
  taxableTotal: true,
  taxTotal: true,
  grandTotal: true,
  sellerGstin: true,
  sellerStateCode: true,
  buyerGstin: true,
  buyerStateCode: true,
  placeOfSupplyStateCode: true,
  supplyType: true,
  cgstTotal: true,
  sgstTotal: true,
  igstTotal: true,
  cessTotal: true,
  postedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  warehouse: { select: { id: true, name: true, code: true } },
  purchase: {
    select: {
      id: true,
      purchaseNumber: true,
      invoiceNumber: true,
      status: true,
      supplierNameSnapshot: true,
      supplier: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
};

const LIST_FIELDS = { ...RETURN_FIELDS, items: false };

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.purchaseReturn.findFirst({ where: { id, companyId }, select: RETURN_FIELDS });
}

/**
 * Locks the return row for the rest of the transaction, so two concurrent posts
 * of the SAME return serialise and the second sees POSTED.
 *
 * MUST be called inside a transaction.
 */
export async function lockForPosting(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM purchase_returns WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.purchaseReturn.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      status: true,
      purchaseId: true,
      warehouseId: true,
      returnNumber: true,
      // Needed by the supplier credit raised when this return is posted.
      taxableTotal: true,
      taxTotal: true,
      grandTotal: true,
      supplyType: true,
      cgstTotal: true,
      sgstTotal: true,
      igstTotal: true,
      cessTotal: true,
      returnDate: true,
      items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
    },
  });
}

/**
 * @param {{ skip: number, take: number, search?: string, purchaseId?: string,
 *           warehouseId?: string, status?: string, fromDate?: Date, toDate?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, purchaseId, warehouseId, status, fromDate, toDate },
) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { returnNumber: { contains: search, mode: 'insensitive' } },
      { reason: { contains: search, mode: 'insensitive' } },
      { purchase: { purchaseNumber: { contains: search, mode: 'insensitive' } } },
      { purchase: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      { purchase: { supplierNameSnapshot: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (purchaseId) where.purchaseId = purchaseId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.returnDate = {};
    if (fromDate) where.returnDate.gte = fromDate;
    if (toDate) where.returnDate.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.purchaseReturn.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: [{ returnDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.purchaseReturn.count({ where }),
  ]);

  return { items, total };
}

export function createDraft(tx, { purchaseReturn, items }) {
  return tx.purchaseReturn.create({
    data: { ...purchaseReturn, items: { create: items } },
    select: RETURN_FIELDS,
  });
}

/** Replaces the header and the whole item list of a draft. Drafts only. */
export async function updateDraft(tx, { id, companyId, purchaseReturn, items }) {
  await tx.purchaseReturnItem.deleteMany({ where: { purchaseReturnId: id } });

  const result = await tx.purchaseReturn.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data: purchaseReturn,
  });
  if (result.count === 0) return null;

  await tx.purchaseReturnItem.createMany({
    data: items.map((item) => ({ ...item, purchaseReturnId: id })),
  });

  return findByIdAndCompany(id, companyId, tx);
}

export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const result = await tx.purchaseReturn.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

/**
 * How much of each purchase line has already been returned.
 *
 * Only POSTED returns count. A draft reserves nothing: two drafts may each ask
 * for the last 20 units, and whichever is posted first wins - the other fails at
 * posting rather than being silently blocked at draft time.
 *
 * @param {string} [excludeReturnId] ignore this return, so re-posting arithmetic
 *   never counts the document being posted against itself
 * @returns {Promise<Map<string, import('@prisma/client').Prisma.Decimal>>}
 *   keyed by purchaseItemId
 */
export async function sumPostedReturnedQuantities(
  purchaseId,
  companyId,
  { excludeReturnId } = {},
  client = prisma,
) {
  const rows = await client.purchaseReturnItem.groupBy({
    by: ['purchaseItemId'],
    where: {
      purchaseReturn: {
        purchaseId,
        companyId,
        status: 'POSTED',
        ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
      },
    },
    _sum: { quantity: true },
  });

  return new Map(rows.map((row) => [row.purchaseItemId, row._sum.quantity]));
}
