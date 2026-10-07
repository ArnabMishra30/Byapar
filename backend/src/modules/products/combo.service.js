import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toDecimal, toMoneyString } from '../../utils/money.js';
import { withTransaction } from '../../config/transaction.js';
import { hasShopPermission } from '../users/shop-permissions.js';

// COMBOS: a product sold as ONE item whose contents leave stock individually.
//
//   Saved combo     "Diwali Pack" = 1 Rice 5kg + 2 Oil 1L + 1 Sugar 1kg, set up
//                   once (isCombo) and sold many times.
//   On-the-spot     made while billing, used on that bill only (isAdHoc), unless
//                   the person ticks "save for later".
//
// A combo holds NO stock. Posting a sale takes each content out of the ordinary
// stock ledger (see sales.service post), and the combo's cost is the sum of
// what those movements cost - so valuation, COGS and the journal need nothing
// new. A combo can never contain another combo.

const QTY_DP = 6;

/** "How many can I make" per warehouse, from the contents' stock. */
export async function availability(companyId, components) {
  if (components.length === 0) return { total: 0, byWarehouse: [] };

  const balances = await prisma.inventoryBalance.findMany({
    where: { companyId, productId: { in: components.map((c) => c.componentProductId ?? c.component.id) } },
    select: { productId: true, quantity: true, warehouse: { select: { id: true, name: true } } },
  });

  const warehouses = new Map();
  for (const balance of balances) warehouses.set(balance.warehouse.id, balance.warehouse);

  const byWarehouse = [...warehouses.values()].map((warehouse) => {
    let canMake = Infinity;
    for (const component of components) {
      const productId = component.componentProductId ?? component.component.id;
      const stock = balances.find((b) => b.productId === productId && b.warehouse.id === warehouse.id);
      const have = stock ? toDecimal(stock.quantity) : toDecimal(0);
      canMake = Math.min(canMake, Math.floor(have.div(component.quantity).toNumber()));
    }
    return { warehouse, canMake: Math.max(0, canMake === Infinity ? 0 : canMake) };
  });

  return { total: byWarehouse.reduce((sum, row) => sum + row.canMake, 0), byWarehouse };
}

export function toPublicComponents(product) {
  return (product.comboComponents ?? []).map((row) => ({
    productId: row.component.id,
    name: row.component.name,
    sku: row.component.sku,
    unit: row.component.unit?.shortCode ?? null,
    quantity: toMoneyString(row.quantity, 3),
  }));
}

/**
 * Checks a list of contents and returns it cleaned up: every product is this
 * company's, active, not itself a combo, and listed once.
 */
export async function validateComponents(client, companyId, components, ownId = null) {
  if (!components || components.length === 0) {
    throw ApiError.badRequest('A combo needs at least one item in it', [
      { field: 'body.components', message: 'Add at least one item' },
    ]);
  }

  const merged = new Map();
  for (const { productId, quantity } of components) {
    merged.set(productId, (merged.get(productId) ?? toDecimal(0)).plus(quantity));
  }

  const products = await client.product.findMany({
    where: { companyId, id: { in: [...merged.keys()] } },
    select: { id: true, name: true, isActive: true, isCombo: true },
  });

  for (const productId of merged.keys()) {
    const product = products.find((p) => p.id === productId);
    if (!product || productId === ownId) {
      throw ApiError.badRequest('Item not found', [{ field: 'body.components', message: 'An item in the combo was not found' }]);
    }
    if (!product.isActive) throw ApiError.business(422, 'PRODUCT_INACTIVE', `"${product.name}" is inactive`);
    if (product.isCombo) {
      throw ApiError.business(422, 'COMBO_IN_COMBO', `"${product.name}" is itself a combo. A combo cannot contain another combo.`);
    }
  }

  return [...merged.entries()].map(([productId, quantity]) => ({
    componentProductId: productId,
    quantity: quantity.toDecimalPlaces(QTY_DP),
  }));
}

/** Writes a combo's contents, replacing whatever it had. */
export async function replaceComponents(tx, companyId, comboProductId, components) {
  await tx.comboComponent.deleteMany({ where: { comboProductId } });
  await tx.comboComponent.createMany({
    data: components.map((component) => ({ ...component, companyId, comboProductId })),
  });
}

/** Where a combo with no category/unit chosen is filed: "Combos", in pieces. */
async function defaultsFor(tx, companyId) {
  let category = await tx.category.findFirst({ where: { companyId, name: { equals: 'Combos', mode: 'insensitive' } } });
  if (!category) category = await tx.category.create({ data: { companyId, name: 'Combos' } });
  const unit =
    (await tx.unit.findFirst({ where: { companyId, shortCode: 'PCS' } })) ??
    (await tx.unit.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } }));
  if (!unit) throw ApiError.business(422, 'NO_UNIT', 'Add a unit (e.g. Piece) before creating a combo');
  return { categoryId: category.id, unitId: unit.id };
}

/**
 * A combo made while billing. Saved for later only if asked AND the person may
 * manage products; otherwise it is a one-off for this bill.
 */
export async function createOnTheSpot(currentUser, input) {
  const { companyId } = currentUser;
  const saveForLater = Boolean(input.saveForLater);
  if (saveForLater && !hasShopPermission(currentUser, 'PRODUCTS_MANAGE')) {
    throw ApiError.forbidden('Only someone who can add products can save a combo for later.');
  }

  const id = await withTransaction(async (tx) => {
    const components = await validateComponents(tx, companyId, input.components);
    if (input.taxId) {
      const tax = await tx.tax.findFirst({ where: { id: input.taxId, companyId, isActive: true } });
      if (!tax) throw ApiError.badRequest('Tax not found', [{ field: 'body.taxId', message: 'Tax does not exist' }]);
    }
    const product = await tx.product.create({
      data: {
        companyId,
        name: input.name,
        sellingPrice: input.sellingPrice ?? '0',
        taxId: input.taxId ?? null,
        isCombo: true,
        isAdHoc: !saveForLater,
        ...(await defaultsFor(tx, companyId)),
      },
      select: { id: true },
    });
    await replaceComponents(tx, companyId, product.id, components);
    return product.id;
  });

  return id;
}

/** For the product service: create / update a saved combo's defaults. */
export { defaultsFor };
