import { prisma } from '../../config/prisma.js';

// All Prisma access for categories. Every method is company scoped.

const FIELDS = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

export function findByIdAndCompany(id, companyId) {
  return prisma.category.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.category.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
  });
}

/** @param {{ skip: number, take: number, search?: string, isActive?: boolean }} options */
export async function findManyByCompany(companyId, { skip, take, search, isActive }) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.category.findMany({ where, select: FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.category.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.category.create({ data, select: FIELDS });
}

export function createMany(data, client = prisma) {
  return client.category.createMany({ data, skipDuplicates: true });
}

/** Returns null when the record belongs to another company. */
export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.category.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
