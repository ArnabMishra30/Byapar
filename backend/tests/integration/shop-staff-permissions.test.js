import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// PER-USER PERMISSIONS FOR A SHOP'S STAFF.
//
// Four people bill at one shop. The owner gives each a role (Cashier, Store
// keeper, Accountant, Manager) and may adjust it. These tests hold it to:
//   - a cashier can make and complete sales and take money, nothing more;
//   - cashier A never sees cashier B's bills or the shop's totals;
//   - cancelling needs its own permission, which the owner can grant;
//   - a discount needs its own permission;
//   - each biller's day is reported per person, and a biller sees only theirs;
//   - existing staff accounts (no role set) behave exactly as before;
//   - the server enforces it all, not just the screens.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';
const STAFF_PASSWORD = 'staff-password-1';

let owner;
let legacyStaff;
let cashierA;
let cashierB;
let keeper;
let accountant;
let userIds = {};
let ctx;
let companyB;

async function createStaff(name, body) {
  const res = await request(app)
    .post('/api/v1/users')
    .set(auth(owner))
    .send({ email: `${name}@perm.test`, password: STAFF_PASSWORD, name, role: 'STAFF', ...body });
  expect(res.status).toBe(201);
  userIds[name] = res.body.data.user.id;
  return login(app, `${name}@perm.test`, STAFF_PASSWORD);
}

async function makeSale(token, { total = '100', discount = null, unitPrice } = {}) {
  return request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId: ctx.customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate: '2026-09-02',
      items: [
        {
          productId: ctx.productId,
          quantity: '1',
          unitPrice: unitPrice ?? total,
          ...(discount ? { discountType: 'FIXED', discountValue: discount } : {}),
        },
      ],
    });
}

beforeAll(async () => {
  await resetDatabase();
  const company = await createCompanyWithUsers('perm');
  companyB = await createCompanyWithUsers('permb');
  owner = await login(app, company.admin.email, PASSWORD);
  legacyStaff = await login(app, company.staff.email, PASSWORD);

  const category = await request(app).post('/api/v1/categories').set(auth(owner)).send({ name: 'PermCat' });
  const unit = await request(app).post('/api/v1/units').set(auth(owner)).send({ name: 'PermUnit', shortCode: 'PMU' });
  const product = await request(app).post('/api/v1/products').set(auth(owner)).send({
    name: 'Perm Rice',
    sku: 'PERM-1',
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    sellingPrice: '100',
  });
  const warehouse = await request(app).post('/api/v1/warehouses').set(auth(owner)).send({ name: 'Perm WH', code: 'PWH' });
  const customer = await request(app).post('/api/v1/customers').set(auth(owner)).send({ name: 'Walk-in' });
  const supplier = await request(app).post('/api/v1/suppliers').set(auth(owner)).send({ name: 'Perm Supplier' });
  ctx = {
    productId: product.body.data.product.id,
    warehouseId: warehouse.body.data.warehouse.id,
    customerId: customer.body.data.customer.id,
    supplierId: supplier.body.data.supplier.id,
  };
  const purchase = await request(app).post('/api/v1/purchases').set(auth(owner)).send({
    supplierId: ctx.supplierId,
    warehouseId: ctx.warehouseId,
    invoiceNumber: 'PERM-STOCK',
    invoiceDate: '2026-09-01',
    items: [{ productId: ctx.productId, quantity: '100', unitCost: '50' }],
  });
  await request(app).post(`/api/v1/purchases/${purchase.body.data.purchase.id}/post`).set(auth(owner));

  cashierA = await createStaff('cashiera', { shopRole: 'CASHIER' });
  cashierB = await createStaff('cashierb', { shopRole: 'CASHIER' });
  keeper = await createStaff('keeper', { shopRole: 'STOREKEEPER' });
  accountant = await createStaff('accountant', { shopRole: 'ACCOUNTANT' });
});

