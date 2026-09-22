import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import {
  add,
  subtract,
  multiply,
  divide,
  round,
  toDecimal,
  toMoneyString,
  isGreaterThan,
  isZero,
} from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import { assertStockChangeAllowed, companyToday } from '../periods/period-guard.service.js';
import * as inventoryRepository from './inventory.repository.js';
import * as productRepository from '../products/product.repository.js';
import * as warehouseRepository from '../warehouses/warehouse.repository.js';

// Inventory business rules. No Prisma calls here.
//
// PRECISION (see docs/architecture.md):
//   quantity              Decimal(18,6), serialized with 3 decimals
//   unitCost, averageCost Decimal(18,4), serialized with 4 decimals
//   totalCost, value      Decimal(18,4), serialized with 2 decimals
// Intermediate arithmetic keeps full Decimal precision; rounding happens once,
// when a value is stored or serialized.

const QUANTITY_DP = 6;
const COST_DP = 4;

export const REFERENCE_TYPE = {
  OPENING_STOCK: 'OPENING_STOCK',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
};

// --- serialization ---------------------------------------------------------

export function toPublicBalance(balance) {
  return {
    id: balance.id,
    product: {
      id: balance.product.id,
      name: balance.product.name,
      sku: balance.product.sku,
    },
    warehouse: {
      id: balance.warehouse.id,
      name: balance.warehouse.name,
      code: balance.warehouse.code,
    },
    quantity: toMoneyString(balance.quantity, 3),
    averageCost: toMoneyString(balance.averageCost, 4),
    // quantity * averageCost, computed with Decimal and rounded once, here.
    inventoryValue: toMoneyString(multiply(balance.quantity, balance.averageCost), 2),
    updatedAt: balance.updatedAt,
  };
}

export function toPublicMovement(movement) {
  return {
    id: movement.id,
    type: movement.type,
    product: { id: movement.product.id, name: movement.product.name, sku: movement.product.sku },
    warehouse: { id: movement.warehouse.id, name: movement.warehouse.name, code: movement.warehouse.code },
    quantity: toMoneyString(movement.quantity, 3),
    unitCost: toMoneyString(movement.unitCost, 4),
    totalCost: toMoneyString(movement.totalCost, 2),
    quantityBefore: toMoneyString(movement.quantityBefore, 3),
    quantityAfter: toMoneyString(movement.quantityAfter, 3),
    averageCostBefore: toMoneyString(movement.averageCostBefore, 4),
    averageCostAfter: toMoneyString(movement.averageCostAfter, 4),
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    notes: movement.notes,
    createdAt: movement.createdAt,
    createdBy: { id: movement.createdBy.id, name: movement.createdBy.name },
  };
}

// --- the costing rule ------------------------------------------------------

/**
 * Moving weighted average.
 *
 *   newAverage = (oldQty * oldAvg + inQty * inCost) / (oldQty + inQty)
 *
 * With no previous stock the incoming cost simply becomes the average.
 * Rounded once, to the stored precision.
 */
export function calculateMovingAverageCost(oldQuantity, oldAverageCost, inQuantity, inUnitCost) {
  const newQuantity = add(oldQuantity, inQuantity);

  // No stock before, or the quantities cancel out: the incoming cost is the average.
  if (isZero(newQuantity) || !isGreaterThan(oldQuantity, 0)) {
    return round(toDecimal(inUnitCost), COST_DP);
  }

  const oldValue = multiply(oldQuantity, oldAverageCost);
  const inValue = multiply(inQuantity, inUnitCost);

  return round(divide(add(oldValue, inValue), newQuantity), COST_DP);
}

// --- validation ------------------------------------------------------------

/**
 * A stock operation needs a product and a warehouse that both exist in this
 * company AND are active. Phase 2 allowed inactive master data to be selected;
 * inventory enforces it now, as specified.
 */
async function assertProductAndWarehouseUsable(companyId, productId, warehouseId) {
  const [product, warehouse] = await Promise.all([
    productRepository.findByIdAndCompany(productId, companyId),
    warehouseRepository.findByIdAndCompany(warehouseId, companyId),
  ]);

  // Another company's id is reported exactly like a non-existent one.
  if (!product) {
    throw ApiError.badRequest('Product not found', [
      { field: 'body.productId', message: 'Product does not exist in this company' },
    ]);
  }
  if (!warehouse) {
    throw ApiError.badRequest('Warehouse not found', [
      { field: 'body.warehouseId', message: 'Warehouse does not exist in this company' },
    ]);
  }
  if (!product.isActive) {
    throw ApiError.business(422, 'PRODUCT_INACTIVE', 'Cannot record stock for an inactive product');
  }
  if (!warehouse.isActive) {
    throw ApiError.business(422, 'WAREHOUSE_INACTIVE', 'Cannot record stock for an inactive warehouse');
  }

  return { product, warehouse };
}

