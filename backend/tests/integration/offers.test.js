import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// BUY X GET Y FREE.
//   - a saved offer adds its free line automatically, worked out by the server;
//   - same product (B1G1), a different product, and any ratio all work;
//   - the free item leaves stock and its cost counts, its price and tax are 0;
//   - a screen cannot inflate the free quantity; an expired offer does nothing;
//   - giving a free item by hand needs the discount permission;
//   - the Offers report shows what went out free and what it cost.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';
const STAFF_PASSWORD = 'staff-password-1';

let owner;
let cashier;
let ctx;

async function product(name, price) {
  const res = await request(app).post('/api/v1/products').set(auth(owner)).send({
    name,
    categoryId: ctx.categoryId,
    unitId: ctx.unitId,
    sellingPrice: price,
  });
  const id = res.body.data.product.id;
  await request(app).post('/api/v1/inventory/opening-stock').set(auth(owner)).send({
    productId: id,
    warehouseId: ctx.warehouseId,
    quantity: '50',
    unitCost: String(Number(price) / 2),
  });
  return id;
}

const balance = async (productId) =>
  Number((await prisma.inventoryBalance.findFirst({ where: { productId } })).quantity);

const offer = (body) => request(app).post('/api/v1/offers').set(auth(owner)).send(body);

async function sell(token, items, { date = '2026-10-07', post = true } = {}) {
  const created = await request(app).post('/api/v1/sales').set(auth(token)).send({
    customerId: ctx.customerId,
    warehouseId: ctx.warehouseId,
    invoiceDate: date,
    items,
  });
  if (!post || created.status !== 201) return created;
  return request(app).post(`/api/v1/sales/${created.body.data.sale.id}/post`).set(auth(token));
}

beforeAll(async () => {
  await resetDatabase();
  const company = await createCompanyWithUsers('offer');
  owner = await login(app, company.admin.email, PASSWORD);
  const category = await request(app).post('/api/v1/categories').set(auth(owner)).send({ name: 'Offers' });
  const unit = await request(app).post('/api/v1/units').set(auth(owner)).send({ name: 'Piece', shortCode: 'PCS' });
  const warehouse = await request(app).post('/api/v1/warehouses').set(auth(owner)).send({ name: 'Shop', code: 'SH' });
  const customer = await request(app).post('/api/v1/customers').set(auth(owner)).send({ name: 'Offer Buyer' });
  ctx = {
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    warehouseId: warehouse.body.data.warehouse.id,
    customerId: customer.body.data.customer.id,
  };
  ctx.soap = await product('Soap', '40');
  ctx.paste = await product('Toothpaste', '90');
  ctx.brush = await product('Brush', '30');
  ctx.biscuit = await product('Biscuit', '10');

  await request(app).post('/api/v1/users').set(auth(owner)).send({
    email: 'offer-cashier@test.test',
    password: STAFF_PASSWORD,
    name: 'Offer Cashier',
    role: 'STAFF',
    shopRole: 'CUSTOM',
    permissions: ['SALES_CREATE', 'SALES_POST'],
  });
  cashier = await login(app, 'offer-cashier@test.test', STAFF_PASSWORD);
});

