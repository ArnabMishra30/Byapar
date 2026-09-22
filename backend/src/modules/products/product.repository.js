import { prisma } from '../../config/prisma.js';

// All Prisma access for products. Every method is company scoped.
// Note: stock is NOT stored on Product. Inventory is a later phase.

// Related records are included so the API can return category/unit/tax names
// without the caller making three more requests.
const FIELDS = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  description: true,
  purchasePrice: true,
  sellingPrice: true,
  reorderLevel: true,
  isActive: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true, shortCode: true } },
  tax: {
    select: {
      id: true,
      name: true,
      rate: true,
      cgstRate: true,
      sgstRate: true,
      igstRate: true,
      cessRate: true,
      treatment: true,
      isActive: true,
    },
  },
  taxClassificationId: true,
  taxClassification: { select: { id: true, code: true, kind: true, isActive: true } },
};

export function findByIdAndCompany(id, companyId) {
  return prisma.product.findFirst({ where: { id, companyId }, select: FIELDS });
}

export function findBySkuAndCompany(sku, companyId) {
  return prisma.product.findFirst({
    where: { companyId, sku: { equals: sku, mode: 'insensitive' } },
    select: FIELDS,
  });
}

export function findByBarcodeAndCompany(barcode, companyId) {
  return prisma.product.findFirst({ where: { companyId, barcode }, select: FIELDS });
}

/**
 * @param {{ skip: number, take: number, search?: string, categoryId?: string,
 *           unitId?: string, taxId?: string, isActive?: boolean }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, categoryId, unitId, taxId, isActive },
) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (categoryId) where.categoryId = categoryId;
  if (unitId) where.unitId = unitId;
  if (taxId) where.taxId = taxId;
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, select: FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.product.count({ where }),
  ]);

  return { items, total };
}

export function create(data, client = prisma) {
  return client.product.create({ data, select: FIELDS });
}

export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.product.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findByIdAndCompany(id, companyId);
}
