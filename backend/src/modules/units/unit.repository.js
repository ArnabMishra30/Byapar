import { prisma } from '../../config/prisma.js';

// All Prisma access for units. Every method is company scoped.

const FIELDS = {
  id: true,
  name: true,
  shortCode: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

export function findByIdAndCompany(id, companyId) {
  return prisma.unit.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.unit.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
  });
}

export function findByShortCodeAndCompany(shortCode, companyId) {
  return prisma.unit.findFirst({
    where: { companyId, shortCode: { equals: shortCode, mode: 'insensitive' } },
    select: FIELDS,
  });
}

export async function findManyByCompany(companyId, { skip, take, search, isActive }) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { shortCode: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.unit.findMany({ where, select: FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.unit.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.unit.create({ data, select: FIELDS });
}

/** Used by company initialization to insert the default units. */
export function createMany(data, client = prisma) {
  return client.unit.createMany({ data, skipDuplicates: true });
}

export function countByCompany(companyId, client = prisma) {
  return client.unit.count({ where: { companyId } });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.unit.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
