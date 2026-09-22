import { prisma } from '../../config/prisma.js';

// All Prisma access for taxes. Every method is company scoped.

const FIELDS = {
  id: true,
  name: true,
  rate: true,
  type: true,
  cgstRate: true,
  sgstRate: true,
  igstRate: true,
  cessRate: true,
  treatment: true,
  effectiveFrom: true,
  effectiveTo: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

export function findByIdAndCompany(id, companyId) {
  return prisma.tax.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.tax.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
  });
}

export async function findManyByCompany(companyId, { skip, take, search, isActive, type }) {
  const where = { companyId };

  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (typeof isActive === 'boolean') where.isActive = isActive;
  if (type) where.type = type;

  const [items, total] = await Promise.all([
    prisma.tax.findMany({ where, select: FIELDS, orderBy: { rate: 'asc' }, skip, take }),
    prisma.tax.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.tax.create({ data, select: FIELDS });
}

/** Used by company initialization to insert the default GST slabs. */
export function createMany(data, client = prisma) {
  return client.tax.createMany({ data, skipDuplicates: true });
}

export function countByCompany(companyId, client = prisma) {
  return client.tax.count({ where: { companyId } });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.tax.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
