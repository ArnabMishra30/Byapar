import { prisma } from '../../config/prisma.js';

// All Prisma access for the chart of accounts. Every method is company scoped.

const ACCOUNT_FIELDS = {
  id: true,
  code: true,
  name: true,
  type: true,
  parentId: true,
  isSystem: true,
  isActive: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  parent: { select: { id: true, code: true, name: true } },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.account.findFirst({ where: { id, companyId }, select: ACCOUNT_FIELDS });
}

/** The resolver used by the posting engine: (company, code) is the stable key. */
export function findByCodeAndCompany(code, companyId, client = prisma) {
  return client.account.findFirst({ where: { code, companyId }, select: ACCOUNT_FIELDS });
}

/**
 * Loads several accounts by id, company-scoped.
 *
 * Used by the posting engine for a line that names an account directly - an
 * expense category, which may be one the business created itself and therefore
 * has no system code.
 */
export function findManyByIds(companyId, ids, client = prisma) {
  return client.account.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, code: true, name: true, type: true, isActive: true, isSystem: true },
  });
}

/**
 * Loads several accounts by code in one query.
 * @returns {Promise<Array<{ id, code, type, isActive, isSystem, name }>>}
 */
export function findManyByCodes(companyId, codes, client = prisma) {
  return client.account.findMany({
    where: { companyId, code: { in: codes } },
    select: { id: true, code: true, name: true, type: true, isActive: true, isSystem: true },
  });
}

/**
 * Inserts accounts, silently skipping any whose (companyId, code) already
 * exists. This is what makes system-account seeding idempotent and safe to run
 * concurrently: the loser of a race inserts nothing rather than failing.
 */
export function createMany(rows, client = prisma) {
  return client.account.createMany({ data: rows, skipDuplicates: true });
}

/**
 * Attaches system accounts to their system parents.
 *
 * Separate from the insert because a parent must exist before a child can point
 * at it, and both go in with one createMany. Idempotent: an account already
 * linked is skipped, so this is safe to run on every seed.
 *
 * @param {Array<[string, string]>} pairs [childCode, parentCode]
 */
export async function linkParentsByCode(companyId, pairs, client = prisma) {
  const codes = [...new Set(pairs.flat())];

  const accounts = await client.account.findMany({
    where: { companyId, code: { in: codes } },
    select: { id: true, code: true, parentId: true },
  });

  const byCode = new Map(accounts.map((account) => [account.code, account]));

  for (const [childCode, parentCode] of pairs) {
    const child = byCode.get(childCode);
    const parent = byCode.get(parentCode);

    if (child && parent && child.parentId !== parent.id) {
      await client.account.update({ where: { id: child.id }, data: { parentId: parent.id } });
    }
  }
}

export function create(data, client = prisma) {
  return client.account.create({ data, select: ACCOUNT_FIELDS });
}

/**
 * Company-scoped update. Returns null when the row does not belong to this
 * company, so another company's account behaves exactly like a missing one.
 */
export async function update(id, companyId, data, client = prisma) {
  const result = await client.account.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, client);
}

/**
 * @param {{ skip: number, take: number, search?: string, type?: string,
 *           isActive?: boolean, isSystem?: boolean, parentId?: string }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, type, isActive, isSystem, parentId },
) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (type) where.type = type;
  if (isActive !== undefined) where.isActive = isActive;
  if (isSystem !== undefined) where.isSystem = isSystem;
  if (parentId) where.parentId = parentId;

  const [items, total] = await Promise.all([
    prisma.account.findMany({ where, select: ACCOUNT_FIELDS, orderBy: { code: 'asc' }, skip, take }),
    prisma.account.count({ where }),
  ]);

  return { items, total };
}

/** Every account of a company, used by the reports. Ordered by code. */
export function findAllByCompany(companyId, client = prisma) {
  return client.account.findMany({
    where: { companyId },
    select: { id: true, code: true, name: true, type: true, isActive: true, isSystem: true },
    orderBy: { code: 'asc' },
  });
}

/** Walks the parent chain, used to reject a cycle before it is created. */
export function findParentChainIds(companyId, startParentId, client = prisma) {
  return client.$queryRaw`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId" FROM accounts WHERE id = ${startParentId} AND "companyId" = ${companyId}
      UNION ALL
      SELECT a.id, a."parentId" FROM accounts a
        JOIN chain c ON a.id = c."parentId" AND a."companyId" = ${companyId}
    )
    SELECT id FROM chain
  `;
}

/** How many journal lines reference this account. Zero means it is unused. */
export function countJournalLines(accountId, companyId, client = prisma) {
  return client.journalLine.count({ where: { accountId, companyId } });
}

export function countChildren(accountId, companyId, client = prisma) {
  return client.account.count({ where: { parentId: accountId, companyId } });
}

/** Only ever called for an unused, non-system account. */
export async function deleteById(id, companyId, client = prisma) {
  const result = await client.account.deleteMany({ where: { id, companyId, isSystem: false } });
  return result.count > 0;
}

/**
 * The accounts that hold the business's money: the system Cash and Bank
 * accounts, plus anything a company has parented UNDER them.
 *
 * A business with three banks creates an account per bank and hangs each under
 * Bank in the chart. Resolving them through the existing parent hierarchy means
 * the cash book finds them without any code-prefix guesswork and without a new
 * "is this a bank account?" column - the chart already models it.
 *
 * With no child accounts this returns exactly the two system accounts, which is
 * what every company had before and why nothing else changes.
 */
export async function findCashAndBankAccounts(companyId, codes, client = prisma) {
  const roots = await client.account.findMany({
    where: { companyId, code: { in: codes } },
    select: ACCOUNT_FIELDS,
  });

  if (roots.length === 0) return [];

  const children = await client.account.findMany({
    where: { companyId, parentId: { in: roots.map((account) => account.id) } },
    select: ACCOUNT_FIELDS,
  });

  return [...roots, ...children];
}
