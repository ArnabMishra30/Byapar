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

// Statuses that mean an import is live - in progress or already recorded - as
// opposed to FAILED or CANCELLED, which are abandoned and must not block a
// fresh re-upload of the same file.
const LIVE_STATUSES = ['UPLOADED', 'PROCESSING', 'REVIEW', 'POSTED'];

/**
 * A non-abandoned bill in the SAME company carrying this checksum, if any (M3).
 *
 * Company-scoped, so one shop's file can never match another's. FAILED and
 * CANCELLED bills are ignored on purpose: re-uploading after a failed read or a
 * cancellation is expected and must proceed.
 */
export function findLiveBillByChecksum(companyId, checksum, client = prisma) {
  if (!checksum) return null;
  return client.bill.findFirst({
    where: { companyId, checksum, status: { in: LIVE_STATUSES } },
    select: { id: true, status: true, direction: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * POSTED bills in the same company from the same file (checksum) and direction,
 * excluding the one being posted (M4). The caller compares each one's posted
 * document to the document about to be posted to decide if it is the same
 * invoice.
 */
export function findPostedBillsByChecksum(companyId, checksum, direction, excludeBillId, client = prisma) {
  if (!checksum) return [];
  return client.bill.findMany({
    where: { companyId, checksum, direction, status: 'POSTED', id: { not: excludeBillId } },
    select: { id: true, postedSourceType: true, postedSourceId: true },
  });
}

/** One bill's checksum. Kept out of BILL_FIELDS, which never reaches a browser. */
export function findChecksum(id, companyId, client = prisma) {
  return client.bill.findFirst({ where: { id, companyId }, select: { checksum: true } });
}

/**
 * Claims a posting fingerprint for a bill (M4). The (companyId, postingFingerprint)
 * unique index means that if another bill record already claimed this invoice,
 * the write throws P2002 - the atomic guard against two concurrent confirmations
 * posting the same invoice. Re-claiming the same value on the same bill (a retry)
 * is a no-op, not a conflict.
 */
export function reservePostingFingerprint(id, postingFingerprint, client = prisma) {
  return client.bill.update({ where: { id }, data: { postingFingerprint }, select: { id: true } });
}

/** The bill that currently holds a posting fingerprint, for a duplicate reference. */
export function findByPostingFingerprint(companyId, postingFingerprint, client = prisma) {
  return client.bill.findFirst({
    where: { companyId, postingFingerprint },
    select: { id: true, postedSourceType: true, postedSourceId: true },
  });
}

export { BILL_FIELDS };
