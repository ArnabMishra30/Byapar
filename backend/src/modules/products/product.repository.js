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
  storageLocationId: true,
  storageLocation: {
    select: { id: true, name: true, code: true, type: true, warehouse: { select: { id: true, name: true } } },
  },
  isCombo: true,
  isAdHoc: true,
  comboComponents: {
    select: {
      quantity: true,
      component: { select: { id: true, name: true, sku: true, isActive: true, unit: { select: { shortCode: true } } } },
    },
    orderBy: { component: { name: 'asc' } },
  },
};

export function findByIdAndCompany(id, companyId) {
  return prisma.product.findFirst({ where: { id, companyId }, select: FIELDS });
}

/** Case-insensitive, because a bill prints "RICE 5KG" and the shop typed "Rice 5kg". */
export function findByNameAndCompany(name, companyId) {
  return prisma.product.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: FIELDS,
  });
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
 * Just enough of every product to match a bill line against, and nothing else.
 *
 * ONE QUERY, NOT ONE PER LINE. A bill has a dozen lines and a catalogue has
 * hundreds of products; comparing names is work for memory, not for a loop of
 * round trips to PostgreSQL.
 */
export function findAllForMatching(companyId) {
  return prisma.product.findMany({
    // Saved combos can be matched like any product; one-off combos made on a
    // single bill cannot.
    where: { companyId, isActive: true, isAdHoc: false },
    select: { id: true, name: true, sku: true, barcode: true },
    orderBy: { name: 'asc' },
    take: 2000,
  });
}

/**
 * @param {{ skip: number, take: number, search?: string, categoryId?: string,
 *           unitId?: string, taxId?: string, isActive?: boolean }} options
 */
export async function findManyByCompany(
  companyId,
  { skip, take, search, categoryId, unitId, taxId, isActive, kind },
) {
  // A combo made on the spot for one bill never shows up in lists or pickers.
  const where = { companyId, isAdHoc: false };
  if (kind === 'COMBO') where.isCombo = true;
  if (kind === 'ITEM') where.isCombo = false;

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
