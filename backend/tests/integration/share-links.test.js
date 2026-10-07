import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// SHARE LINKS: a shop sends a customer or supplier a link to their bill and log
// book. These tests hold it to:
//   - no login needed to open it, and it shows the right invoice / account;
//   - it shows only that invoice / that party, never anyone else's;
//   - nothing the customer should not see (cost, margin, staff, other ids);
//   - "stop sharing" kills it at once, and a dead link looks like a missing one;
//   - the shop sees when it was opened;
//   - only the owner can create or stop a link; tenants are isolated.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

let adminA;
let staffA;
let adminB;
let ctx;

async function prepare(token) {
  const category = await request(app).post('/api/v1/categories').set(auth(token)).send({ name: 'ShareCat' });
  const unit = await request(app).post('/api/v1/units').set(auth(token)).send({ name: 'ShareUnit', shortCode: 'SHU' });
  const product = await request(app).post('/api/v1/products').set(auth(token)).send({
    name: 'Shared Rice',
    sku: 'SHR-1',
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
  });
  const warehouse = await request(app).post('/api/v1/warehouses').set(auth(token)).send({ name: 'Share WH', code: 'SWH' });
  const customer = await request(app).post('/api/v1/customers').set(auth(token)).send({ name: 'Ravi Kirana' });
  const other = await request(app).post('/api/v1/customers').set(auth(token)).send({ name: 'Other Customer' });
  const supplier = await request(app).post('/api/v1/suppliers').set(auth(token)).send({ name: 'Share Supplier' });
  return {
    productId: product.body.data.product.id,
    warehouseId: warehouse.body.data.warehouse.id,
    customerId: customer.body.data.customer.id,
    otherCustomerId: other.body.data.customer.id,
    supplierId: supplier.body.data.supplier.id,
  };
}

async function purchase(token, total) {
  const created = await request(app).post('/api/v1/purchases').set(auth(token)).send({
    supplierId: ctx.supplierId,
    warehouseId: ctx.warehouseId,
    invoiceNumber: `SB-${Math.random().toString(36).slice(2, 8)}`,
    invoiceDate: '2026-09-01',
    items: [{ productId: ctx.productId, quantity: '10', unitCost: String(Number(total) / 10) }],
  });
  await request(app).post(`/api/v1/purchases/${created.body.data.purchase.id}/post`).set(auth(token));
}

async function sale(token, customerId, total, { post = true } = {}) {
  const created = await request(app).post('/api/v1/sales').set(auth(token)).send({
    customerId,
    warehouseId: ctx.warehouseId,
    invoiceDate: '2026-09-02',
    items: [{ productId: ctx.productId, quantity: '1', unitPrice: total }],
  });
  if (!post) return created.body.data.sale;
  const posted = await request(app).post(`/api/v1/sales/${created.body.data.sale.id}/post`).set(auth(token));
  return posted.body.data.sale;
}

const share = (token, body) => request(app).post('/api/v1/share-links').set(auth(token)).send(body);
const open = (token) => request(app).get(`/api/v1/public/share/${token}`);

beforeAll(async () => {
  await resetDatabase();
  const a = await createCompanyWithUsers('sharea');
  const b = await createCompanyWithUsers('shareb');
  adminA = await login(app, a.admin.email, PASSWORD);
  staffA = await login(app, a.staff.email, PASSWORD);
  adminB = await login(app, b.admin.email, PASSWORD);
  ctx = await prepare(adminA);
  await purchase(adminA, '5000');
  ctx.saleOne = await sale(adminA, ctx.customerId, '1000');
  ctx.saleTwo = await sale(adminA, ctx.customerId, '400');
  ctx.otherSale = await sale(adminA, ctx.otherCustomerId, '700');
  ctx.draft = await sale(adminA, ctx.customerId, '50', { post: false });

  const receivable = await prisma.customerReceivable.findFirst({ where: { salesInvoiceId: ctx.saleOne.id } });
  const payment = await request(app).post('/api/v1/customer-payments').set(auth(adminA)).send({
    customerId: ctx.customerId,
    paymentDate: '2026-09-03',
    amount: '300',
    paymentMethod: 'CASH',
    allocations: [{ receivableId: receivable.id, amount: '300' }],
  });
  await request(app).post(`/api/v1/customer-payments/${payment.body.data.payment.id}/post`).set(auth(adminA));
});

