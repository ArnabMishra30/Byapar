import { prisma } from '../../config/prisma.js';

// All Prisma access for storage locations. Every method is company scoped.

export const LOCATION_FIELDS = {
  id: true,
  companyId: true,
  warehouseId: true,
  name: true,
  type: true,
  code: true,
  notes: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  warehouse: { select: { id: true, name: true, code: true } },
  _count: { select: { products: true } },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.storageLocation.findFirst({ where: { id, companyId }, select: LOCATION_FIELDS });
}

export function findByNameInWarehouse(companyId, warehouseId, name, client = prisma) {
  return client.storageLocation.findFirst({
    where: { companyId, warehouseId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
}

export async function findManyByCompany(companyId, { skip, take, warehouseId, search, isActive, type }) {
  const where = { companyId };
  if (warehouseId) where.warehouseId = warehouseId;
  if (type) where.type = type;
  if (typeof isActive === 'boolean') where.isActive = isActive;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.storageLocation.findMany({
      where,
      select: LOCATION_FIELDS,
      orderBy: [{ warehouse: { name: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      skip,
      take,
    }),
    prisma.storageLocation.count({ where }),
  ]);
  return { items, total };
}

export function create(data, client = prisma) {
  return client.storageLocation.create({ data, select: LOCATION_FIELDS });
}

export function createMany(rows, client = prisma) {
  return client.storageLocation.createMany({ data: rows, skipDuplicates: true });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.storageLocation.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
