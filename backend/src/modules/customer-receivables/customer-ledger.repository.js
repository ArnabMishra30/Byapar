import { prisma } from '../../config/prisma.js';

// All Prisma access for the customer ledger. Append-only: there is deliberately
// no update and no delete here.

const ENTRY_FIELDS = {
  id: true,
  entryType: true,
  entryDate: true,
  debit: true,
  credit: true,
  referenceType: true,
  referenceId: true,
  receivableId: true,
  description: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
};

/**
 * Writes one immutable ledger entry.
 *
 * The (companyId, referenceType, referenceId) unique constraint means a source
 * document can only ever produce one entry, so a repeated post cannot
 * double-count a balance even if a status guard were bypassed.
 */
export function create(tx, data) {
  return tx.customerLedgerEntry.create({ data, select: { id: true } });
}

/** Chronological entries for one customer, oldest first. */
export function findByCustomer(customerId, companyId, { fromDate, toDate } = {}) {
  const where = { companyId, customerId };
  if (fromDate || toDate) {
    where.entryDate = {};
    if (fromDate) where.entryDate.gte = fromDate;
    if (toDate) where.entryDate.lte = toDate;
  }

  return prisma.customerLedgerEntry.findMany({
    where,
    select: ENTRY_FIELDS,
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });
}

/** Everything before `fromDate`, so a filtered ledger still opens correctly. */
export function sumByCustomerBefore(customerId, companyId, fromDate) {
  return prisma.customerLedgerEntry.aggregate({
    where: { companyId, customerId, entryDate: { lt: fromDate } },
    _sum: { debit: true, credit: true },
  });
}

/** Totals per entry type, used by the outstanding summary. */
export function sumByCustomerGroupedByType(customerId, companyId) {
  return prisma.customerLedgerEntry.groupBy({
    by: ['entryType'],
    where: { companyId, customerId },
    _sum: { debit: true, credit: true },
  });
}
