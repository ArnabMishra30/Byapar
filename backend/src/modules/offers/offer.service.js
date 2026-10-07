import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toDecimal, toMoneyString } from '../../utils/money.js';
import { quantitySchema } from '../../utils/validation.js';

// OFFERS: "Buy 1 get 1 free", "Buy 2 Soap get 1 Brush free", ...
//
// An offer is applied BY THE SERVER whenever a sale is saved: the free lines
// are worked out from the paid quantities, so a bill can never carry more free
// goods than the offer allows, whatever the screen sent. A free line is an
// ordinary sale line at price 0 - it leaves stock through the same ledger, and
// its cost is frozen at posting like any other, so profit stays honest.
//
// One offer per bought product applies (the newest active one); offers do not
// stack. A free item can be given by hand too (isFree without an offer), which
// needs the discount permission - see sales.service.

const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const positive = (label) =>
  quantitySchema(label).refine((value) => Number(value) > 0, { message: `${label} must be more than zero` });

export const offerBodySchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    buyProductId: z.string().uuid('Invalid buyProductId'),
    buyQuantity: positive('Buy quantity'),
    freeProductId: z.string().uuid('Invalid freeProductId'),
    freeQuantity: positive('Free quantity'),
    startDate: businessDate.nullable().optional(),
    endDate: businessDate.nullable().optional(),
  })
  .strict()
  .refine((o) => !o.startDate || !o.endDate || o.startDate <= o.endDate, {
    message: 'The offer cannot end before it starts',
    path: ['endDate'],
  });

const FIELDS = {
  id: true,
  name: true,
  buyQuantity: true,
  freeQuantity: true,
  startDate: true,
  endDate: true,
  isActive: true,
  createdAt: true,
  buyProduct: { select: { id: true, name: true, isCombo: true } },
  freeProduct: { select: { id: true, name: true, isCombo: true } },
};

const qty = (value) => toMoneyString(value, 3).replace(/\.?0+$/, '');
const dateOnly = (value) => (value ? value.toISOString().slice(0, 10) : null);

export function toPublicOffer(offer, today = null) {
  const running =
    offer.isActive &&
    (!today || ((!offer.startDate || offer.startDate <= today) && (!offer.endDate || offer.endDate >= today)));
  return {
    id: offer.id,
    name: offer.name,
    buyProduct: offer.buyProduct,
    buyQuantity: toMoneyString(offer.buyQuantity, 3),
    freeProduct: offer.freeProduct,
    freeQuantity: toMoneyString(offer.freeQuantity, 3),
    startDate: dateOnly(offer.startDate),
    endDate: dateOnly(offer.endDate),
    isActive: offer.isActive,
    /** Active and inside its dates today. */
    isRunning: running,
  };
}

/** "Buy 1 Soap, get 1 Soap free" - what a shopkeeper would write. */
function defaultName(buy, buyQuantity, free, freeQuantity) {
  return `Buy ${qty(buyQuantity)} ${buy.name}, get ${qty(freeQuantity)} ${free.name} free`;
}

async function requireProducts(companyId, input) {
  const products = await prisma.product.findMany({
    where: { companyId, id: { in: [input.buyProductId, input.freeProductId] }, isAdHoc: false },
    select: { id: true, name: true, isActive: true },
  });
  const buy = products.find((p) => p.id === input.buyProductId);
  const free = products.find((p) => p.id === input.freeProductId);
  if (!buy || !free) {
    throw ApiError.badRequest('Product not found', [{ field: 'body.buyProductId', message: 'Choose items from your own products' }]);
  }
  return { buy, free };
}

export async function list(currentUser, { activeOnly = false } = {}) {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const offers = await prisma.offer.findMany({
    where: { companyId: currentUser.companyId, ...(activeOnly ? { isActive: true } : {}) },
    select: FIELDS,
    orderBy: { createdAt: 'desc' },
  });
  return offers.map((offer) => toPublicOffer(offer, today));
}

export async function create(currentUser, input) {
  const { companyId } = currentUser;
  const { buy, free } = await requireProducts(companyId, input);
  const offer = await prisma.offer.create({
    data: {
      companyId,
      name: input.name || defaultName(buy, input.buyQuantity, free, input.freeQuantity),
      buyProductId: buy.id,
      buyQuantity: input.buyQuantity,
      freeProductId: free.id,
      freeQuantity: input.freeQuantity,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    },
    select: FIELDS,
  });
  return toPublicOffer(offer);
}

export async function setStatus(currentUser, id, isActive) {
  const result = await prisma.offer.updateMany({ where: { id, companyId: currentUser.companyId }, data: { isActive } });
  if (result.count === 0) throw ApiError.business(404, 'OFFER_NOT_FOUND', 'Offer not found');
  return toPublicOffer(await prisma.offer.findUnique({ where: { id }, select: FIELDS }));
}

// --- applying offers to a sale ---------------------------------------------------

