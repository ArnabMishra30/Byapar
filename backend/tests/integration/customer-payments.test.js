import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let ctxA;
let ctxB;

async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `CPCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `CPUnit ${suffix}`, shortCode: `CP${suffix}` });
  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `CPProd ${suffix}`,
      sku: `CPSKU-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });
  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `CPSup ${suffix}` });
  const customer = await request(app)
    .post('/api/v1/customers')
    .set(auth(token))
    .send({ name: `CPCust ${suffix}` });
  const customer2 = await request(app)
    .post('/api/v1/customers')
    .set(auth(token))
    .send({ name: `CPCust2 ${suffix}` });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `CPWH ${suffix}`, code: `CW${suffix}` });

  return {
    productId: product.body.data.product.id,
    supplierId: supplier.body.data.supplier.id,
    customerId: customer.body.data.customer.id,
    customerId2: customer2.body.data.customer.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

async function stockUp(token, ctx, quantity, unitCost) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `CPB-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-01',
      items: [{ productId: ctx.productId, quantity, unitCost }],
    });
  await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));
}

/** Posts a sale of `total` (1 unit priced at `total`, no tax) and returns it. */
async function postedSale(token, ctx, total, customerId) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId: customerId ?? ctx.customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate: '2026-09-01',
      dueDate: '2026-09-30',
      items: [{ productId: ctx.productId, quantity: '1', unitPrice: total }],
    });

  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/sales/${created.body.data.sale.id}/post`)
    .set(auth(token));

  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

async function receivableFor(token, saleId) {
  const response = await request(app)
    .get('/api/v1/customer-receivables?limit=100')
    .set(auth(token));
  return response.body.data.find((r) => r.salesInvoice.id === saleId);
}

const createPayment = (token, body) =>
  request(app).post('/api/v1/customer-payments').set(auth(token)).send(body);
const postPayment = (token, id) =>
  request(app).post(`/api/v1/customer-payments/${id}/post`).set(auth(token));
const outstandingFor = (token, customerId) =>
  request(app).get(`/api/v1/customers/${customerId}/outstanding`).set(auth(token));
const ledgerFor = (token, customerId) =>
  request(app).get(`/api/v1/customers/${customerId}/ledger`).set(auth(token));

function paymentBody(ctx, overrides = {}) {
  return {
    customerId: ctx.customerId,
    paymentDate: '2026-09-15',
    amount: '10000',
    paymentMethod: 'BANK',
    referenceNumber: 'NEFT-1',
    allocations: [],
    ...overrides,
  };
}

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('alpha');
  companyB = await createCompanyWithUsers('beta');

  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  staffA = await login(app, companyA.staff.email, companyA.staffPassword);
  adminB = await login(app, companyB.admin.email, companyB.adminPassword);

  ctxA = await prepareCompany(adminA, 'A');
  ctxB = await prepareCompany(adminB, 'B');
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function resetTransactions() {
  // The general ledger, first: journal lines reference accounts, and a leftover
  // journal entry would collide with a later journal number.
  await prisma.expense.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.customerPaymentAllocation.deleteMany();
  await prisma.customerLedgerEntry.deleteMany();
  await prisma.customerPayment.deleteMany();
  await prisma.customerReceivable.deleteMany();
  await prisma.salesInvoiceItem.deleteMany();
  await prisma.salesInvoice.deleteMany();
  await prisma.supplierPaymentAllocation.deleteMany();
  await prisma.supplierLedgerEntry.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.supplierPayable.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
}

