import { prisma } from '../../config/prisma.js';

// All Prisma access for customers. Every method is company scoped.

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
  return prisma.customer.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findByNameAndCompany(name, companyId) {
  return prisma.customer.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
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
    prisma.customer.findMany({ where, select: FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.customer.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.customer.create({ data, select: FIELDS });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.customer.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