// --- writes ----------------------------------------------------------------

/**
 * Applies one stock movement and updates the balance, inside a transaction the
 * CALLER owns.
 *
 * Every stock-changing operation in this system goes through here, so the
 * invariant "a balance change always has a matching movement row" holds by
 * construction. The purchase service calls this directly with its own `tx`, so a
 * purchase posting and its stock movements commit or roll back together - and so
 * the moving weighted average lives in exactly one place.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} params
 * @param {'IN'|'OUT'} params.direction
 */
export async function applyMovementWithinTransaction(
  tx,
  {
    currentUser,
    productId,
    warehouseId,
    type,
    direction,
    quantity,
    unitCost,
    referenceType,
    referenceId = null,
    notes = null,
    requireNoExistingBalance = false,
    outUnitCostOverride = null,
  },
) {
  const { companyId, id: userId } = currentUser;

  return (async () => {
    // Locks the row for the duration of the transaction. Null when this is the
    // first ever movement for this product+warehouse.
    const existing = await inventoryRepository.lockBalance(tx, companyId, productId, warehouseId);

    if (requireNoExistingBalance && existing) {
      throw ApiError.business(
        409,
        'OPENING_STOCK_ALREADY_EXISTS',
        'Opening stock has already been recorded for this product and warehouse. Use a stock adjustment instead.',
      );
    }

    const quantityBefore = existing ? existing.quantity : toDecimal(0);
    const averageCostBefore = existing ? existing.averageCost : toDecimal(0);

    let quantityAfter;
    let averageCostAfter;
    let movementUnitCost;

    if (direction === 'IN') {
      quantityAfter = add(quantityBefore, quantity);
      averageCostAfter = calculateMovingAverageCost(
        quantityBefore,
        averageCostBefore,
        quantity,
        unitCost,
      );
      movementUnitCost = round(toDecimal(unitCost), COST_DP);
    } else {
      if (isGreaterThan(quantity, quantityBefore)) {
        throw ApiError.business(
          422,
          'INSUFFICIENT_STOCK',
          `Insufficient stock: ${toMoneyString(quantityBefore, 3)} available, ${toMoneyString(quantity, 3)} requested`,
        );
      }

      quantityAfter = subtract(quantityBefore, quantity);
      // Stock leaving never changes the average cost of what remains.
      averageCostAfter = round(toDecimal(averageCostBefore), COST_DP);

      // Normally outgoing stock is valued at the current average. A purchase
      // return is the one exception: goods go back to the supplier at the price
      // that supplier charged, which is the cost recorded on the original
      // purchase line - not today's blended average. The caller must pass that
      // cost explicitly; it is never guessed here.
      movementUnitCost = round(
        toDecimal(outUnitCostOverride ?? averageCostBefore),
        COST_DP,
      );
    }

    const roundedQuantityAfter = round(quantityAfter, QUANTITY_DP);

    if (existing) {
      await inventoryRepository.updateBalance(tx, existing.id, {
        quantity: roundedQuantityAfter,
        averageCost: averageCostAfter,
      });
    } else {
      await inventoryRepository.createBalance(tx, {
        companyId,
        productId,
        warehouseId,
        quantity: roundedQuantityAfter,
        averageCost: averageCostAfter,
      });
    }

    return inventoryRepository.createMovement(tx, {
      companyId,
      productId,
      warehouseId,
      type,
      quantity: round(toDecimal(quantity), QUANTITY_DP),
      unitCost: movementUnitCost,
      totalCost: round(multiply(quantity, movementUnitCost), COST_DP),
      quantityBefore: round(quantityBefore, QUANTITY_DP),
      quantityAfter: roundedQuantityAfter,
      averageCostBefore: round(averageCostBefore, COST_DP),
      averageCostAfter,
      referenceType,
      referenceId,
      notes,
      createdById: userId,
    });
  })();
}

/**
 * Stock arriving from a posted purchase. A thin, explicitly named wrapper so the
 * purchase service never has to know about movement directions or averaging.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export function applyStockInWithinTransaction(tx, params) {
  return applyMovementWithinTransaction(tx, { ...params, type: 'STOCK_IN', direction: 'IN' });
}

/**
 * Stock leaving for a posted purchase return.
 *
 * `outUnitCostOverride` must be the unit cost from the original purchase line, so
 * the movement records what the supplier is being credited. The average cost of
 * the remaining stock is left unchanged, exactly as for any other stock-out.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export function applyStockOutWithinTransaction(tx, params) {
  return applyMovementWithinTransaction(tx, { ...params, type: 'STOCK_OUT', direction: 'OUT' });
}

/**
 * Opens its own transaction. Used by the two endpoints in this module.
 *
 * These are the only stock changes that write NO journal entry, so they never
 * reach the guard in the posting path. They are checked here instead - against
 * the company's today, because a stock movement carries no business date of its
 * own. Document flows call applyMovementWithinTransaction directly with their
 * own transaction and are guarded at the journal, so nothing is checked twice.
 */