describe('roles and permissions', () => {
  it('lists the ready-made roles and every permission for the owner', async () => {
    const res = await request(app).get('/api/v1/users/roles').set(auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.data.roles.map((r) => r.key)).toEqual(['CASHIER', 'STOREKEEPER', 'ACCOUNTANT', 'MANAGER', 'CUSTOM']);
    expect(res.body.data.permissions.length).toBeGreaterThan(10);
  });

  it('a new staff member gets the role\'s permissions, visible in their session', async () => {
    const me = await request(app).get('/api/v1/auth/me').set(auth(cashierA));
    expect(me.body.data.user.shopRole).toBe('CASHIER');
    expect(me.body.data.user.shopPermissions).toEqual(
      expect.arrayContaining(['SALES_CREATE', 'SALES_POST', 'MONEY_RECEIVE']),
    );
    expect(me.body.data.user.shopPermissions).not.toContain('REPORTS_VIEW');
  });

  it('refuses an unknown permission, and staff cannot manage users', async () => {
    const bad = await request(app)
      .post('/api/v1/users')
      .set(auth(owner))
      .send({ email: 'x@perm.test', password: STAFF_PASSWORD, name: 'X', role: 'STAFF', permissions: ['FLY'] });
    expect(bad.status).toBe(400);
    const staffTry = await request(app).get('/api/v1/users').set(auth(cashierA));
    expect(staffTry.status).toBe(403);
  });
});

describe('what a cashier sees right after signing in', () => {
  it('the login response already carries their permissions', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'cashiera@perm.test', password: STAFF_PASSWORD });
    expect(res.body.data.user.shopRole).toBe('CASHIER');
    expect(res.body.data.user.shopPermissions).toContain('SALES_POST');
    expect(res.body.data.user.shopPermissions).not.toContain('REPORTS_VIEW');
  });

  it('a party page shows what a customer owes, but not what the shop owes a supplier', async () => {
    const party = await request(app)
      .post('/api/v1/parties')
      .set(auth(owner))
      .send({ name: 'Both Ways Co', relationship: 'BOTH' });
    const id = party.body.data.party.id;

    const asCashier = await request(app).get(`/api/v1/parties/${id}`).set(auth(cashierA));
    expect(asCashier.body.data.party.customer.receivable).toBe('0.00');
    expect(asCashier.body.data.party.supplier.payable).toBeNull();

    const list = await request(app).get('/api/v1/parties').query({ search: 'Both Ways' }).set(auth(cashierA));
    expect(list.body.data[0].payable).toBeNull();

    const asOwner = await request(app).get(`/api/v1/parties/${id}`).set(auth(owner));
    expect(asOwner.body.data.party.supplier.payable).toBe('0.00');
  });
});

describe('a cashier adding a customer while billing', () => {
  it('can add a plain customer and use it on a bill', async () => {
    const res = await request(app)
      .post('/api/v1/parties')
      .set(auth(cashierA))
      .send({ name: 'Walk-in Ramesh', phone: '9555500001', relationship: 'CUSTOMER' });
    expect(res.status).toBe(201);
    expect(res.body.data.party.customerId).toBeTruthy();
  });

  it('cannot add a supplier, set credit terms, or edit an existing customer', async () => {
    const supplier = await request(app).post('/api/v1/parties').set(auth(cashierA)).send({ name: 'Cashier Supplier', relationship: 'SUPPLIER' });
    const both = await request(app).post('/api/v1/parties').set(auth(cashierA)).send({ name: 'Cashier Both', relationship: 'BOTH' });
    const terms = await request(app)
      .post('/api/v1/parties')
      .set(auth(cashierA))
      .send({ name: 'Credit Ramesh', relationship: 'CUSTOMER', customer: { creditLimit: '50000' } });
    const existing = await prisma.party.findFirst({ where: { name: 'Walk-in Ramesh' } });
    const edit = await request(app).patch(`/api/v1/parties/${existing.id}`).set(auth(cashierA)).send({ name: 'Renamed' });
    const legacy = await request(app).patch(`/api/v1/customers/${ctx.customerId}`).set(auth(cashierA)).send({ name: 'Renamed' });
    expect([supplier.status, both.status, terms.status, edit.status, legacy.status]).toEqual([403, 403, 403, 403, 403]);
  });

  it('can make an existing supplier a customer too, but not the other way round', async () => {
    const sup = await request(app).post('/api/v1/parties').set(auth(owner)).send({ name: 'Supplier Who Buys', relationship: 'SUPPLIER' });
    const cust = await request(app).post('/api/v1/parties').set(auth(owner)).send({ name: 'Customer Who Sells', relationship: 'CUSTOMER' });
    const toCustomer = await request(app).post(`/api/v1/parties/${sup.body.data.party.id}/relationships`).set(auth(cashierA)).send({ role: 'CUSTOMER' });
    const toSupplier = await request(app).post(`/api/v1/parties/${cust.body.data.party.id}/relationships`).set(auth(cashierA)).send({ role: 'SUPPLIER' });
    expect(toCustomer.status).toBe(200);
    expect(toSupplier.status).toBe(403);
  });

  it('a store keeper (no such permission) cannot add customers', async () => {
    const res = await request(app).post('/api/v1/parties').set(auth(keeper)).send({ name: 'Keeper Customer', relationship: 'CUSTOMER' });
    expect(res.status).toBe(403);
  });
});

