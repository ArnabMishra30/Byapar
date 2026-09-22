import { prisma } from '../../config/prisma.js';

// All Prisma access for sales returns. Every method is company scoped.

const ITEM_FIELDS = {
  id: true,
  lineNumber: true,
  salesInvoiceItemId: true,
  productId: true,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  taxableAmount: true,
  taxAmount: true,
  lineTotal: true,
  cogsUnitCost: true,
  cogsAmount: true,
  productNameSnapshot: true,
  skuSnapshot: true,
  taxNameSnapshot: true,
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
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  grandTotal: true,
  cogsTotal: true,
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
  customerNameSnapshot: true,
  postedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  salesInvoice: {
    select: { id: true, invoiceNumber: true, invoiceDate: true, status: true },
  },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
};

const LIST_FIELDS = { ...RETURN_FIELDS, items: false };

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.salesReturn.findFirst({ where: { id, companyId }, select: RETURN_FIELDS });
}

/**
 * Locks the return row for the rest of the transaction, so two concurrent posts
 * of the SAME return serialise and the second sees POSTED.
 *
 * MUST be called inside a transaction.
 */
export async function lockForPosting(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM sales_returns WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.salesReturn.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      status: true,
      salesInvoiceId: true,
      customerId: true,
      warehouseId: true,
      returnNumber: true,
      returnDate: true,
      grandTotal: true,
      // The GST snapshot copied from the invoice, so the credit note reverses
      // the tax the invoice actually charged.
      supplyType: true,
      sellerStateCode: true,
      buyerStateCode: true,
      placeOfSupplyStateCode: true,
      items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
    },
  });
}

/**
 * @param {{ skip: number, take: number, search?: string, salesInvoiceId?: string,
 *           customerId?: string, status?: string, fromDate?: Date, toDate?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, salesInvoiceId, customerId, status, fromDate, toDate },
) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { returnNumber: { contains: search, mode: 'insensitive' } },
      { reason: { contains: search, mode: 'insensitive' } },
      { customerNameSnapshot: { contains: search, mode: 'insensitive' } },
      { salesInvoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (salesInvoiceId) where.salesInvoiceId = salesInvoiceId;
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.returnDate = {};
    if (fromDate) where.returnDate.gte = fromDate;
    if (toDate) where.returnDate.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.salesReturn.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: [{ returnDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.salesReturn.count({ where }),
  ]);

  return { items, total };
}

export function createDraft(tx, { salesReturn, items }) {
  return tx.salesReturn.create({
    data: { ...salesReturn, items: { create: items } },
    select: RETURN_FIELDS,
  });
}

/** Replaces the header and the whole item list of a draft. Drafts only. */
export async function updateDraft(tx, { id, companyId, salesReturn, items }) {
  await tx.salesReturnItem.deleteMany({ where: { salesReturnId: id } });

  const result = await tx.salesReturn.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data: salesReturn,
  });
  if (result.count === 0) return null;

  await tx.salesReturnItem.createMany({
    data: items.map((item) => ({ ...item, salesReturnId: id })),
  });

  return findByIdAndCompany(id, companyId, tx);
}

export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const result = await tx.salesReturn.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

/**
 * How much of each invoice line has already been returned.
 *
 * Only POSTED returns count. A draft reserves nothing: two drafts may each ask
 * for the last units, and whichever is posted first wins - the other fails at
 * posting rather than being silently blocked at draft time.
 *
 * @param {string} [excludeReturnId] ignore this return, so re-posting arithmetic
 *   never counts the document being posted against itself
 * @returns {Promise<Map<string, import('@prisma/client').Prisma.Decimal>>}
 *   keyed by salesInvoiceItemId
 */
export async function sumPostedReturnedQuantities(
  salesInvoiceId,
  companyId,
  { excludeReturnId } = {},
  client = prisma,
) {
  const rows = await client.salesReturnItem.groupBy({
    by: ['salesInvoiceItemId'],
    where: {
      salesReturn: {
        salesInvoiceId,
        companyId,
        status: 'POSTED',
        ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
      },
    },
    _sum: { quantity: true },
  });

  return new Map(rows.map((row) => [row.salesInvoiceItemId, row._sum.quantity]));
}