describe('customer payment drafts', () => {
  let sale;
  let receivable;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
    sale = await postedSale(adminA, ctxA, '50000');
    receivable = await receivableFor(adminA, sale.id);
  });

  it('creates a draft with a generated payment number', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '20000', allocations: [{ receivableId: receivable.id, amount: '20000' }] }),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.payment.status).toBe('DRAFT');
    expect(response.body.data.payment.paymentNumber).toMatch(/^RCP-2026-\d{6}$/);
    expect(response.body.data.payment.allocatedAmount).toBe('20000.00');
    expect(response.body.data.payment.unallocatedAmount).toBe('0.00');
  });

  it('does not change the receivable or the ledger while it is a draft', async () => {
    await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '20000', allocations: [{ receivableId: receivable.id, amount: '20000' }] }),
    );

    const reread = await receivableFor(adminA, sale.id);
    expect(reread.outstandingAmount).toBe('50000.00');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);
  });

  it('reads and lists payments', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '500' }));

    const one = await request(app)
      .get(`/api/v1/customer-payments/${created.body.data.payment.id}`)
      .set(auth(adminA));
    const list = await request(app).get('/api/v1/customer-payments').set(auth(adminA));

    expect(one.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].allocations).toBeUndefined();
  });

  it('updates a draft and recalculates the split', async () => {
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '20000', allocations: [{ receivableId: receivable.id, amount: '20000' }] }),
    );

    const response = await request(app)
      .patch(`/api/v1/customer-payments/${created.body.data.payment.id}`)
      .set(auth(adminA))
      .send(paymentBody(ctxA, { amount: '30000', allocations: [{ receivableId: receivable.id, amount: '25000' }] }));

    expect(response.status).toBe(200);
    expect(response.body.data.payment.allocatedAmount).toBe('25000.00');
    expect(response.body.data.payment.unallocatedAmount).toBe('5000.00');
  });

  it('cancels a draft, after which it cannot be posted', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }));
    const id = created.body.data.payment.id;

    const cancelled = await request(app)
      .post(`/api/v1/customer-payments/${id}/cancel`)
      .set(auth(adminA));
    expect(cancelled.body.data.payment.status).toBe('CANCELLED');

    const posted = await postPayment(adminA, id);
    expect(posted.status).toBe(409);
  });

  it('refuses to move a payment to a different customer', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }));

    const response = await request(app)
      .patch(`/api/v1/customer-payments/${created.body.data.payment.id}`)
      .set(auth(adminA))
      .send(paymentBody(ctxA, { amount: '1000', customerId: ctxA.customerId2 }));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CUSTOMER_PAYMENT_CUSTOMER_IMMUTABLE');
  });
});

