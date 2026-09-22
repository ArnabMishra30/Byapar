import { prisma } from '../../config/prisma.js';

// All Prisma access for the supplier ledger. Append-only: there is deliberately
// no update and no delete here.

const ENTRY_FIELDS = {
  id: true,
  entryType: true,
  entryDate: true,
  debit: true,
  credit: true,
  referenceType: true,
  referenceId: true,
  payableId: true,
  description: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
};

/**
 * Writes one immutable ledger entry.
 *
 * The (companyId, referenceType, referenceId) unique constraint means a source
 * document can only ever produce one entry - a repeated post cannot double-count
 * a balance even if a status guard were bypassed.
 */
export function create(tx, data) {
  return tx.supplierLedgerEntry.create({ data, select: { id: true } });
}

/** Chronological entries for one supplier, oldest first, for the ledger view. */
export function findBySupplier(supplierId, companyId, { fromDate, toDate } = {}) {
  const where = { companyId, supplierId };
  if (fromDate || toDate) {
    where.entryDate = {};
    if (fromDate) where.entryDate.gte = fromDate;
    if (toDate) where.entryDate.lte = toDate;
  }

  return prisma.supplierLedgerEntry.findMany({
    where,
    select: ENTRY_FIELDS,
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Everything before `fromDate`, collapsed into one number, so a date-filtered
 * ledger can still show a correct opening balance.
 */
export function sumBySupplierBefore(supplierId, companyId, fromDate) {
  return prisma.supplierLedgerEntry.aggregate({
    where: { companyId, supplierId, entryDate: { lt: fromDate } },
    _sum: { debit: true, credit: true },
  });
}

/** Totals per entry type, used by the outstanding summary. */
export function sumBySupplierGroupedByType(supplierId, companyId) {
  return prisma.supplierLedgerEntry.groupBy({
    by: ['entryType'],
    where: { companyId, supplierId },
    _sum: { debit: true, credit: true },
  });
}
