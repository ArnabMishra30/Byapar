import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { verifyPeriod } from '../../src/modules/periods/period-verification.service.js';

// Phase 3B: inventory postings reach the general ledger and reconcile with it.
//   - opening stock (endpoint)  Dr Inventory / Cr Owner's Capital
//   - adjustment gain           Dr Inventory / Cr Inventory Adjustment Gain (4200)
//   - adjustment loss           Dr Inventory Shrinkage & Loss (5300) / Cr Inventory
//   - purchase discounts netted into inventory -> lower moving average and COGS
//   - inventory valuation reconciles with the Inventory control account (1300)

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let company;
let admin;
let ctx;
let productSeq = 0;

const post = (token, path, body) => request(app).post(path).set(auth(token)).send(body);
const get = (token, path) => request(app).get(path).set(auth(token));

async function makeProduct(token) {
  productSeq += 1;
  const res = await post(token, '/api/v1/products', {
    name: `IA Prod ${productSeq}`,
    sku: `IA-${productSeq}`,
    categoryId: ctx.categoryId,
    unitId: ctx.unitId,
    purchasePrice: '100',
  });
  expect(res.status).toBe(201);
  return res.body.data.product.id;
}

const openingStock = (token, body) => post(token, '/api/v1/inventory/opening-stock', body);
const adjustment = (token, body) => post(token, '/api/v1/inventory/adjustments', body);

async function journalFor(token, sourceType, sourceId) {
  const res = await get(token, `/api/v1/journal-entries/source/${sourceType}/${sourceId}`);
  return { status: res.status, entry: res.body.data?.journalEntry };
}

const postedTo = (entry, code, side) => {
  const line = entry.lines.find((row) => row.account.code === code);
  return line ? line[side] : null;
};

let accountIdByCode;
async function accountBalance(token, code) {
  if (!accountIdByCode) {
    const res = await get(token, '/api/v1/accounts?limit=100');
    accountIdByCode = new Map(res.body.data.map((a) => [a.code, a.id]));
  }
  const res = await get(token, `/api/v1/accounts/${accountIdByCode.get(code)}`);
  return res.body.data.account.balance;
}