describe('customer payment validation', () => {
  let sale;
  let receivable;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
    sale = await postedSale(adminA, ctxA, '50000');
    receivable = await receivableFor(adminA, sale.id);
  });

  it('rejects a zero or negative amount', async () => {
    const zero = await createPayment(adminA, paymentBody(ctxA, { amount: '0' }));
    const negative = await createPayment(adminA, paymentBody(ctxA, { amount: '-100' }));

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects an unknown payment method and a malformed date', async () => {
    const method = await createPayment(adminA, paymentBody(ctxA, { paymentMethod: 'BITCOIN' }));
    const date = await createPayment(adminA, paymentBody(ctxA, { paymentDate: '15/09/2026' }));

    expect(method.status).toBe(400);
    expect(date.status).toBe(400);
  });

  it('rejects the same invoice twice in one payment', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, {
        amount: '5000',
        allocations: [
          { receivableId: receivable.id, amount: '1000' },
          { receivableId: receivable.id, amount: '2000' },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('more than once');
  });

  it('rejects allocations totalling more than the payment', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '5000', allocations: [{ receivableId: receivable.id, amount: '6000' }] }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
  });

  it('rejects allocating more than the invoice has outstanding', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '90000', allocations: [{ receivableId: receivable.id, amount: '80000' }] }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_ALLOCATION_EXCEEDS_RECEIVABLE');
  });

  it("rejects another customer's invoice", async () => {
    const otherSale = await postedSale(adminA, ctxA, '5000', ctxA.customerId2);
    const otherReceivable = await receivableFor(adminA, otherSale.id);

    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '5000', allocations: [{ receivableId: otherReceivable.id, amount: '5000' }] }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_PAYMENT_ALLOCATION');
  });

  it('rejects an unknown receivable', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, {
        amount: '5000',
        allocations: [{ receivableId: '00000000-0000-4000-8000-000000000000', amount: '5000' }],
      }),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CUSTOMER_RECEIVABLE_NOT_FOUND');
  });

  it('cannot allocate against a draft or cancelled invoice, because neither has a receivable', async () => {
    const draft = await request(app)
      .post('/api/v1/sales')
      .set(auth(adminA))
      .send({
        customerId: ctxA.customerId,
        warehouseId: ctxA.warehouseId,
        invoiceDate: '2026-09-01',
        items: [{ productId: ctxA.productId, quantity: '1', unitPrice: '100' }],
      });

    // A draft invoice raises no receivable at all, so there is nothing to allocate to.
    const receivables = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const ids = receivables.body.data.map((r) => r.salesInvoice.id);

    expect(draft.status).toBe(201);
    expect(ids).not.toContain(draft.body.data.sale.id);
  });

  it('rejects an inactive customer', async () => {
    await request(app)
      .patch(`/api/v1/customers/${ctxA.customerId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { customerId: ctxA.customerId2, amount: '1000' }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CUSTOMER_INACTIVE');

    await request(app)
      .patch(`/api/v1/customers/${ctxA.customerId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('posting customer payments', () => {
  let sale;
  let receivable;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
    sale = await postedSale(adminA, ctxA, '50000');
    receivable = await receivableFor(adminA, sale.id);
  });

  async function payAndPost(amount, allocations) {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount, allocations }));
    expect(created.status).toBe(201);
    return postPayment(adminA, created.body.data.payment.id);
  }

  it('posts and records who and when', async () => {
    const response = await payAndPost('20000', [{ receivableId: receivable.id, amount: '20000' }]);

    expect(response.status).toBe(200);
    expect(response.body.data.payment.status).toBe('POSTED');
    expect(response.body.data.payment.postedBy.id).toBe(companyA.admin.id);
    expect(response.body.data.payment.postedAt).toBeTruthy();
  });

  it('walks an invoice OPEN -> PARTIALLY_PAID -> PAID', async () => {
    let current = await receivableFor(adminA, sale.id);
    expect(current.status).toBe('OPEN');

    await payAndPost('20000', [{ receivableId: receivable.id, amount: '20000' }]);
    current = await receivableFor(adminA, sale.id);
    expect(current.outstandingAmount).toBe('30000.00');
    expect(current.status).toBe('PARTIALLY_PAID');

    await payAndPost('30000', [{ receivableId: receivable.id, amount: '30000' }]);
    current = await receivableFor(adminA, sale.id);
    expect(current.outstandingAmount).toBe('0.00');
    expect(current.paidAmount).toBe('50000.00');
    expect(current.status).toBe('PAID');

    const outstanding = await outstandingFor(adminA, ctxA.customerId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('0.00');
  });

  it('splits one payment across several invoices', async () => {
    const saleB = await postedSale(adminA, ctxA, '30000');
    const saleC = await postedSale(adminA, ctxA, '20000');
    const receivableB = await receivableFor(adminA, saleB.id);
    const receivableC = await receivableFor(adminA, saleC.id);

    // Owes 50000 + 30000 + 20000. Pay 60000 across the first two.
    const response = await payAndPost('60000', [
      { receivableId: receivable.id, amount: '50000' },
      { receivableId: receivableB.id, amount: '10000' },
    ]);

    expect(response.status).toBe(200);

    expect((await receivableFor(adminA, sale.id)).status).toBe('PAID');
    expect((await receivableFor(adminA, saleB.id)).outstandingAmount).toBe('20000.00');
    expect((await receivableFor(adminA, saleB.id)).status).toBe('PARTIALLY_PAID');
    expect((await receivableFor(adminA, saleC.id)).outstandingAmount).toBe('20000.00');

    const outstanding = await outstandingFor(adminA, ctxA.customerId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('40000.00');
  });

  it('writes one PAYMENT ledger entry as a credit for the full amount', async () => {
    await payAndPost('20000', [{ receivableId: receivable.id, amount: '20000' }]);

    const ledger = await ledgerFor(adminA, ctxA.customerId);
    const entries = ledger.body.data.ledger.entries;

    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('SALE');
    expect(entries[0].debit).toBe('50000.00');
    expect(entries[1].type).toBe('PAYMENT');
    expect(entries[1].credit).toBe('20000.00');
    expect(entries[1].balance).toBe('30000.00');
    expect(ledger.body.data.ledger.closingBalance).toBe('30000.00');
  });

  it('rejects allocating more than is left, under the lock', async () => {
    await payAndPost('45000', [{ receivableId: receivable.id, amount: '45000' }]);

    // A draft prepared while 50000 was outstanding, posted when only 5000 is.
    const stale = await createPayment(adminA, paymentBody(ctxA, { amount: '20000', allocations: [] }));
    await prisma.customerPaymentAllocation.create({
      data: {
        customerPaymentId: stale.body.data.payment.id,
        customerReceivableId: receivable.id,
        amount: '20000',
      },
    });

    const response = await postPayment(adminA, stale.body.data.payment.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
    expect((await receivableFor(adminA, sale.id)).outstandingAmount).toBe('5000.00');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(1);
  });

  it('rolls back completely when one allocation of several is invalid', async () => {
    const saleB = await postedSale(adminA, ctxA, '30000');
    const receivableB = await receivableFor(adminA, saleB.id);

    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '60000', allocations: [{ receivableId: receivable.id, amount: '30000' }] }),
    );
    // Force a second allocation that exceeds its invoice.
    await prisma.customerPaymentAllocation.create({
      data: {
        customerPaymentId: created.body.data.payment.id,
        customerReceivableId: receivableB.id,
        amount: '40000',
      },
    });

    const response = await postPayment(adminA, created.body.data.payment.id);
    expect(response.status).toBe(422);

    // The valid first allocation did not apply either.
    expect((await receivableFor(adminA, sale.id)).outstandingAmount).toBe('50000.00');
    expect((await receivableFor(adminA, saleB.id)).outstandingAmount).toBe('30000.00');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/customer-payments/${created.body.data.payment.id}`)
      .set(auth(adminA));
    expect(reread.body.data.payment.status).toBe('DRAFT');
  });

  it('cannot post the same payment twice', async () => {
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '10000', allocations: [{ receivableId: receivable.id, amount: '10000' }] }),
    );
    const id = created.body.data.payment.id;

    await postPayment(adminA, id);
    const second = await postPayment(adminA, id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('CUSTOMER_PAYMENT_ALREADY_POSTED');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(1);
    expect((await receivableFor(adminA, sale.id)).outstandingAmount).toBe('40000.00');
  });

  it('cannot edit or cancel a posted payment', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }));
    await postPayment(adminA, created.body.data.payment.id);

    const edited = await request(app)
      .patch(`/api/v1/customer-payments/${created.body.data.payment.id}`)
      .set(auth(adminA))
      .send(paymentBody(ctxA, { amount: '2000' }));
    const cancelled = await request(app)
      .post(`/api/v1/customer-payments/${created.body.data.payment.id}/cancel`)
      .set(auth(adminA));

    expect(edited.status).toBe(409);
    expect(cancelled.status).toBe(409);
  });

  it('keeps decimal precision exactly', async () => {
    const precise = await postedSale(adminA, ctxA, '0.10');
    const preciseReceivable = await receivableFor(adminA, precise.id);

    await payAndPost('0.10', [{ receivableId: preciseReceivable.id, amount: '0.10' }]);

    const reread = await receivableFor(adminA, precise.id);
    expect(reread.paidAmount).toBe('0.10');
    expect(reread.outstandingAmount).toBe('0.00');
    expect(reread.status).toBe('PAID');
  });
});

describe('customer advances', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
  });

  it('accepts a payment with no allocations and holds it as credit', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '20000', allocations: [] }));
    const posted = await postPayment(adminA, created.body.data.payment.id);

    expect(posted.status).toBe(200);
    expect(posted.body.data.payment.unallocatedAmount).toBe('20000.00');

    const outstanding = await outstandingFor(adminA, ctxA.customerId);
    // Negative: we are holding the customer's money.
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('-20000.00');
    expect(outstanding.body.data.outstanding.unallocatedCredit).toBe('20000.00');
  });

  it('keeps the partly-unallocated remainder as credit', async () => {
    const sale = await postedSale(adminA, ctxA, '30000');
    const receivable = await receivableFor(adminA, sale.id);

    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '50000', allocations: [{ receivableId: receivable.id, amount: '30000' }] }),
    );
    const posted = await postPayment(adminA, created.body.data.payment.id);

    expect(posted.body.data.payment.allocatedAmount).toBe('30000.00');
    expect(posted.body.data.payment.unallocatedAmount).toBe('20000.00');

    const outstanding = await outstandingFor(adminA, ctxA.customerId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('-20000.00');
    expect(outstanding.body.data.outstanding.invoiceOutstanding).toBe('0.00');
  });
});

describe('customer ledger, outstanding and views', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
  });

  it('reproduces a full sale-and-payment sequence', async () => {
    const sale = await postedSale(adminA, ctxA, '100000');
    const receivable = await receivableFor(adminA, sale.id);

    const first = await createPayment(
      adminA,
      paymentBody(ctxA, { paymentDate: '2026-09-05', amount: '40000', allocations: [{ receivableId: receivable.id, amount: '40000' }] }),
    );
    await postPayment(adminA, first.body.data.payment.id);

    const second = await createPayment(
      adminA,
      paymentBody(ctxA, { paymentDate: '2026-09-15', amount: '20000', allocations: [{ receivableId: receivable.id, amount: '20000' }] }),
    );
    await postPayment(adminA, second.body.data.payment.id);

    const ledger = await ledgerFor(adminA, ctxA.customerId);
    expect(ledger.body.data.ledger.entries.map((e) => e.type)).toEqual(['SALE', 'PAYMENT', 'PAYMENT']);
    expect(ledger.body.data.ledger.entries.map((e) => e.balance)).toEqual([
      '100000.00',
      '60000.00',
      '40000.00',
    ]);
    expect(ledger.body.data.ledger.closingBalance).toBe('40000.00');

    const outstanding = await outstandingFor(adminA, ctxA.customerId);
    expect(outstanding.body.data.outstanding).toMatchObject({
      totalSales: '100000.00',
      totalPayments: '60000.00',
      outstandingAmount: '40000.00',
      invoiceOutstanding: '40000.00',
      unallocatedCredit: '0.00',
    });
  });

  it('collapses earlier entries into an opening balance when filtered by date', async () => {
    const sale = await postedSale(adminA, ctxA, '50000');
    const receivable = await receivableFor(adminA, sale.id);
    const payment = await createPayment(
      adminA,
      paymentBody(ctxA, { paymentDate: '2026-10-05', amount: '10000', allocations: [{ receivableId: receivable.id, amount: '10000' }] }),
    );
    await postPayment(adminA, payment.body.data.payment.id);

    const filtered = await request(app)
      .get(`/api/v1/customers/${ctxA.customerId}/ledger?fromDate=2026-10-01`)
      .set(auth(adminA));

    // The sale (1 Sep) is before the window, so it forms the opening balance.
    expect(filtered.body.data.ledger.openingBalance).toBe('50000.00');
    expect(filtered.body.data.ledger.entries).toHaveLength(1);
    expect(filtered.body.data.ledger.closingBalance).toBe('40000.00');
  });

  it('lists only invoices that still owe money', async () => {
    const paid = await postedSale(adminA, ctxA, '1000');
    await postedSale(adminA, ctxA, '2000');
    const paidReceivable = await receivableFor(adminA, paid.id);

    const payment = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '1000', allocations: [{ receivableId: paidReceivable.id, amount: '1000' }] }),
    );
    await postPayment(adminA, payment.body.data.payment.id);

    const response = await request(app)
      .get(`/api/v1/customers/${ctxA.customerId}/receivables`)
      .set(auth(adminA));

    expect(response.body.data.receivables).toHaveLength(1);
    expect(response.body.data.receivables[0].outstandingAmount).toBe('2000.00');
  });

  it('returns a customer payment history', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '500' }));
    await postPayment(adminA, created.body.data.payment.id);

    const response = await request(app)
      .get(`/api/v1/customers/${ctxA.customerId}/payments`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.data[0].amount).toBe('500.00');
  });

  it('filters receivables and payments', async () => {
    await postedSale(adminA, ctxA, '1000');
    const cash = await createPayment(adminA, paymentBody(ctxA, { amount: '100', paymentMethod: 'CASH' }));
    await postPayment(adminA, cash.body.data.payment.id);

    const open = await request(app)
      .get('/api/v1/customer-receivables?status=OPEN')
      .set(auth(adminA));
    const outstandingOnly = await request(app)
      .get('/api/v1/customer-receivables?onlyOutstanding=true')
      .set(auth(adminA));
    const byMethod = await request(app)
      .get('/api/v1/customer-payments?paymentMethod=CASH')
      .set(auth(adminA));

    expect(open.body.pagination.total).toBe(1);
    expect(outstandingOnly.body.pagination.total).toBe(1);
    expect(byMethod.body.data.every((p) => p.paymentMethod === 'CASH')).toBe(true);
  });
});

describe('customer payment concurrency', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
  });

  it('lets only one of five simultaneous posts of the same payment through', async () => {
    const sale = await postedSale(adminA, ctxA, '10000');
    const receivable = await receivableFor(adminA, sale.id);

    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '10000', allocations: [{ receivableId: receivable.id, amount: '10000' }] }),
    );
    const id = created.body.data.payment.id;

    const results = await Promise.all(Array.from({ length: 5 }, () => postPayment(adminA, id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);

    expect((await receivableFor(adminA, sale.id)).outstandingAmount).toBe('0.00');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(1);
  });

  it('lets only one of five payments consume the same outstanding 10000', async () => {
    const sale = await postedSale(adminA, ctxA, '10000');
    const receivable = await receivableFor(adminA, sale.id);

    const drafts = await Promise.all(
      Array.from({ length: 5 }, () =>
        createPayment(
          adminA,
          paymentBody(ctxA, { amount: '10000', allocations: [{ receivableId: receivable.id, amount: '10000' }] }),
        ),
      ),
    );

    const results = await Promise.all(
      drafts.map((draft) => postPayment(adminA, draft.body.data.payment.id)),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(4);

    const reread = await receivableFor(adminA, sale.id);
    expect(reread.outstandingAmount).toBe('0.00');
    expect(reread.paidAmount).toBe('10000.00');
  });

  it('gives concurrent drafts distinct payment numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createPayment(adminA, paymentBody(ctxA, { amount: '100' }))),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.payment.paymentNumber)).size).toBe(6);
  });
});

describe('customer payment RBAC and tenant isolation', () => {
  let saleA;
  let receivableA;
  let paymentA;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, '1000', '10');
    await stockUp(adminB, ctxB, '1000', '10');

    saleA = await postedSale(adminA, ctxA, '10000');
    receivableA = await receivableFor(adminA, saleA.id);
    paymentA = (await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }))).body.data.payment;
  });

  it('lets STAFF read receivables, payments and the ledger', async () => {
    const receivables = await request(app).get('/api/v1/customer-receivables').set(auth(staffA));
    const payments = await request(app).get('/api/v1/customer-payments').set(auth(staffA));
    const ledger = await ledgerFor(staffA, ctxA.customerId);
    const outstanding = await outstandingFor(staffA, ctxA.customerId);

    expect(receivables.status).toBe(200);
    expect(payments.status).toBe(200);
    expect(ledger.status).toBe(200);
    expect(outstanding.status).toBe(200);
  });

  it('forbids STAFF from creating, posting or cancelling a payment', async () => {
    const created = await createPayment(staffA, paymentBody(ctxA, { amount: '100' }));
    const posted = await postPayment(staffA, paymentA.id);
    const cancelled = await request(app)
      .post(`/api/v1/customer-payments/${paymentA.id}/cancel`)
      .set(auth(staffA));

    expect(created.status).toBe(403);
    expect(posted.status).toBe(403);
    expect(cancelled.status).toBe(403);
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);
  });

  it('requires authentication', async () => {
    const receivables = await request(app).get('/api/v1/customer-receivables');
    const payments = await request(app).get('/api/v1/customer-payments');
    const ledger = await request(app).get(`/api/v1/customers/${ctxA.customerId}/ledger`);

    expect(receivables.status).toBe(401);
    expect(payments.status).toBe(401);
    expect(ledger.status).toBe(401);
  });

  it('lists only the current company receivables and payments', async () => {
    await postedSale(adminB, ctxB, '7777');

    const receivablesA = await request(app).get('/api/v1/customer-receivables').set(auth(adminA));
    const receivablesB = await request(app).get('/api/v1/customer-receivables').set(auth(adminB));
    const paymentsB = await request(app).get('/api/v1/customer-payments').set(auth(adminB));

    expect(receivablesA.body.pagination.total).toBe(1);
    expect(receivablesA.body.data[0].originalAmount).toBe('10000.00');
    expect(receivablesB.body.data[0].originalAmount).toBe('7777.00');
    expect(paymentsB.body.pagination.total).toBe(0);
  });

  it('returns 404 for another company receivable, payment, ledger and outstanding', async () => {
    const receivable = await request(app)
      .get(`/api/v1/customer-receivables/${receivableA.id}`)
      .set(auth(adminB));
    const payment = await request(app)
      .get(`/api/v1/customer-payments/${paymentA.id}`)
      .set(auth(adminB));
    const ledger = await ledgerFor(adminB, ctxA.customerId);
    const outstanding = await outstandingFor(adminB, ctxA.customerId);

    expect(receivable.status).toBe(404);
    expect(payment.status).toBe(404);
    expect(ledger.status).toBe(404);
    expect(ledger.body.code).toBe('CUSTOMER_NOT_FOUND');
    expect(outstanding.status).toBe(404);
  });

  it('refuses to post or cancel another company payment', async () => {
    const posted = await postPayment(adminB, paymentA.id);
    const cancelled = await request(app)
      .post(`/api/v1/customer-payments/${paymentA.id}/cancel`)
      .set(auth(adminB));

    expect(posted.status).toBe(404);
    expect(cancelled.status).toBe(404);

    const reread = await request(app)
      .get(`/api/v1/customer-payments/${paymentA.id}`)
      .set(auth(adminA));
    expect(reread.body.data.payment.status).toBe('DRAFT');
  });

  it("refuses to allocate against another company's invoice", async () => {
    const response = await createPayment(adminB, {
      ...paymentBody(ctxB, { customerId: ctxB.customerId, amount: '1000' }),
      allocations: [{ receivableId: receivableA.id, amount: '1000' }],
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CUSTOMER_RECEIVABLE_NOT_FOUND');
  });

  it('ignores a companyId sent in the body', async () => {
    const response = await createPayment(adminA, {
      ...paymentBody(ctxA, { amount: '500' }),
      companyId: companyB.company.id,
    });

    expect(response.status).toBe(201);
    const stored = await prisma.customerPayment.findUnique({
      where: { id: response.body.data.payment.id },
    });
    expect(stored.companyId).toBe(companyA.company.id);
  });
});