/**
 * The lines to store for a sale, with offers applied.
 *
 *   - paid lines are kept as they are;
 *   - free lines given by hand (isFree, no offerId) are kept, at price 0;
 *   - free lines that came from an offer are thrown away and worked out again
 *     from the paid quantities, so they can never be inflated or stale.
 *
 * @param {Array<{ input, product, tax, index }>} resolvedItems
 * @param {(productId: string) => Promise<object>} loadProduct the full product, for a free line it adds
 */
export async function applyOffers(companyId, invoiceDate, resolvedItems, loadProduct) {
  const paid = resolvedItems.filter((item) => !item.input.isFree);
  const manualFree = resolvedItems.filter((item) => item.input.isFree && !item.input.offerId);

  const paidQty = new Map();
  for (const item of paid) {
    paidQty.set(item.product.id, (paidQty.get(item.product.id) ?? toDecimal(0)).plus(item.input.quantity));
  }

  const offers = paidQty.size
    ? await prisma.offer.findMany({
        where: {
          companyId,
          isActive: true,
          buyProductId: { in: [...paidQty.keys()] },
          AND: [
            { OR: [{ startDate: null }, { startDate: { lte: invoiceDate } }] },
            { OR: [{ endDate: null }, { endDate: { gte: invoiceDate } }] },
          ],
          freeProduct: { isActive: true },
        },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  // productId -> { quantity, offerId, product }
  const free = new Map();
  for (const item of manualFree) {
    const current = free.get(item.product.id);
    free.set(item.product.id, {
      quantity: (current?.quantity ?? toDecimal(0)).plus(item.input.quantity),
      offerId: null,
      product: item.product,
      storageLocationId: item.input.storageLocationId ?? null,
    });
  }

  const used = new Set();
  for (const offer of offers) {
    if (used.has(offer.buyProductId)) continue; // newest offer per product only
    used.add(offer.buyProductId);
    const times = Math.floor(paidQty.get(offer.buyProductId).div(offer.buyQuantity).toNumber());
    if (times < 1) continue;
    const quantity = toDecimal(offer.freeQuantity).times(times);
    const current = free.get(offer.freeProductId);
    free.set(offer.freeProductId, {
      quantity: (current?.quantity ?? toDecimal(0)).plus(quantity),
      // A line that is part offer, part by hand is recorded as the offer's.
      offerId: offer.id,
      product: current?.product ?? (await loadProduct(offer.freeProductId)),
      storageLocationId: current?.storageLocationId ?? null,
    });
  }

  const freeLines = [...free.values()].map((line) => ({
    input: {
      productId: line.product.id,
      quantity: line.quantity.toFixed(6),
      unitPrice: '0',
      discountType: 'NONE',
      isFree: true,
      offerId: line.offerId,
      storageLocationId: line.storageLocationId,
    },
    product: line.product,
    tax: null,
  }));

  return [...paid, ...freeLines].map((item, index) => ({ ...item, index }));
}

// --- the report ----------------------------------------------------------------

/** Free goods given away in a period: per offer, and by hand per person. */
export async function report(currentUser, { fromDate, toDate }) {
  const where = {
    isFree: true,
    salesInvoice: {
      companyId: currentUser.companyId,
      status: 'POSTED',
      ...(fromDate || toDate
        ? { invoiceDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {}),
    },
  };
  const lines = await prisma.salesInvoiceItem.findMany({
    where,
    select: {
      quantity: true,
      cogsAmount: true,
      productNameSnapshot: true,
      offer: { select: { id: true, name: true } },
      salesInvoice: { select: { createdBy: { select: { id: true, name: true } } } },
    },
  });

  const groups = new Map();
  for (const line of lines) {
    const key = line.offer ? `offer:${line.offer.id}` : `hand:${line.salesInvoice.createdBy.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        kind: line.offer ? 'OFFER' : 'BY_HAND',
        label: line.offer ? line.offer.name : `Given by hand - ${line.salesInvoice.createdBy.name}`,
        timesGiven: 0,
        items: new Map(),
        cost: toDecimal(0),
      });
    }
    const group = groups.get(key);
    group.timesGiven += 1;
    group.cost = group.cost.plus(line.cogsAmount);
    group.items.set(line.productNameSnapshot, (group.items.get(line.productNameSnapshot) ?? toDecimal(0)).plus(line.quantity));
  }

  const rows = [...groups.values()].map((group) => ({
    kind: group.kind,
    label: group.label,
    timesGiven: group.timesGiven,
    itemsGiven: [...group.items.entries()].map(([name, quantity]) => ({ name, quantity: toMoneyString(quantity, 3) })),
    // What the free goods cost the shop, at the cost they left stock at.
    cost: toMoneyString(group.cost, 2),
  }));
  rows.sort((a, b) => Number(b.cost) - Number(a.cost));
  return {
    rows,
    totalCost: toMoneyString(rows.reduce((sum, row) => sum.plus(row.cost), toDecimal(0)), 2),
  };
}