describe('a cashier', () => {
  let saleA;
  let saleB;

  it('makes and completes a sale', async () => {
    const created = await makeSale(cashierA, { total: '100' });
    expect(created.status).toBe(201);
    const posted = await request(app).post(`/api/v1/sales/${created.body.data.sale.id}/post`).set(auth(cashierA));
    expect(posted.status).toBe(200);
    saleA = posted.body.data.sale;

    const other = await makeSale(cashierB, { total: '250', unitPrice: '250' });
    saleB = (await request(app).post(`/api/v1/sales/${other.body.data.sale.id}/post`).set(auth(cashierB))).body.data.sale;
    expect(saleB.status).toBe('POSTED');
  });

  it('takes money from a customer', async () => {
    const receivable = await prisma.customerReceivable.findFirst({ where: { salesInvoiceId: saleA.id } });
    const outstanding = await request(app).get(`/api/v1/customers/${ctx.customerId}/receivables`).set(auth(cashierA));
    expect(outstanding.status).toBe(200);

    const created = await request(app).post('/api/v1/customer-payments').set(auth(cashierA)).send({
      customerId: ctx.customerId,
      paymentDate: '2026-09-02',
      amount: '100',
      paymentMethod: 'CASH',
      allocations: [{ receivableId: receivable.id, amount: '100' }],
    });
    expect(created.status).toBe(201);
    const posted = await request(app).post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`).set(auth(cashierA));
    expect(posted.status).toBe(200);
  });

  it('sees only their own bills - never cashier B\'s', async () => {
    const list = await request(app).get('/api/v1/sales').set(auth(cashierA));
    expect(list.body.data.map((s) => s.id)).toEqual([saleA.id]);

    const theirs = await request(app).get(`/api/v1/sales/${saleB.id}`).set(auth(cashierA));
    expect(theirs.status).toBe(404);

    const receipts = await request(app).get('/api/v1/customer-payments').set(auth(cashierB));
    expect(receipts.body.data).toHaveLength(0);
  });

  it('cannot see the shop totals, reports or statements', async () => {
    const paths = [
      '/api/v1/dashboard',
      '/api/v1/reports/sales',
      '/api/v1/reports/billers',
      '/api/v1/credit/collections',
      `/api/v1/customers/${ctx.customerId}/statement`,
      `/api/v1/customers/${ctx.customerId}/ledger`,
      '/api/v1/accounting/profit-loss',
      '/api/v1/tax/gst-summary',
      '/api/v1/purchases',
    ];
    for (const path of paths) {
      const res = await request(app).get(path).set(auth(cashierA));
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('sees their own day only', async () => {
    const mine = await request(app).get('/api/v1/my-day').query({ date: '2026-09-02' }).set(auth(cashierA));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toMatchObject({ salesCount: 1, salesTotal: '100.00', collected: '100.00' });
    expect(mine.body.data).not.toHaveProperty('people');
    expect(mine.body.data).not.toHaveProperty('totals');
  });

  it('cannot undo a sale, record a purchase, adjust stock or add products', async () => {
    const results = await Promise.all([
      request(app).post('/api/v1/sales-returns').set(auth(cashierA)).send({}),
      request(app).post('/api/v1/purchases').set(auth(cashierA)).send({}),
      request(app).post('/api/v1/inventory/adjustments').set(auth(cashierA)).send({}),
      request(app).post('/api/v1/products').set(auth(cashierA)).send({}),
      request(app).post('/api/v1/supplier-payments').set(auth(cashierA)).send({}),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
  });

  it('may give a discount (a cashier has it), but not once the owner takes it away', async () => {
    const withDiscount = await makeSale(cashierA, { total: '100', discount: '10' });
    expect(withDiscount.status).toBe(201);

    await request(app).patch(`/api/v1/users/${userIds.cashierb}`).set(auth(owner)).send({
      shopRole: 'CUSTOM',
      permissions: ['SALES_CREATE', 'SALES_POST', 'MONEY_RECEIVE'],
    });
    const refused = await makeSale(cashierB, { total: '100', discount: '10' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('DISCOUNT_NOT_ALLOWED');
    const underPriced = await makeSale(cashierB, { unitPrice: '80' });
    expect(underPriced.status).toBe(403);
    const atPrice = await makeSale(cashierB, { unitPrice: '100' });
    expect(atPrice.status).toBe(201);
  });

  it("can always cancel their own unfinished draft, never anyone else's", async () => {
    const fresh = await makeSale(cashierA, { total: '100' });
    const res = await request(app).post(`/api/v1/sales/${fresh.body.data.sale.id}/cancel`).set(auth(cashierA));
    expect(res.status).toBe(200);
    const theirs = await makeSale(cashierB, { unitPrice: '100' });
    const other = await request(app).post(`/api/v1/sales/${theirs.body.data.sale.id}/cancel`).set(auth(cashierA));
    expect(other.status).toBe(404);
  });

  it('can undo a completed sale (sales return) once the owner grants it', async () => {
    await request(app).patch(`/api/v1/users/${userIds.cashiera}`).set(auth(owner)).send({
      permissions: ['SALES_CREATE', 'SALES_POST', 'SALES_DISCOUNT', 'MONEY_RECEIVE', 'SALES_CANCEL'],
    });
    const item = saleA.items[0];
    const created = await request(app).post('/api/v1/sales-returns').set(auth(cashierA)).send({
      salesInvoiceId: saleA.id,
      returnDate: '2026-09-03',
      items: [{ salesInvoiceItemId: item.id, quantity: '1' }],
    });
    expect(created.status).toBe(201);
    const posted = await request(app).post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`).set(auth(cashierA));
    expect(posted.status).toBe(200);
  });
});

