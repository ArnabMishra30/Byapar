import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// COMBOS. Two kinds - one saved in advance, one made while billing - and for
// both, stock is managed ONLY through the ordinary stock ledger:
//   - a combo holds no stock; selling it takes each content out;
//   - not enough of any content refuses the whole bill, and nothing moves;
//   - the combo's cost is what its contents cost; the journal balances;
//   - a return puts the contents back at the cost they left at;
//   - editing a saved combo never changes a bill already posted;
//   - a combo cannot be bought, stock-adjusted, or put inside another combo;
//   - the price may be changed on the bill, and every change is traceable.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';
const STAFF_PASSWORD = 'staff-password-1';

let owner;
let cashier;
let otherShop;
let ctx;

async function product(name, sellingPrice) {
  const res = await request(app).post('/api/v1/products').set(auth(owner)).send({
    name,
    categoryId: ctx.categoryId,
    unitId: ctx.unitId,
    sellingPrice,
  });
  return res.body.data.product.id;
}

async function stock(productId, quantity, unitCost) {
  await request(app).post('/api/v1/inventory/opening-stock').set(auth(owner)).send({
    productId,
    warehouseId: ctx.warehouseId,
    quantity,
    unitCost,
  });
}

const balance = async (productId) =>
  (await prisma.inventoryBalance.findFirst({ where: { productId, warehouseId: ctx.warehouseId } }))?.quantity.toString();

async function sell(token, items, { post = true } = {}) {
  const created = await request(app).post('/api/v1/sales').set(auth(token)).send({
    customerId: ctx.customerId,
    warehouseId: ctx.warehouseId,
    invoiceDate: '2026-10-07',
    items,
  });
  if (!post || created.status !== 201) return created;
  return request(app).post(`/api/v1/sales/${created.body.data.sale.id}/post`).set(auth(token));
}

beforeAll(async () => {
  await resetDatabase();
  const company = await createCompanyWithUsers('combo');
  const b = await createCompanyWithUsers('combob');
  owner = await login(app, company.admin.email, PASSWORD);
  otherShop = await login(app, b.admin.email, PASSWORD);

  const category = await request(app).post('/api/v1/categories').set(auth(owner)).send({ name: 'Grocery' });
  const unit = await request(app).post('/api/v1/units').set(auth(owner)).send({ name: 'Piece', shortCode: 'PCS' });
  const warehouse = await request(app).post('/api/v1/warehouses').set(auth(owner)).send({ name: 'Shop', code: 'SH' });
  const customer = await request(app).post('/api/v1/customers').set(auth(owner)).send({ name: 'Combo Buyer' });
  ctx = {
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    warehouseId: warehouse.body.data.warehouse.id,
    customerId: customer.body.data.customer.id,
  };

  ctx.rice = await product('Rice 5kg', '400');
  ctx.oil = await product('Oil 1L', '200');
  ctx.sugar = await product('Sugar 1kg', '50');
  await stock(ctx.rice, '10', '300');
  await stock(ctx.oil, '15', '150');
  await stock(ctx.sugar, '8', '40');

  await request(app).post('/api/v1/users').set(auth(owner)).send({
    email: 'combo-cashier@test.test',
    password: STAFF_PASSWORD,
    name: 'Combo Cashier',
    role: 'STAFF',
    shopRole: 'CASHIER',
  });
  cashier = await login(app, 'combo-cashier@test.test', STAFF_PASSWORD);
});

