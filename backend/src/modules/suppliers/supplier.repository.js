import { prisma } from '../../config/prisma.js';

// All Prisma access for suppliers. Every method is company scoped.

const FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  gstin: true,
  stateCode: true,
  gstRegistrationType: true,
  openingBalance: true,
  creditLimit: true,
  creditDays: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

export function findByIdAndCompany(id, companyId) {
  return prisma.supplier.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.supplier.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
  });
}

/** Just enough of every supplier to match a bill's party against. One query. */
export function findAllForMatching(companyId) {
  return prisma.supplier.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, gstin: true, phone: true },
    orderBy: { name: 'asc' },
    take: 2000,
  });
}

export async function findManyByCompany(companyId, { skip, take, search, isActive }) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { gstin: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.supplier.findMany({ where, select: FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.supplier.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.supplier.create({ data, select: FIELDS });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.supplier.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
