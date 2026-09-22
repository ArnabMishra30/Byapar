import { prisma } from '../../config/prisma.js';

// All Prisma access for warehouses. Every method is company scoped.
// Master data only: no stock quantities live here.

const FIELDS = {
  id: true,
  name: true,
  code: true,
  address: true,
  stateCode: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

export function findByIdAndCompany(id, companyId) {
  return prisma.warehouse.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.warehouse.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
  });
}

export function findByCodeAndCompany(code, companyId) {
  return prisma.warehouse.findFirst({
    where: { companyId, code: { equals: code, mode: 'insensitive' } },
    select: FIELDS,
  });
}

export async function findManyByCompany(companyId, { skip, take, search, isActive }) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.warehouse.findMany({ where, select: FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.warehouse.count({ where }),
  ]);

  return { items, total };
}

export function createMany(data, client = prisma) {
  return client.warehouse.createMany({ data, skipDuplicates: true });
}

export function create(data, client = prisma) {
  return client.warehouse.create({ data, select: FIELDS });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.warehouse.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