describe('a saved combo', () => {
  it('is created with its contents, holds no stock, and says how many can be made', async () => {
    const res = await request(app).post('/api/v1/products').set(auth(owner)).send({
      name: 'Diwali Pack',
      isCombo: true,
      sellingPrice: '999',
      components: [
        { productId: ctx.rice, quantity: '1' },
        { productId: ctx.oil, quantity: '2' },
        { productId: ctx.sugar, quantity: '1' },
      ],
    });
    expect(res.status).toBe(201);
    const pack = res.body.data.product;
    expect(pack.isCombo).toBe(true);
    expect(pack.components).toHaveLength(3);
    // 10 rice, 15 oil / 2 = 7, 8 sugar  ->  7 packs.
    expect(pack.availability.total).toBe(7);
    ctx.pack = pack.id;
  });

  it('selling 3 takes 3 rice, 6 oil and 3 sugar out of the ordinary stock ledger', async () => {
    const posted = await sell(owner, [{ productId: ctx.pack, quantity: '3', unitPrice: '999' }]);
    expect(posted.status).toBe(200);
    ctx.packSale = posted.body.data.sale;

    expect([await balance(ctx.rice), await balance(ctx.oil), await balance(ctx.sugar)]).toEqual(['7', '9', '5']);
    expect(await prisma.inventoryBalance.count({ where: { productId: ctx.pack } })).toBe(0);

    const movements = await prisma.stockMovement.findMany({ where: { referenceId: ctx.packSale.id } });
    expect(movements).toHaveLength(3);
    expect(movements[0].notes).toContain('Diwali Pack');
  });

  it('costs what its contents cost, and the journal balances', async () => {
    const line = ctx.packSale.items[0];
    // per pack: 300 + 2*150 + 40 = 640; 3 packs = 1920
    expect(line.cogsAmount).toBe('1920.00');
    expect(line.components.map((c) => c.quantity).sort()).toEqual(['3.000', '3.000', '6.000']);

    const entry = await prisma.journalEntry.findFirst({
      where: { sourceType: 'SALES_INVOICE', sourceId: ctx.packSale.id },
      include: { lines: true },
    });
    const debit = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const credit = entry.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(debit).toBeCloseTo(credit, 4);
  });

  it('can be sold with one of its contents on the same bill', async () => {
    const posted = await sell(owner, [
      { productId: ctx.pack, quantity: '1', unitPrice: '999' },
      { productId: ctx.oil, quantity: '1', unitPrice: '200' },
    ]);
    expect(posted.status).toBe(200);
    // 9 oil - 2 (pack) - 1 (alone) = 6
    expect(await balance(ctx.oil)).toBe('6');
  });

  it('refuses the whole bill when any content is short, and nothing moves', async () => {
    const before = await prisma.stockMovement.count();
    const res = await sell(owner, [{ productId: ctx.pack, quantity: '4', unitPrice: '999' }]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SALE_INSUFFICIENT_STOCK');
    expect(res.body.message).toContain('Oil 1L');
    expect(await prisma.stockMovement.count()).toBe(before);
  });

  it('a return puts the contents back at the cost they left at', async () => {
    const line = ctx.packSale.items[0];
    const created = await request(app).post('/api/v1/sales-returns').set(auth(owner)).send({
      salesInvoiceId: ctx.packSale.id,
      returnDate: '2026-10-07',
      items: [{ salesInvoiceItemId: line.id, quantity: '1' }],
    });
    expect(created.status).toBe(201);
    const oilBefore = Number(await balance(ctx.oil));
    const posted = await request(app).post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`).set(auth(owner));
    expect(posted.status).toBe(200);
    expect(Number(await balance(ctx.oil))).toBe(oilBefore + 2);

    const back = await prisma.stockMovement.findMany({ where: { referenceId: created.body.data.salesReturn.id } });
    expect(back.map((m) => m.productId).sort()).toEqual([ctx.rice, ctx.oil, ctx.sugar].sort());
    expect(back.find((m) => m.productId === ctx.rice).unitCost.toString()).toBe('300');
  });

  it('editing the combo later never changes a bill already posted', async () => {
    const res = await request(app).patch(`/api/v1/products/${ctx.pack}`).set(auth(owner)).send({
      components: [{ productId: ctx.rice, quantity: '2' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.product.components).toHaveLength(1);

    const old = await request(app).get(`/api/v1/sales/${ctx.packSale.id}`).set(auth(owner));
    expect(old.body.data.sale.items[0].components).toHaveLength(3);
  });
});

describe('a combo made while billing', () => {
  it('a cashier makes one for this bill only; it never shows in the product list', async () => {
    const res = await request(app).post('/api/v1/products/combos/on-the-spot').set(auth(cashier)).send({
      name: 'Gift set',
      sellingPrice: '300',
      components: [
        { productId: ctx.sugar, quantity: '2' },
        { productId: ctx.oil, quantity: '1' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.product).toMatchObject({ isCombo: true, isAdHoc: true });
    ctx.gift = res.body.data.product.id;

    const list = await request(app).get('/api/v1/products').query({ search: 'Gift set' }).set(auth(owner));
    expect(list.body.data).toHaveLength(0);

    const sugarBefore = Number(await balance(ctx.sugar));
    const posted = await sell(cashier, [{ productId: ctx.gift, quantity: '1', unitPrice: '300' }]);
    expect(posted.status).toBe(200);
    expect(Number(await balance(ctx.sugar))).toBe(sugarBefore - 2);
  });

  it('only someone who manages products can save it for later', async () => {
    const body = { name: 'Keeper', sellingPrice: '10', components: [{ productId: ctx.sugar, quantity: '1' }], saveForLater: true };
    const asCashier = await request(app).post('/api/v1/products/combos/on-the-spot').set(auth(cashier)).send(body);
    expect(asCashier.status).toBe(403);
    const asOwner = await request(app).post('/api/v1/products/combos/on-the-spot').set(auth(owner)).send(body);
    expect(asOwner.body.data.product.isAdHoc).toBe(false);
  });
});

describe('what a combo can never be', () => {
  it('bought, stock-adjusted, or put inside another combo', async () => {
    const supplier = await request(app).post('/api/v1/suppliers').set(auth(owner)).send({ name: 'Combo Supplier' });
    const [buy, adjust, nested] = await Promise.all([
      request(app).post('/api/v1/purchases').set(auth(owner)).send({
        supplierId: supplier.body.data.supplier.id,
        warehouseId: ctx.warehouseId,
        invoiceNumber: 'C-1',
        invoiceDate: '2026-10-07',
        items: [{ productId: ctx.pack, quantity: '1', unitCost: '1' }],
      }),
      request(app).post('/api/v1/inventory/adjustments').set(auth(owner)).send({
        productId: ctx.pack,
        warehouseId: ctx.warehouseId,
        type: 'ADJUSTMENT_IN',
        quantity: '1',
        unitCost: '1',
      }),
      request(app).post('/api/v1/products').set(auth(owner)).send({
        name: 'Mega Pack',
        isCombo: true,
        components: [{ productId: ctx.pack, quantity: '1' }],
      }),
    ]);
    expect([buy.body.code, adjust.body.code, nested.body.code]).toEqual([
      'COMBO_NOT_PURCHASABLE',
      'COMBO_HAS_NO_STOCK',
      'COMBO_IN_COMBO',
    ]);
  });

  it('made from another shop\'s products', async () => {
    const res = await request(app).post('/api/v1/products/combos/on-the-spot').set(auth(otherShop)).send({
      name: 'Stolen',
      sellingPrice: '1',
      components: [{ productId: ctx.rice, quantity: '1' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('changing the price on the bill is traceable', () => {
  it('records the list price, flags the change, and counts it per person', async () => {
    const posted = await sell(cashier, [{ productId: ctx.rice, quantity: '1', unitPrice: '350' }]);
    expect(posted.status).toBe(200);
    expect(posted.body.data.sale.items[0]).toMatchObject({ listPrice: '400.00', priceChanged: true });

    const day = await request(app).get('/api/v1/my-day').query({ date: '2026-10-07' }).set(auth(cashier));
    expect(day.body.data.priceChangedCount).toBe(1);
  });
});
