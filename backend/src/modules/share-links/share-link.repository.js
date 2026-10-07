import { prisma } from '../../config/prisma.js';

// All Prisma access for share links. Owner-side methods are company scoped; the
// one public lookup is by the unguessable token, and everything it then reads is
// scoped to the company that token belongs to.

const LINK_FIELDS = {
  id: true,
  companyId: true,
  kind: true,
  token: true,
  salesInvoiceId: true,
  customerId: true,
  supplierId: true,
  includeAccount: true,
  createdAt: true,
  revokedAt: true,
  viewCount: true,
  firstViewedAt: true,
  lastViewedAt: true,
};

export function findByToken(token) {
  return prisma.shareLink.findUnique({ where: { token }, select: LINK_FIELDS });
}

export function findByIdAndCompany(id, companyId) {
  return prisma.shareLink.findFirst({ where: { id, companyId }, select: LINK_FIELDS });
}

/** The active link for exactly this target, if the shop already made one. */
export function findActive(companyId, { kind, salesInvoiceId = null, customerId = null, supplierId = null, includeAccount = false }) {
  return prisma.shareLink.findFirst({
    where: { companyId, kind, salesInvoiceId, customerId, supplierId, includeAccount, revokedAt: null },
    select: LINK_FIELDS,
    orderBy: { createdAt: 'desc' },
  });
}

export function findManyByCompany(companyId, { salesInvoiceId, customerId, supplierId }) {
  const where = { companyId };
  if (salesInvoiceId) where.salesInvoiceId = salesInvoiceId;
  if (customerId) where.customerId = customerId;
  if (supplierId) where.supplierId = supplierId;
  return prisma.shareLink.findMany({ where, select: LINK_FIELDS, orderBy: { createdAt: 'desc' }, take: 50 });
}

export function create(data) {
  return prisma.shareLink.create({ data, select: LINK_FIELDS });
}

export async function revoke(id, companyId, userId) {
  await prisma.shareLink.updateMany({
    where: { id, companyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: userId },
  });
  return findByIdAndCompany(id, companyId);
}

/** Seen-tracking. One atomic update; firstViewedAt is set only once. */
export async function recordView(id, firstViewedAt) {
  const now = new Date();
  await prisma.shareLink.update({
    where: { id },
    data: { viewCount: { increment: 1 }, lastViewedAt: now, ...(firstViewedAt ? {} : { firstViewedAt: now }) },
  });
}

// --- what the recipient sees -------------------------------------------------

export function findShop(companyId) {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, legalName: true, phone: true, email: true, city: true, gstin: true },
  });
}

export function findCustomerName(companyId, customerId) {
  return prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true, name: true } });
}

export function findSupplierName(companyId, supplierId) {
  return prisma.supplier.findFirst({ where: { id: supplierId, companyId }, select: { id: true, name: true } });
}

/** An invoice, only if it belongs to this company (and, when given, this customer). */
export function findInvoice(companyId, salesInvoiceId, customerId = null) {
  return prisma.salesInvoice.findFirst({
    where: { id: salesInvoiceId, companyId, ...(customerId ? { customerId } : {}) },
    select: {
      id: true,
      customerId: true,
      createdById: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      status: true,
      customerNameSnapshot: true,
      buyerGstin: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      grandTotal: true,
      cgstTotal: true,
      sgstTotal: true,
      igstTotal: true,
      cessTotal: true,
      notes: true,
      items: {
        orderBy: { lineNumber: 'asc' },
        select: {
          lineNumber: true,
          productNameSnapshot: true,
          unitNameSnapshot: true,
          hsnCodeSnapshot: true,
          quantity: true,
          unitPrice: true,
          discountAmount: true,
          taxRateSnapshot: true,
          taxAmount: true,
          lineTotal: true,
          isFree: true,
          components: { select: { productNameSnapshot: true, quantityPerUnit: true }, orderBy: { productNameSnapshot: 'asc' } },
        },
      },
    },
  });
}

export function findReceivable(companyId, salesInvoiceId) {
  return prisma.customerReceivable.findFirst({
    where: { companyId, salesInvoiceId },
    select: { paidAmount: true, creditAmount: true, outstandingAmount: true },
  });
}
