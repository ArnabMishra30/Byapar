import { prisma } from '../../config/prisma.js';

// All Prisma access for journal entries and journal lines.
//
// APPEND-ONLY: there is deliberately no update and no delete for a posted entry
// anywhere in this file. The only writes are `createEntry` and the DRAFT-only
// `postDraftEntry`, so no code path - not even a buggy one - can rewrite history.

const LINE_FIELDS = {
  id: true,
  lineNumber: true,
  accountId: true,
  description: true,
  debit: true,
  credit: true,
  entryDate: true,
  account: { select: { id: true, code: true, name: true, type: true } },
};

const ENTRY_FIELDS = {
  id: true,
  journalNumber: true,
  entryDate: true,
  description: true,
  sourceType: true,
  sourceId: true,
  status: true,
  totalDebit: true,
  totalCredit: true,
  reversalOfId: true,
  postedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  reversalOf: { select: { id: true, journalNumber: true } },
  reversedBy: { select: { id: true, journalNumber: true } },
  lines: { select: LINE_FIELDS, orderBy: { lineNumber: 'asc' } },
};

const LIST_FIELDS = { ...ENTRY_FIELDS, lines: false };

/** Only POSTED entries count towards any balance, ledger or report. */
const POSTED = { journalEntry: { status: 'POSTED' } };

// --- writes ----------------------------------------------------------------

/**
 * Writes one entry and all of its lines.
 *
 * The (companyId, sourceType, sourceId) unique constraint means a source
 * document can produce exactly one entry: a second post fails at the database,
 * not merely at an application guard.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export function createEntry(tx, { entry, lines }) {
  return tx.journalEntry.create({
    data: { ...entry, lines: { create: lines } },
    select: ENTRY_FIELDS,
  });
}

/** The DRAFT -> POSTED transition. Guarded by status, so it can only happen once. */
export async function postDraftEntry(tx, { id, companyId, data }) {
  const result = await tx.journalEntry.updateMany({
    where: { id, companyId, status: 'DRAFT' },
    data,
  });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, tx);
}

// --- reads -----------------------------------------------------------------

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.journalEntry.findFirst({ where: { id, companyId }, select: ENTRY_FIELDS });
}

/** Answers "has this document already been journalled?" without creating one. */
export function findBySource(companyId, sourceType, sourceId, client = prisma) {
  return client.journalEntry.findFirst({
    where: { companyId, sourceType, sourceId },
    select: ENTRY_FIELDS,
  });
}

/**
 * Locks one entry for the rest of the transaction. Used by reversal so two
 * concurrent reversals of the same entry serialise.
 */
export async function lockEntry(tx, id, companyId) {
  await tx.$queryRaw`
    SELECT id FROM journal_entries WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
  `;
  return findByIdAndCompany(id, companyId, tx);
}

/**
 * @param {{ skip: number, take: number, sourceType?: string, sourceId?: string,
 *           journalNumber?: string, status?: string, accountId?: string,
 *           dateFrom?: Date, dateTo?: Date }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, sourceType, sourceId, journalNumber, status, accountId, dateFrom, dateTo },
) {
  const where = buildEntryWhere(companyId, {
    sourceType,
    sourceId,
    journalNumber,
    status,
    accountId,
    dateFrom,
    dateTo,
  });

  const [items, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.journalEntry.count({ where }),
  ]);

  return { items, total };
}

function buildEntryWhere(
  companyId,
  { sourceType, sourceId, journalNumber, status, accountId, dateFrom, dateTo },
) {
  const where = { companyId };

  if (sourceType) where.sourceType = sourceType;
  if (sourceId) where.sourceId = sourceId;
  if (journalNumber) where.journalNumber = { contains: journalNumber, mode: 'insensitive' };
  if (status) where.status = status;
  if (accountId) where.lines = { some: { accountId } };
  if (dateFrom || dateTo) {
    where.entryDate = {};
    if (dateFrom) where.entryDate.gte = dateFrom;
    if (dateTo) where.entryDate.lte = dateTo;
  }

  return where;
}

// --- line level reads (the general ledger itself) --------------------------

function buildLineWhere(companyId, { accountId, sourceType, sourceId, dateFrom, dateTo }) {
  const where = { companyId, ...POSTED };

  if (accountId) where.accountId = accountId;
  if (sourceType || sourceId) {
    where.journalEntry = { ...where.journalEntry };
    if (sourceType) where.journalEntry.sourceType = sourceType;
    if (sourceId) where.journalEntry.sourceId = sourceId;
  }
  if (dateFrom || dateTo) {
    where.entryDate = {};
    if (dateFrom) where.entryDate.gte = dateFrom;
    if (dateTo) where.entryDate.lte = dateTo;
  }

  return where;
}

const LEDGER_LINE_FIELDS = {
  id: true,
  accountId: true,
  description: true,
  debit: true,
  credit: true,
  entryDate: true,
  account: { select: { id: true, code: true, name: true, type: true } },
  journalEntry: {
    select: {
      id: true,
      journalNumber: true,
      description: true,
      sourceType: true,
      sourceId: true,
    },
  },
};

/** Posted journal lines, oldest first, for a ledger view. */
export async function findLines(companyId, { skip, take, ...filters }) {
  const where = buildLineWhere(companyId, filters);

  const [items, total] = await Promise.all([
    prisma.journalLine.findMany({
      where,
      select: LEDGER_LINE_FIELDS,
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { lineNumber: 'asc' }],
      skip,
      take,
    }),
    prisma.journalLine.count({ where }),
  ]);

  return { items, total };
}

/** Debit and credit totals per account, for the trial balance and summaries. */
export function sumLinesGroupedByAccount(companyId, { accountId, dateFrom, dateTo } = {}) {
  return prisma.journalLine.groupBy({
    by: ['accountId'],
    where: buildLineWhere(companyId, { accountId, dateFrom, dateTo }),
    _sum: { debit: true, credit: true },
  });
}

/** Everything strictly before a date, so a filtered ledger still opens correctly. */
export function sumLinesBefore(companyId, accountId, date) {
  return prisma.journalLine.aggregate({
    where: { companyId, accountId, entryDate: { lt: date }, ...POSTED },
    _sum: { debit: true, credit: true },
  });
}

/** Grand totals across the company. Used to assert debits === credits. */
export function sumAllLines(companyId, { dateFrom, dateTo } = {}) {
  return prisma.journalLine.aggregate({
    where: buildLineWhere(companyId, { dateFrom, dateTo }),
    _sum: { debit: true, credit: true },
  });
}