describe('other roles', () => {
  it('a store keeper records purchases and stock, but cannot sell or see sales', async () => {
    const purchase = await request(app).post('/api/v1/purchases').set(auth(keeper)).send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: 'KEEP-1',
      invoiceDate: '2026-09-03',
      items: [{ productId: ctx.productId, quantity: '5', unitCost: '50' }],
    });
    expect(purchase.status).toBe(201);
    const sale = await makeSale(keeper);
    expect(sale.status).toBe(403);
  });

  it('an accountant sees everyone\'s sales, the reports and each biller\'s day', async () => {
    const sales = await request(app).get('/api/v1/sales').set(auth(accountant));
    expect(sales.body.data.length).toBeGreaterThanOrEqual(2);

    const day = await request(app).get('/api/v1/reports/billers').query({ date: '2026-09-02' }).set(auth(accountant));
    expect(day.status).toBe(200);
    const a = day.body.data.people.find((p) => p.user.id === userIds.cashiera);
    const b = day.body.data.people.find((p) => p.user.id === userIds.cashierb);
    expect(a).toMatchObject({ salesCount: 1, salesTotal: '100.00', collected: '100.00', collectedByMethod: { CASH: '100.00' } });
    expect(b).toMatchObject({ salesCount: 1, salesTotal: '250.00', collected: '0.00' });
    expect(day.body.data.totals.salesTotal).toBe('350.00');
  });
});

describe('existing staff accounts are unchanged', () => {
  it('a staff account with no role keeps the old abilities', async () => {
    const draft = await makeSale(legacyStaff);
    expect(draft.status).toBe(201);
    const post = await request(app).post(`/api/v1/sales/${draft.body.data.sale.id}/post`).set(auth(legacyStaff));
    expect(post.status).toBe(403);
    const dashboard = await request(app).get('/api/v1/dashboard').set(auth(legacyStaff));
    expect(dashboard.status).toBe(200);
    const sales = await request(app).get('/api/v1/sales').set(auth(legacyStaff));
    expect(sales.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('promoting a staff member to owner clears their staff role', async () => {
    const res = await request(app).patch(`/api/v1/users/${userIds.accountant}`).set(auth(owner)).send({ role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ role: 'ADMIN', shopRole: null, permissions: [] });
  });
});

describe('tenant isolation', () => {
  it('another shop\'s owner cannot see or change these staff', async () => {
    const otherOwner = await login(app, companyB.admin.email, PASSWORD);
    const res = await request(app).patch(`/api/v1/users/${userIds.cashiera}`).set(auth(otherOwner)).send({ shopRole: 'MANAGER' });
    expect(res.status).toBe(404);
    const billers = await request(app).get('/api/v1/reports/billers').query({ date: '2026-09-02' }).set(auth(otherOwner));
    expect(billers.body.data.people.map((p) => p.user.id)).not.toContain(userIds.cashiera);
  });
});