describe('sharing an invoice', () => {
  let link;

  it('creates a link for a posted invoice, and the same link again on a second share', async () => {
    const first = await share(adminA, { kind: 'INVOICE', salesInvoiceId: ctx.saleOne.id });
    const second = await share(adminA, { kind: 'INVOICE', salesInvoiceId: ctx.saleOne.id });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.link.token).toBe(first.body.data.link.token);
    expect(first.body.data.link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    link = first.body.data.link;
  });

  it('opens with no login and shows the invoice with what is paid and due', async () => {
    const res = await open(link.token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.kind).toBe('INVOICE');
    expect(res.body.data.shop.name).toBe('sharea Company');
    expect(res.body.data.invoice).toMatchObject({ grandTotal: '1000.00', paid: '300.00', due: '700.00' });
    expect(res.body.data.invoice.items[0]).toMatchObject({ name: 'Shared Rice', total: '1000.00' });
    // A single-invoice link does not show the account.
    expect(res.body.data.account).toBeNull();
  });

  it('shows nothing the customer should not see', async () => {
    const body = JSON.stringify((await open(link.token)).body);
    for (const secret of ['cogs', 'grossMargin', 'createdBy', 'postedBy', 'companyId', 'warehouse', 'unitCost']) {
      expect(body).not.toContain(secret);
    }
  });

  it('does not open another invoice through a single-invoice link', async () => {
    const res = await request(app).get(`/api/v1/public/share/${link.token}/invoices/${ctx.saleTwo.id}`);
    expect(res.status).toBe(404);
  });

  it('records when it was opened, for the shop', async () => {
    const res = await request(app).get('/api/v1/share-links').query({ salesInvoiceId: ctx.saleOne.id }).set(auth(adminA));
    expect(res.body.data.links[0].viewCount).toBeGreaterThanOrEqual(2);
    expect(res.body.data.links[0].firstViewedAt).not.toBeNull();
    expect(res.body.data.links[0].lastViewedAt).not.toBeNull();
  });

  it('refuses to share a draft', async () => {
    const res = await share(adminA, { kind: 'INVOICE', salesInvoiceId: ctx.draft.id });
    expect(res.status).toBe(409);
  });

  it('stop sharing kills the link immediately, and it looks like a missing one', async () => {
    const stopped = await request(app).post(`/api/v1/share-links/${link.id}/revoke`).set(auth(adminA));
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.link.isActive).toBe(false);

    const dead = await open(link.token);
    const missing = await open('x'.repeat(32));
    expect(dead.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(dead.body.message).toBe(missing.body.message);

    // Sharing again makes a fresh link; the old one stays dead.
    const again = await share(adminA, { kind: 'INVOICE', salesInvoiceId: ctx.saleOne.id });
    expect(again.status).toBe(201);
    expect(again.body.data.link.token).not.toBe(link.token);
  });
});

describe('an invoice link with the whole log book', () => {
  it('shows the invoice and the customer\'s account, and opens their other invoices', async () => {
    const created = await share(adminA, { kind: 'INVOICE', salesInvoiceId: ctx.saleTwo.id, includeAccount: true });
    const res = await open(created.body.data.link.token);

    expect(res.body.data.invoice.invoiceNumber).toBe(ctx.saleTwo.invoiceNumber);
    expect(res.body.data.account.partyName).toBe('Ravi Kirana');
    // 1000 + 400 sold, 300 received.
    expect(res.body.data.account.closingBalance).toBe('1100.00');
    expect(res.body.data.account.lines.map((l) => l.label)).toEqual(['Invoice', 'Invoice', 'Receipt']);

    const other = await request(app).get(
      `/api/v1/public/share/${created.body.data.link.token}/invoices/${ctx.saleOne.id}`,
    );
    expect(other.status).toBe(200);
    expect(other.body.data.invoice.due).toBe('700.00');
  });
});

describe('sharing an account (log book)', () => {
  it('a customer log book shows only that customer', async () => {
    const created = await share(adminA, { kind: 'CUSTOMER_ACCOUNT', customerId: ctx.customerId });
    const token = created.body.data.link.token;
    const res = await open(token);

    expect(res.status).toBe(200);
    expect(res.body.data.invoice).toBeNull();
    expect(res.body.data.account.side).toBe('CUSTOMER');
    expect(res.body.data.account.lines).toHaveLength(3);

    // Another customer's invoice is not reachable through this link.
    const foreign = await request(app).get(`/api/v1/public/share/${token}/invoices/${ctx.otherSale.id}`);
    expect(foreign.status).toBe(404);
    // Nor a draft of their own.
    const draft = await request(app).get(`/api/v1/public/share/${token}/invoices/${ctx.draft.id}`);
    expect(draft.status).toBe(404);
  });

  it('a supplier log book shows what the shop owes them', async () => {
    const created = await share(adminA, { kind: 'SUPPLIER_ACCOUNT', supplierId: ctx.supplierId });
    const res = await open(created.body.data.link.token);

    expect(res.body.data.account.side).toBe('SUPPLIER');
    expect(res.body.data.account.closingBalance).toBe('5000.00');
    expect(res.body.data.account.lines[0].invoiceId).toBeNull();
  });
});

describe('who may share, and tenant isolation', () => {
  it('staff can see links but not create or stop them', async () => {
    const list = await request(app).get('/api/v1/share-links').set(auth(staffA));
    const create = await share(staffA, { kind: 'CUSTOMER_ACCOUNT', customerId: ctx.customerId });
    const stop = await request(app).post(`/api/v1/share-links/${list.body.data.links[0].id}/revoke`).set(auth(staffA));
    expect([list.status, create.status, stop.status]).toEqual([200, 403, 403]);
  });

  it('another shop cannot share, list or stop this shop\'s things', async () => {
    const mine = (await request(app).get('/api/v1/share-links').set(auth(adminA))).body.data.links[0];
    const [create, list, stop] = await Promise.all([
      share(adminB, { kind: 'INVOICE', salesInvoiceId: ctx.saleOne.id }),
      request(app).get('/api/v1/share-links').set(auth(adminB)),
      request(app).post(`/api/v1/share-links/${mine.id}/revoke`).set(auth(adminB)),
    ]);
    expect(create.status).toBe(404);
    expect(list.body.data.links).toHaveLength(0);
    expect(stop.status).toBe(404);
  });

  it('rejects a malformed token without a database lookup', async () => {
    const res = await open('not-a-token');
    expect(res.status).toBe(400);
  });
});