async function applyMovement(params) {
  const date = await companyToday(params.currentUser.companyId);

  return withRetryableTransaction(async (tx) => {
    await assertStockChangeAllowed(tx, params.currentUser.companyId, date, 'This stock movement');
    return applyMovementWithinTransaction(tx, params);
  });
}

/**
 * Records the stock a business already had when it started using the system.
 *
 * Rejected when a balance already exists for that product and warehouse, so an
 * accidental second call can never silently overwrite real stock. Adding stock
 * later is a stock adjustment, which is auditable as such.
 */
export async function createOpeningStock(currentUser, input) {
  await assertProductAndWarehouseUsable(currentUser.companyId, input.productId, input.warehouseId);

  const movement = await applyMovement({
    currentUser,
    productId: input.productId,
    warehouseId: input.warehouseId,
    type: 'OPENING_STOCK',
    direction: 'IN',
    quantity: input.quantity,
    unitCost: input.unitCost,
    referenceType: REFERENCE_TYPE.OPENING_STOCK,
    notes: input.notes ?? null,
    requireNoExistingBalance: true,
  });

  return toPublicMovement(movement);
}

/** Manual correction: physical count, damage, shrinkage. */
export async function createAdjustment(currentUser, input) {
  await assertProductAndWarehouseUsable(currentUser.companyId, input.productId, input.warehouseId);

  const isIncoming = input.type === 'ADJUSTMENT_IN';

  const movement = await applyMovement({
    currentUser,
    productId: input.productId,
    warehouseId: input.warehouseId,
    type: input.type,
    direction: isIncoming ? 'IN' : 'OUT',
    quantity: input.quantity,
    // For an outgoing adjustment the cost is the current average, resolved
    // inside the transaction - the caller does not get to choose it.
    unitCost: isIncoming ? input.unitCost : null,
    referenceType: REFERENCE_TYPE.STOCK_ADJUSTMENT,
    notes: input.notes ?? null,
  });

  return toPublicMovement(movement);
}

// --- reads -----------------------------------------------------------------

export async function listBalances(currentUser, query) {
  const { page, limit, productId, warehouseId } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await inventoryRepository.listBalancesByCompany(currentUser.companyId, {
    skip,
    take,
    productId,
    warehouseId,
  });

  return {
    balances: items.map(toPublicBalance),
    pagination: buildPagination({ page, limit, total }),
  };
}

/**
 * A product+warehouse with no movements yet has no balance row. That is not an
 * error - it is zero stock - so a zero balance is returned instead of a 404.
 * The product and warehouse themselves must still exist in this company.
 */
export async function getBalance(currentUser, productId, warehouseId) {
  const { product, warehouse } = await assertExistsForRead(
    currentUser.companyId,
    productId,
    warehouseId,
  );

  const balance = await inventoryRepository.findBalance(
    currentUser.companyId,
    productId,
    warehouseId,
  );

  if (balance) return toPublicBalance(balance);

  return {
    id: null,
    product: { id: product.id, name: product.name, sku: product.sku },
    warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code },
    quantity: '0.000',
    averageCost: '0.0000',
    inventoryValue: '0.00',
    updatedAt: null,
  };
}

/** Reads allow inactive master data: history must stay visible. */
async function assertExistsForRead(companyId, productId, warehouseId) {
  const [product, warehouse] = await Promise.all([
    productRepository.findByIdAndCompany(productId, companyId),
    warehouseRepository.findByIdAndCompany(warehouseId, companyId),
  ]);

  if (!product || !warehouse) throw ApiError.notFound('Inventory record not found');

  return { product, warehouse };
}

export async function listMovements(currentUser, query) {
  const { page, limit, productId, warehouseId, type, fromDate, toDate } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await inventoryRepository.listMovementsByCompany(currentUser.companyId, {
    skip,
    take,
    productId,
    warehouseId,
    type,
    fromDate,
    toDate,
  });

  return {
    movements: items.map(toPublicMovement),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getMovement(currentUser, id) {
  const movement = await inventoryRepository.findMovementByIdAndCompany(id, currentUser.companyId);
  if (!movement) throw ApiError.notFound('Stock movement not found');
  return toPublicMovement(movement);
}