describe('saved offers', () => {
  it('Buy 1 Soap get 1 Soap free: the bill gets a free soap and stock goes down by 2', async () => {
    const created = await offer({ buyProductId: ctx.soap, buyQuantity: '1', freeProductId: ctx.soap, freeQuantity: '1' });
    expect(created.status).toBe(201);
    expect(created.body.data.offer.name).toBe('Buy 1 Soap, get 1 Soap free');

    const before = await balance(ctx.soap);
    const res = await sell(cashier, [{ productId: ctx.soap, quantity: '1', unitPrice: '40' }]);
    expect(res.status).toBe(200);
    const sale = res.body.data.sale;
    const free = sale.items.find((i) => i.isFree);
    expect(free).toMatchObject({ productId: ctx.soap, quantity: '1.000', lineTotal: '0.00', unitPrice: '0.0000' });
    expect(free.offer.name).toContain('Soap');
    expect(sale.grandTotal).toBe('40.00');
    expect(await balance(ctx.soap)).toBe(before - 2);
    // The free soap still cost the shop money: 2 x 20.
    expect(sale.cogsTotal).toBe('40.00');
  });

  it('Buy 1 Toothpaste get 1 Brush free (a different item)', async () => {
    await offer({ buyProductId: ctx.paste, buyQuantity: '1', freeProductId: ctx.brush, freeQuantity: '1' });
    const before = await balance(ctx.brush);
    const res = await sell(owner, [{ productId: ctx.paste, quantity: '2', unitPrice: '90' }]);
    const free = res.body.data.sale.items.find((i) => i.isFree);
    expect(free).toMatchObject({ productId: ctx.brush, quantity: '2.000' });
    expect(await balance(ctx.brush)).toBe(before - 2);
  });

  it('Buy 3 get 1: 7 bought gives 2 free, 2 bought gives none', async () => {
    await offer({ buyProductId: ctx.biscuit, buyQuantity: '3', freeProductId: ctx.biscuit, freeQuantity: '1' });
    const seven = await sell(owner, [{ productId: ctx.biscuit, quantity: '7', unitPrice: '10' }], { post: false });
    expect(seven.body.data.sale.items.find((i) => i.isFree).quantity).toBe('2.000');
    const two = await sell(owner, [{ productId: ctx.biscuit, quantity: '2', unitPrice: '10' }], { post: false });
    expect(two.body.data.sale.items.some((i) => i.isFree)).toBe(false);
  });

  it('ignores a free quantity sent by the screen and works it out again', async () => {
    const offers = await request(app).get('/api/v1/offers').set(auth(owner));
    const soapOffer = offers.body.data.offers.find((o) => o.buyProduct.id === ctx.soap);
    const res = await sell(
      cashier,
      [
        { productId: ctx.soap, quantity: '1', unitPrice: '40' },
        { productId: ctx.soap, quantity: '10', unitPrice: '0', isFree: true, offerId: soapOffer.id },
      ],
      { post: false },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.sale.items.find((i) => i.isFree).quantity).toBe('1.000');
  });

  it('does nothing outside its dates, or once switched off', async () => {
    const dated = await offer({
      buyProductId: ctx.brush,
      buyQuantity: '1',
      freeProductId: ctx.biscuit,
      freeQuantity: '1',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
    const before = await sell(owner, [{ productId: ctx.brush, quantity: '1', unitPrice: '30' }], { post: false });
    expect(before.body.data.sale.items.some((i) => i.isFree)).toBe(false);
    const during = await sell(owner, [{ productId: ctx.brush, quantity: '1', unitPrice: '30' }], { date: '2026-11-10', post: false });
    expect(during.body.data.sale.items.some((i) => i.isFree)).toBe(true);

    await request(app).patch(`/api/v1/offers/${dated.body.data.offer.id}/status`).set(auth(owner)).send({ isActive: false });
    const off = await sell(owner, [{ productId: ctx.brush, quantity: '1', unitPrice: '30' }], { date: '2026-11-10', post: false });
    expect(off.body.data.sale.items.some((i) => i.isFree)).toBe(false);
  });

  it('only someone who manages products can set up an offer', async () => {
    const res = await request(app)
      .post('/api/v1/offers')
      .set(auth(cashier))
      .send({ buyProductId: ctx.soap, buyQuantity: '1', freeProductId: ctx.soap, freeQuantity: '1' });
    expect(res.status).toBe(403);
  });
});

describe('a free item given by hand', () => {
  it('needs the discount permission', async () => {
    const refused = await sell(cashier, [
      { productId: ctx.paste, quantity: '1', unitPrice: '90' },
      { productId: ctx.biscuit, quantity: '1', unitPrice: '0', isFree: true },
    ]);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('DISCOUNT_NOT_ALLOWED');
  });

  it('the owner can, and its stock still goes out', async () => {
    const before = await balance(ctx.biscuit);
    const res = await sell(owner, [
      { productId: ctx.paste, quantity: '1', unitPrice: '90' },
      { productId: ctx.biscuit, quantity: '2', unitPrice: '5', isFree: true },
    ]);
    expect(res.status).toBe(200);
    const free = res.body.data.sale.items.find((i) => i.productId === ctx.biscuit);
    expect(free).toMatchObject({ isFree: true, lineTotal: '0.00', offer: null, priceChanged: false });
    expect(await balance(ctx.biscuit)).toBe(before - 2);
  });
});

describe('the Offers report', () => {
  it('shows what went out free, per offer and by hand, and what it cost', async () => {
    const res = await request(app).get('/api/v1/reports/offers').set(auth(owner));
    expect(res.status).toBe(200);
    const soap = res.body.data.rows.find((r) => r.label.startsWith('Buy 1 Soap'));
    expect(soap).toMatchObject({ kind: 'OFFER', timesGiven: 1, cost: '20.00' });
    const byHand = res.body.data.rows.find((r) => r.kind === 'BY_HAND');
    expect(byHand.itemsGiven[0]).toMatchObject({ name: 'Biscuit', quantity: '2.000' });

    const asCashier = await request(app).get('/api/v1/reports/offers').set(auth(cashier));
    expect(asCashier.status).toBe(403);
  });
});
