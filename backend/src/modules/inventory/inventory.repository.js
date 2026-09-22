import { prisma } from '../../config/prisma.js';

// All Prisma access for inventory. Every method is company scoped.
//
// Two tables are owned here:
//   inventory_balances - current quantity and average cost per product+warehouse
//   stock_movements    - the append-only ledger

const BALANCE_FIELDS = {
  id: true,
  quantity: true,
  averageCost: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  // reorderLevel travels with the balance so a list can show what is running
  // low without a second query per row.
  product: { select: { id: true, name: true, sku: true, isActive: true, reorderLevel: true } },
  warehouse: { select: { id: true, name: true, code: true, isActive: true } },
};

const MOVEMENT_FIELDS = {
  id: true,
  type: true,
  quantity: true,
  unitCost: true,
  totalCost: true,
  quantityBefore: true,
  quantityAfter: true,
  averageCostBefore: true,
  averageCostAfter: true,
  referenceType: true,
  referenceId: true,
  notes: true,
  createdAt: true,
  product: { select: { id: true, name: true, sku: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  // Only the fields needed to say who did it. Never the email or password hash.
  createdBy: { select: { id: true, name: true } },
};

// --- balances --------------------------------------------------------------

export function findBalance(companyId, productId, warehouseId, client = prisma) {
  return client.inventoryBalance.findFirst({
    where: { companyId, productId, warehouseId },
    select: BALANCE_FIELDS,
  });
}

/**
 * Takes a PostgreSQL row lock on the balance, then returns it.
 *
 * MUST be called inside a transaction. Any other transaction touching the same
 * product+warehouse blocks here until this one commits or rolls back, which is
 * what prevents two concurrent adjustments from both reading quantity=100 and
 * both writing quantity=110.
 *
 * Returns null when no balance exists yet. No row means no lock is possible -
 * the unique constraint plus withRetryableTransaction handles that race instead.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function lockBalance(tx, companyId, productId, warehouseId) {
  await tx.$queryRaw`
    SELECT id FROM inventory_balances
    WHERE "companyId" = ${companyId}
      AND "productId" = ${productId}
      AND "warehouseId" = ${warehouseId}
    FOR UPDATE
  `;

  // Re-read through Prisma so quantity and averageCost come back as Decimals.
  return tx.inventoryBalance.findFirst({
    where: { companyId, productId, warehouseId },
    select: { id: true, quantity: true, averageCost: true },
  });
}

export function createBalance(tx, data) {
  return tx.inventoryBalance.create({ data, select: { id: true } });
}

export function updateBalance(tx, id, data) {
  return tx.inventoryBalance.update({ where: { id }, data, select: { id: true } });
}

/** @param {{ skip: number, take: number, productId?: string, warehouseId?: string }} options */
export async function listBalancesByCompany(companyId, { skip, take, productId, warehouseId }) {
  const where = { companyId };
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;

  const [items, total] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where,
      select: BALANCE_FIELDS,
      orderBy: [{ product: { name: 'asc' } }, { warehouse: { name: 'asc' } }],
      skip,
      take,
    }),
    prisma.inventoryBalance.count({ where }),
  ]);

  return { items, total };
}

// --- movements -------------------------------------------------------------

/** Movements are only ever created. There is deliberately no update or delete. */
export function createMovement(tx, data) {
  return tx.stockMovement.create({ data, select: MOVEMENT_FIELDS });
}

export function findMovementByIdAndCompany(id, companyId) {
  return prisma.stockMovement.findFirst({ where: { id, companyId }, select: MOVEMENT_FIELDS });
}

/**
 * @param {{ skip: number, take: number, productId?: string, warehouseId?: string,
 *           type?: string, fromDate?: Date, toDate?: Date }} options
 */
export async function listMovementsByCompany(
  companyId,
  { skip, take, productId, warehouseId, type, fromDate, toDate },
) {
  const where = { companyId };
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (type) where.type = type;
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      select: MOVEMENT_FIELDS,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return { items, total };
}

/** Used by the consistency check: the ledger, not the cached balance. */
export function sumMovementQuantities(companyId, productId, warehouseId) {
  return prisma.stockMovement.groupBy({
    by: ['type'],
    where: { companyId, productId, warehouseId },
    _sum: { quantity: true },
  });
}
