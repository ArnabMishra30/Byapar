import { prisma } from '../../config/prisma.js';

// All Prisma access for HSN/SAC classifications. Every method is company scoped.

const FIELDS = {
  id: true,
  kind: true,
  code: true,
  description: true,
  defaultTaxId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  defaultTax: { select: { id: true, name: true, rate: true } },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.taxClassification.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByCodeAndCompany(code, companyId, client = prisma) {
  return client.taxClassification.findFirst({ where: { code, companyId }, select: FIELDS });
}

/**
 * @param {{ skip: number, take: number, search?: string, kind?: string, isActive?: boolean }} options
 */
export async function findManyByCompany(companyId, { skip, take, search, kind, isActive }) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (kind) where.kind = kind;
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.taxClassification.findMany({
      where,
      select: FIELDS,
      orderBy: { code: 'asc' },
      skip,
      take,
    }),
    prisma.taxClassification.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.taxClassification.create({ data, select: FIELDS });
}

/** Company-scoped update. Null when the row belongs to another company. */
export async function update(id, companyId, data, client = prisma) {
  const result = await client.taxClassification.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId, client);
}

/** How many products point at this classification. Zero means it is unused. */
export function countProducts(id, companyId, client = prisma) {
  return client.product.count({ where: { taxClassificationId: id, companyId } });
}