async function postedPurchase(token, { productId, quantity, unitCost, discountType, discountValue }) {
  const created = await post(token, '/api/v1/purchases', {
    supplierId: ctx.supplierId,
    warehouseId: ctx.warehouseId,
    invoiceNumber: `IA-PI-${Math.random().toString(36).slice(2, 10)}`,
    invoiceDate: '2026-10-05',
    items: [{ productId, quantity, unitCost, discountType, discountValue }],
  });
  expect(created.status).toBe(201);
  const posted = await post(token, `/api/v1/purchases/${created.body.data.purchase.id}/post`);
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

async function postedSale(token, { productId, quantity, unitPrice }) {
  const created = await post(token, '/api/v1/sales', {
    customerId: ctx.customerId,
    warehouseId: ctx.warehouseId,
    invoiceDate: '2026-10-06',
    items: [{ productId, quantity, unitPrice }],
  });
  expect(created.status).toBe(201);
  const posted = await post(token, `/api/v1/sales/${created.body.data.sale.id}/post`);
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

beforeAll(async () => {
  await resetDatabase();
  company = await createCompanyWithUsers('inv-acct');
  admin = await login(app, company.admin.email, company.adminPassword);

  const category = await post(admin, '/api/v1/categories', { name: 'IA Cat' });
  const unit = await post(admin, '/api/v1/units', { name: 'IA Unit', shortCode: 'IAU' });
  const warehouse = await post(admin, '/api/v1/warehouses', { name: 'IA WH', code: 'IAW' });
  const supplier = await post(admin, '/api/v1/suppliers', { name: 'IA Supplier' });
  const customer = await post(admin, '/api/v1/customers', { name: 'IA Customer' });
  ctx = {
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    warehouseId: warehouse.body.data.warehouse.id,
    supplierId: supplier.body.data.supplier.id,
    customerId: customer.body.data.customer.id,
  };
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('opening stock posts to the general ledger', () => {
  it('debits Inventory and credits Owner’s Capital', async () => {
    const productId = await makeProduct(admin);
    const res = await openingStock(admin, { productId, warehouseId: ctx.warehouseId, quantity: '100', unitCost: '10' });
    expect(res.status).toBe(201);

    const { status, entry } = await journalFor(admin, 'INVENTORY_OPENING_STOCK', res.body.data.movement.id);
    expect(status).toBe(200);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1300', 'debit')).toBe('1000.00');
    expect(postedTo(entry, '3000', 'credit')).toBe('1000.00');
  });

  it('records opening stock once; a second attempt is refused and posts no second entry', async () => {
    const productId = await makeProduct(admin);
    const first = await openingStock(admin, { productId, warehouseId: ctx.warehouseId, quantity: '50', unitCost: '8' });
    expect(first.status).toBe(201);

    const again = await openingStock(admin, { productId, warehouseId: ctx.warehouseId, quantity: '50', unitCost: '8' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('OPENING_STOCK_ALREADY_EXISTS');

    const entries = await prisma.journalEntry.count({
      where: { companyId: company.company.id, sourceType: 'INVENTORY_OPENING_STOCK', sourceId: first.body.data.movement.id },
    });
    expect(entries).toBe(1);
  });

  it('records exactly one opening-stock entry under concurrent attempts', async () => {
    const productId = await makeProduct(admin);
    const body = { productId, warehouseId: ctx.warehouseId, quantity: '30', unitCost: '5' };
    const results = await Promise.all([openingStock(admin, body), openingStock(admin, body), openingStock(admin, body)]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);

    const balance = await get(admin, `/api/v1/inventory/${productId}/${ctx.warehouseId}`);
    expect(balance.body.data.balance.quantity).toBe('30.000');
  });
});

describe('stock adjustments post to the general ledger', () => {
  it('a positive adjustment credits Inventory Adjustment Gain (other income)', async () => {
    const productId = await makeProduct(admin);
    await openingStock(admin, { productId, warehouseId: ctx.warehouseId, quantity: '100', unitCost: '10' });

    const res = await adjustment(admin, { productId, warehouseId: ctx.warehouseId, type: 'ADJUSTMENT_IN', quantity: '10', unitCost: '12' });
    expect(res.status).toBe(201);

    const { entry } = await journalFor(admin, 'INVENTORY_ADJUSTMENT', res.body.data.movement.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1300', 'debit')).toBe('120.00');
    expect(postedTo(entry, '4200', 'credit')).toBe('120.00');
  });

  it('a negative adjustment debits Inventory Shrinkage & Loss at the current average', async () => {
    const productId = await makeProduct(admin);
    await openingStock(admin, { productId, warehouseId: ctx.warehouseId, quantity: '100', unitCost: '10' });

    // Damage/loss of 20 units at the current average cost of 10 = 200.
    const res = await adjustment(admin, { productId, warehouseId: ctx.warehouseId, type: 'ADJUSTMENT_OUT', quantity: '20' });
    expect(res.status).toBe(201);

    const { entry } = await journalFor(admin, 'INVENTORY_ADJUSTMENT', res.body.data.movement.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '5300', 'debit')).toBe('200.00');
    expect(postedTo(entry, '1300', 'credit')).toBe('200.00');
  });
});

describe('purchase discounts lower the moving average and COGS', () => {
  it('nets the discount into inventory and a later sale’s COGS uses the net cost', async () => {
    const productId = await makeProduct(admin);
    // 100 @ 100 with 10% discount -> net cost 90 per unit.
    await postedPurchase(admin, { productId, quantity: '100', unitCost: '100', discountType: 'PERCENTAGE', discountValue: '10' });

    const balance = await get(admin, `/api/v1/inventory/${productId}/${ctx.warehouseId}`);
    expect(balance.body.data.balance.averageCost).toBe('90.0000');

    // Sell 10: COGS = 10 x 90 = 900 (NOT 10 x 100 = 1000).
    const sale = await postedSale(admin, { productId, quantity: '10', unitPrice: '150' });
    const { entry } = await journalFor(admin, 'SALES_INVOICE', sale.id);
    expect(postedTo(entry, '5000', 'debit')).toBe('900.00');
  });
});

describe('inventory reconciles with the general ledger', () => {
  it('inventory valuation equals the Inventory control account after mixed activity', async () => {
    // Opening stock, a gain, a loss and a discounted purchase across products.
    const p1 = await makeProduct(admin);
    await openingStock(admin, { productId: p1, warehouseId: ctx.warehouseId, quantity: '50', unitCost: '10' });
    await adjustment(admin, { productId: p1, warehouseId: ctx.warehouseId, type: 'ADJUSTMENT_IN', quantity: '10', unitCost: '20' });
    await adjustment(admin, { productId: p1, warehouseId: ctx.warehouseId, type: 'ADJUSTMENT_OUT', quantity: '5' });

    const p2 = await makeProduct(admin);
    await postedPurchase(admin, { productId: p2, quantity: '40', unitCost: '50', discountType: 'PERCENTAGE', discountValue: '20' });

    const valuation = (await get(admin, '/api/v1/reports/inventory-valuation')).body.data.report;
    const control = await accountBalance(admin, '1300');
    // No purchase return has occurred, so the two agree exactly (no Phase-5 residue).
    expect(Number(valuation.totals.totalValue).toFixed(2)).toBe(Number(control).toFixed(2));
  });

  it('exposes a report-only INVENTORY_RECONCILE check that does not block a close', async () => {
    const verification = await verifyPeriod(company.company.id, {
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-31T00:00:00.000Z'),
    });
    const check = verification.checks.find((c) => c.key === 'INVENTORY_RECONCILE');
    expect(check).toBeTruthy();
    expect(check.blocking).toBe(false);
    // Report-only: even if it did not pass, it must not appear in `failed`.
    expect(verification.failed).not.toContain('INVENTORY_RECONCILE');
  });
});

describe('period locks still apply to inventory postings', () => {
  it('refuses a stock adjustment dated in a closed period and posts no journal entry', async () => {
    const other = await createCompanyWithUsers('inv-acct-closed');
    const token = await login(app, other.admin.email, other.adminPassword);
    const cat = await post(token, '/api/v1/categories', { name: 'C Cat' });
    const unit = await post(token, '/api/v1/units', { name: 'C Unit', shortCode: 'CU' });
    const wh = await post(token, '/api/v1/warehouses', { name: 'C WH', code: 'CW' });
    const prod = await post(token, '/api/v1/products', {
      name: 'C Prod',
      sku: 'C-1',
      categoryId: cat.body.data.category.id,
      unitId: unit.body.data.unit.id,
      purchasePrice: '10',
    });

    // A period covering today, with no transactions, closes cleanly.
    const period = await post(token, '/api/v1/accounting-periods', {
      name: 'Oct 2026',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(period.status).toBe(201);
    const closed = await post(token, `/api/v1/accounting-periods/${period.body.data.period.id}/close`);
    expect(closed.status).toBe(200);

    const before = await prisma.journalEntry.count({ where: { companyId: other.company.id } });
    const res = await adjustment(token, {
      productId: prod.body.data.product.id,
      warehouseId: wh.body.data.warehouse.id,
      type: 'ADJUSTMENT_IN',
      quantity: '10',
      unitCost: '10',
    });
    expect(res.status).toBe(422);
    expect(await prisma.journalEntry.count({ where: { companyId: other.company.id } })).toBe(before);
  });
});
