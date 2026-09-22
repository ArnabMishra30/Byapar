import { prisma } from '../../config/prisma.js';

// All Prisma access for purchases. Every method is company scoped.

const ITEM_FIELDS = {
  id: true,
  lineNumber: true,
  productId: true,
  taxId: true,
  quantity: true,
  unitCost: true,
  discountType: true,
  discountValue: true,
  discountAmount: true,
  taxableAmount: true,
  taxAmount: true,
  lineTotal: true,
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

const PURCHASE_FIELDS = {
  id: true,
  purchaseNumber: true,
  invoiceNumber: true,
  invoiceDate: true,
  dueDate: true,
  status: true,
  subtotal: true,
  discountTotal: true,
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
  supplierNameSnapshot: true,
  notes: true,
  postedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
};

// The list does not need every line of every purchase.
const LIST_FIELDS = { ...PURCHASE_FIELDS, items: false };

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.purchase.findFirst({ where: { id, companyId }, select: PURCHASE_FIELDS });
}

export function findBySupplierInvoiceNumber(companyId, supplierId, invoiceNumber) {
  return prisma.purchase.findFirst({
    where: { companyId, supplierId, invoiceNumber: { equals: invoiceNumber, mode: 'insensitive' } },
    select: { id: true, status: true, purchaseNumber: true },
  });
}

/**
 * Locks the purchase row for the rest of the transaction, then returns it with
 * its items. This is what makes double-posting impossible: a second concurrent
 * request waits here, and then sees status = POSTED.
 *
 * MUST be called inside a transaction.
 */
export async function lockForPosting(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM purchases WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.purchase.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      status: true,
      supplierId: true,
      warehouseId: true,
      purchaseNumber: true,
      // Needed by the payable raised when this purchase is posted, and by the
      // journal entry written in the same transaction.
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      grandTotal: true,
      // The GST snapshot, so posting can assert the document's tax invariants
      // and the journal can post the right component accounts.
      supplyType: true,
      cgstTotal: true,
      sgstTotal: true,
      igstTotal: true,
      cessTotal: true,
      invoiceDate: true,
      dueDate: true,
      items: { select: ITEM_FIELDS, orderBy: { lineNumber: 'asc' } },
    },
  });
}

/**
 * @param {{ skip: number, take: number, search?: string, supplierId?: string,
 *           warehouseId?: string, status?: string, fromDate?: Date, toDate?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, supplierId, warehouseId, status, fromDate, toDate },
) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { purchaseNumber: { contains: search, mode: 'insensitive' } },
      { supplierNameSnapshot: { contains: search, mode: 'insensitive' } },
      { supplier: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (supplierId) where.supplierId = supplierId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.invoiceDate = {};
    if (fromDate) where.invoiceDate.gte = fromDate;
    if (toDate) where.invoiceDate.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.purchase.count({ where }),
  ]);

  return { items, total };
}

/** Creates the purchase and all of its items together. */
export function createDraft(tx, { purchase, items }) {
  return tx.purchase.create({
    data: { ...purchase, items: { create: items } },
    select: PURCHASE_FIELDS,
  });
}

/**
 * Replaces the header fields and the entire item list of a draft.
 *
 * Items are deleted and recreated rather than diffed: a purchase line has no
 * identity a user cares about, and a full replace is far easier to reason about
 * than a partial patch. Only drafts ever reach here.
 */
export async function updateDraft(tx, { id, companyId, purchase, items }) {
  await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });

  const result = await tx.purchase.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data: purchase,
  });
  if (result.count === 0) return null;

  await tx.purchaseItem.createMany({ data: items.map((item) => ({ ...item, purchaseId: id })) });

  return findByIdAndCompany(id, companyId, tx);
}

/**
 * Moves the purchase to a new status only if it is still in `fromStatus`.
 * Returns null when it is not, which the service turns into a business error.
 */
export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const result = await tx.purchase.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

/** Used by tests and future payable reporting: what a supplier is owed. */
export function sumPostedTotalsBySupplier(companyId, supplierId) {
  return prisma.purchase.aggregate({
    where: { companyId, supplierId, status: 'POSTED' },
    _sum: { grandTotal: true },
  });
}
