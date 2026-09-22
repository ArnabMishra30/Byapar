import { prisma } from '../../config/prisma.js';

// All Prisma access for imported bills. A bill is a STAGING record - a file, what
// a model read from it, and what a human confirmed. It is not an accounting
// document and this file touches no accounting table.

const BILL_FIELDS = {
  id: true,
  companyId: true,
  direction: true,
  status: true,
  originalFilename: true,
  mimeType: true,
  fileSize: true,
  extraction: true,
  extractionModel: true,
  extractedAt: true,
  extractionError: true,
  reviewedData: true,
  postedSourceType: true,
  postedSourceId: true,
  postedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
};

/** The storage key is deliberately NOT in BILL_FIELDS - it never reaches a browser. */
const BILL_FIELDS_WITH_KEY = { ...BILL_FIELDS, storageKey: true };

export function create(data, client = prisma) {
  return client.bill.create({ data, select: BILL_FIELDS });
}

/**
 * A bill, scoped to its company.
 *
 * companyId is a required argument rather than an optional filter, so there is
 * no way to call this and accidentally read across tenants.
 */
export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.bill.findFirst({ where: { id, companyId }, select: BILL_FIELDS });
}

/** The same, including the storage key - for the code that must open the file. */
export function findByIdAndCompanyWithKey(id, companyId, client = prisma) {
  return client.bill.findFirst({ where: { id, companyId }, select: BILL_FIELDS_WITH_KEY });
}

export function update(id, data, client = prisma) {
  return client.bill.update({ where: { id }, data, select: BILL_FIELDS });
}

export async function findMany({ companyId, skip, take, status, direction, fromDate, toDate } = {}) {
  const where = { companyId };
  if (status) where.status = status;
  if (direction) where.direction = direction;
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.bill.findMany({ where, select: BILL_FIELDS, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.bill.count({ where }),
  ]);

  return { items, total };
}

export function countByStatus(companyId) {
  return prisma.bill.groupBy({
    by: ['status'],
    where: { companyId },
    _count: { _all: true },
  });
}

export { BILL_FIELDS };
