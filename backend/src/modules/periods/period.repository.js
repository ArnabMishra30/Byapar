import { prisma } from '../../config/prisma.js';

// All Prisma access for accounting periods. Every query is company scoped.

const PERIOD_FIELDS = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  closedAt: true,
  reopenedAt: true,
  reopenReason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  reopenedBy: { select: { id: true, name: true } },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.accountingPeriod.findFirst({
    where: { id, companyId },
    select: PERIOD_FIELDS,
  });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.accountingPeriod.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: PERIOD_FIELDS,
  });
}

export async function findManyByCompany(companyId, { skip, take, status } = {}) {
  const where = { companyId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.accountingPeriod.findMany({
      where,
      select: PERIOD_FIELDS,
      orderBy: [{ startDate: 'desc' }],
      skip,
      take,
    }),
    prisma.accountingPeriod.count({ where }),
  ]);

  return { items, total };
}

/**
 * Any period whose range overlaps [startDate, endDate].
 *
 * Two ranges overlap when each starts on or before the other ends. Expressed
 * that way rather than by enumerating cases, because the four-case version is
 * where off-by-one bugs live.
 */
export function findOverlapping(companyId, { startDate, endDate, excludeId = null }) {
  return prisma.accountingPeriod.findMany({
    where: {
      companyId,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: PERIOD_FIELDS,
  });
}

/**
 * The period a business date falls in, if any.
 *
 * This is THE query the posting guard runs, on every posted document, so it is
 * kept to one indexed lookup - (companyId, startDate, endDate) covers it.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [client]
 */
export function findByDate(companyId, date, client = prisma) {
  return client.accountingPeriod.findFirst({
    where: {
      companyId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true, name: true, status: true, startDate: true, endDate: true },
  });
}

/** Does this company use periods at all? One cheap count, cached per request. */
export function countByCompany(companyId, client = prisma) {
  return client.accountingPeriod.count({ where: { companyId } });
}

export function create(tx, data) {
  return tx.accountingPeriod.create({ data, select: PERIOD_FIELDS });
}

/**
 * Locks one period for the duration of a transaction, so two simultaneous
 * closes serialise and the second sees the first's result.
 */
export async function lockForUpdate(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM accounting_periods WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;

  return tx.accountingPeriod.findFirst({
    where: { id, companyId },
    select: { id: true, name: true, status: true, startDate: true, endDate: true },
  });
}

/**
 * Moves a period between statuses, but only from the status the caller expects.
 *
 * `updateMany` with `status: fromStatus` in the WHERE makes the transition
 * conditional at the database rather than in code: a second concurrent close
 * matches no rows and gets null back.
 */
export async function updateStatus(tx, { id, companyId, fromStatus, data }) {
  const { count } = await tx.accountingPeriod.updateMany({
    where: { id, companyId, status: fromStatus },
    data,
  });

  if (count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

/** Whether a company has switched on the stricter "no period, no posting" rule. */
export async function requiresOpenPeriod(companyId, client = prisma) {
  const settings = await client.companySettings.findFirst({
    where: { companyId },
    select: { requireOpenPeriod: true },
  });

  return settings?.requireOpenPeriod ?? false;
}
