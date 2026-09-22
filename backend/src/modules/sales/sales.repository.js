import { prisma } from '../../config/prisma.js';

// All Prisma access for sales invoices. Every method is company scoped.

const ITEM_FIELDS = {
  id: true,
  lineNumber: true,
  productId: true,
  taxId: true,
  quantity: true,
  unitPrice: true,
  discountType: true,
  discountValue: true,
  discountAmount: true,
  taxableAmount: true,
  taxAmount: true,
  lineTotal: true,
  cogsUnitCost: true,
  cogsAmount: true,
  productNameSnapshot: true,
  skuSnapshot: true,
  unitNameSnapshot: true,
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

const SALE_FIELDS = {
  id: true,
  invoiceNumber: true,
  invoiceDate: true,
  dueDate: true,
  creditLimitOverride: true,
  creditLimitOverrideReason: true,
  creditLimitOverrideExposure: true,
  status: true,
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
  notes: true,
  postedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
};

const LIST_FIELDS = { ...SALE_FIELDS, items: false };

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.salesInvoice.findFirst({ where: { id, companyId }, select: SALE_FIELDS });
}

/**
 * Locks the invoice row for the rest of the transaction. A second concurrent
 * post waits here and then sees status = POSTED.
 *
 * MUST be called inside a transaction.
 */
export async function lockForPosting(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM sales_invoices WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.salesInvoice.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      status: true,
      customerId: true,
      warehouseId: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
  creditLimitOverride: true,
  creditLimitOverrideReason: true,
  creditLimitOverrideExposure: true,
      // Needed by the receivable raised when this invoice is posted, and by the
      // journal entry written in the same transaction.
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      grandTotal: true,
      supplyType: true,
      cgstTotal: true,
      sgstTotal: true,
      igstTotal: true,
      cessTotal: true,
      items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
    },
  });
}

/**
 * @param {{ skip: number, take: number, search?: string, customerId?: string,
 *           warehouseId?: string, status?: string, fromDate?: Date, toDate?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, customerId, warehouseId, status, fromDate, toDate },
) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { customerNameSnapshot: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (customerId) where.customerId = customerId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.invoiceDate = {};
    if (fromDate) where.invoiceDate.gte = fromDate;
    if (toDate) where.invoiceDate.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.salesInvoice.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.salesInvoice.count({ where }),
  ]);

  return { items, total };
}

export function createDraft(tx, { salesInvoice, items }) {
  return tx.salesInvoice.create({
    data: { ...salesInvoice, items: { create: items } },
    select: SALE_FIELDS,
  });
}

/** Replaces the header and the whole item list of a draft. Drafts only. */
export async function updateDraft(tx, { id, companyId, salesInvoice, items }) {
  await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: id } });

  const result = await tx.salesInvoice.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data: salesInvoice,
  });
  if (result.count === 0) return null;

  await tx.salesInvoiceItem.createMany({
    data: items.map((item) => ({ ...item, salesInvoiceId: id })),
  });

  return findByIdAndCompany(id, companyId, tx);
}

/** Writes the COGS resolved by the inventory service onto one posted line. */
export function setItemCogs(tx, id, { cogsUnitCost, cogsAmount }) {
  return tx.salesInvoiceItem.update({
    where: { id },
    data: { cogsUnitCost, cogsAmount },
    select: { id: true },
  });
}

export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const result = await tx.salesInvoice.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}
