import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { app } from '../../src/app.js';

// Customer/supplier credit, collections and payment allocation, end to end.
//
// The figures are deliberately the ones from the brief, so they can be checked
// by hand:
//
//   Invoice A 12,000 + Invoice B 8,000, a receipt of 15,000
//     -> A settled in full, B part-paid 3,000, 5,000 still open
//
// Everything a report claims is cross-checked against the general ledger in the
// reconciliation block at the end: a sub-ledger that disagrees with the GL is
// worse than no sub-ledger.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const DECIMAL_ZERO = new Prisma.Decimal(0);

const CASH = '1000';
const BANK = '1010';
const ACCOUNTS_RECEIVABLE = '1200';
const ACCOUNTS_PAYABLE = '2000';

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let ctxA;
let ctxB;

async function prepareCompany(token, suffix) {
  const post = (path, body) => request(app).post(path).set(auth(token)).send(body);

  const category = await post('/api/v1/categories', { name: `CRCat ${suffix}` });
  const unit = await post('/api/v1/units', { name: `CRUnit ${suffix}`, shortCode: `CR${suffix}` });
  const product = await post('/api/v1/products', {
    name: `CRProd ${suffix}`,
    sku: `CRSKU-${suffix}`,
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
  });
  const warehouse = await post('/api/v1/warehouses', {
    name: `CRWH ${suffix}`,
    code: `CW${suffix}`,
  });
  const supplier = await post('/api/v1/suppliers', { name: `CRSup ${suffix}`, creditDays: 15 });
  const supplier2 = await post('/api/v1/suppliers', { name: `CRSup2 ${suffix}` });

  // One customer with a limit and terms, one with neither.
  const limited = await post('/api/v1/customers', {
    name: `CRLimited ${suffix}`,
    creditLimit: '20000',
    creditDays: 30,
  });
  const open = await post('/api/v1/customers', { name: `CROpen ${suffix}` });

  expect(limited.status).toBe(201);

  return {
    productId: product.body.data.product.id,
    warehouseId: warehouse.body.data.warehouse.id,
    supplierId: supplier.body.data.supplier.id,
    supplierId2: supplier2.body.data.supplier.id,
    limitedId: limited.body.data.customer.id,
    openId: open.body.data.customer.id,
  };
}

/** Buys enough stock that no sale below can ever fail for want of it. */
async function stockUp(token, ctx, quantity = '100000', unitCost = '1') {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `CRB-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-01',
      items: [{ productId: ctx.productId, quantity, unitCost }],
    });
  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

/** A draft sale of exactly `total`: one unit priced at the total, no tax. */
function saleBody(ctx, total, overrides = {}) {
  return {
    customerId: overrides.customerId ?? ctx.limitedId,
    warehouseId: ctx.warehouseId,
    invoiceDate: overrides.invoiceDate ?? '2026-09-01',
    items: [{ productId: ctx.productId, quantity: '1', unitPrice: total }],
    ...(overrides.dueDate === undefined ? {} : { dueDate: overrides.dueDate }),
  };
}

async function draftSale(token, ctx, total, overrides = {}) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send(saleBody(ctx, total, overrides));
  expect(created.status).toBe(201);
  return created.body.data.sale;
}

const postSale = (token, id, body) =>
  request(app)
    .post(`/api/v1/sales/${id}/post`)
    .set(auth(token))
    .send(body ?? {});

async function postedSale(token, ctx, total, overrides = {}) {
  const draft = await draftSale(token, ctx, total, overrides);
  const posted = await postSale(token, draft.id, overrides.postBody);
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

async function receivableFor(token, saleId) {
  const response = await request(app)
    .get('/api/v1/customer-receivables?limit=100')
    .set(auth(token));
  return response.body.data.find((row) => row.salesInvoice.id === saleId);
}

async function payableFor(token, purchaseId) {
  const response = await request(app).get('/api/v1/supplier-payables?limit=100').set(auth(token));
  return response.body.data.find((row) => row.purchase.id === purchaseId);
}

/** Creates and posts a customer receipt with the given allocations. */
async function postedReceipt(token, { customerId, amount, allocations = [], paymentDate = '2026-09-15', paymentMethod = 'CASH' }) {
  const created = await request(app)
    .post('/api/v1/customer-payments')
    .set(auth(token))
    .send({ customerId, paymentDate, amount, paymentMethod, allocations });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

/** The net movement on one account, debit positive. */
async function balanceOf(companyId, code) {
  const account = await prisma.account.findFirst({ where: { companyId, code } });
  const lines = await prisma.journalLine.findMany({ where: { accountId: account.id } });
  return lines.reduce((total, line) => total.plus(line.debit).minus(line.credit), DECIMAL_ZERO);
}

const get = (token, path) => request(app).get(path).set(auth(token));

beforeAll(async () => {
  await resetDatabase();

  const a = await createCompanyWithUsers('cra');
  const b = await createCompanyWithUsers('crb');

  companyA = a.company;
  companyB = b.company;
  adminA = await login(app, a.admin.email, a.adminPassword);
  staffA = await login(app, a.staff.email, a.staffPassword);
  adminB = await login(app, b.admin.email, b.adminPassword);

  ctxA = await prepareCompany(adminA, 'A');
  ctxB = await prepareCompany(adminB, 'B');
});

beforeEach(async () => {
  // Everything transactional, children before parents.
  await prisma.customerPaymentAllocation.deleteMany();
  await prisma.customerLedgerEntry.deleteMany();
  await prisma.customerPayment.deleteMany();
  await prisma.customerReceivable.deleteMany();
  await prisma.salesReturnItem.deleteMany();
  await prisma.salesReturn.deleteMany();
  await prisma.salesInvoiceItem.deleteMany();
  await prisma.salesInvoice.deleteMany();
  await prisma.supplierPaymentAllocation.deleteMany();
  await prisma.supplierLedgerEntry.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.supplierPayable.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.documentSequence.deleteMany();

  // Restore the credit terms a test may have changed.
  await prisma.customer.update({
    where: { id: ctxA.limitedId },
    data: { creditLimit: '20000', creditDays: 30 },
  });
  await prisma.customer.update({
    where: { id: ctxA.openId },
    data: { creditLimit: '0', creditDays: null },
  });

  await stockUp(adminA, ctxA);
});

afterAll(async () => {
  await resetDatabase();
});

// ===========================================================================
// 1-8  Credit limits
// ===========================================================================

describe('the credit limit', () => {
  it('1. allows a sale that fits inside the limit', async () => {
    const sale = await postedSale(adminA, ctxA, '15000');

    expect(sale.status).toBe('POSTED');
    expect(sale.creditLimitOverride).toBeNull();
  });

  it('1b. fills the due date in from the credit terms on the customer', async () => {
    // The limited customer has 30-day terms and the invoice is dated 2026-09-01.
    const derived = await postedSale(adminA, ctxA, '5000');
    expect(derived.dueDate).toBe('2026-10-01');

    // An explicit date always wins: someone typed it on purpose.
    const explicit = await postedSale(adminA, ctxA, '5000', { dueDate: '2026-09-10' });
    expect(explicit.dueDate).toBe('2026-09-10');

    // And a customer with no terms gets no date, which is what keeps an
    // undated invoice out of the overdue figures.
    const undated = await postedSale(adminA, ctxA, '5000', { customerId: ctxA.openId });
    expect(undated.dueDate).toBeNull();
  });

  it('2. refuses a sale that would take the customer over', async () => {
    await postedSale(adminA, ctxA, '15000');

    const draft = await draftSale(adminA, ctxA, '8000');
    const response = await postSale(adminA, draft.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CREDIT_LIMIT_EXCEEDED');
    // The message says how far over, so the refusal is actionable.
    expect(response.body.message).toContain('23000.00');
    expect(response.body.message).toContain('20000.00');
    expect(response.body.message).toContain('3000.00');
  });

  it('3. rolls the whole posting back when the limit refuses it', async () => {
    await postedSale(adminA, ctxA, '15000');
    const entriesBefore = await prisma.journalEntry.count({ where: { companyId: companyA.id } });

    const draft = await draftSale(adminA, ctxA, '8000');
    await postSale(adminA, draft.id);

    // Still a draft, no receivable, no stock movement, no journal entry.
    const row = await prisma.salesInvoice.findUnique({ where: { id: draft.id } });
    expect(row.status).toBe('DRAFT');
    expect(await prisma.customerReceivable.count({ where: { salesInvoiceId: draft.id } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { referenceId: draft.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { companyId: companyA.id } })).toBe(entriesBefore);
  });

  it('4. allows a sale landing exactly on the limit', async () => {
    await postedSale(adminA, ctxA, '12000');
    const exact = await postedSale(adminA, ctxA, '8000');

    expect(exact.status).toBe('POSTED');

    const credit = await get(adminA, `/api/v1/customers/${ctxA.limitedId}/credit`);
    expect(credit.body.data.credit.position.outstanding).toBe('20000.00');
    expect(credit.body.data.credit.position.availableCredit).toBe('0.00');
  });

  it('5. treats a limit of zero as unlimited', async () => {
    // The customer with no limit set. This is the default every existing
    // customer carries, so it must never block anything.
    const huge = await postedSale(adminA, ctxA, '9999999', { customerId: ctxA.openId });

    expect(huge.status).toBe('POSTED');

    const credit = await get(adminA, `/api/v1/customers/${ctxA.openId}/credit`);
    expect(credit.body.data.credit.terms.isUnlimited).toBe(true);
    expect(credit.body.data.credit.position.availableCredit).toBeNull();
  });

  it('6. frees the credit back up when the customer pays', async () => {
    const sale = await postedSale(adminA, ctxA, '18000');
    const receivable = await receivableFor(adminA, sale.id);

    await postedReceipt(adminA, {
      customerId: ctxA.limitedId,
      amount: '10000',
      allocations: [{ receivableId: receivable.id, amount: '10000' }],
    });

    const credit = await get(adminA, `/api/v1/customers/${ctxA.limitedId}/credit`);
    expect(credit.body.data.credit.position.outstanding).toBe('8000.00');
    expect(credit.body.data.credit.position.availableCredit).toBe('12000.00');

    // And a sale that would have been refused before now fits.
    const next = await postedSale(adminA, ctxA, '12000');
    expect(next.status).toBe('POSTED');
  });

  it('7. frees credit back up when goods are returned', async () => {
    const sale = await postedSale(adminA, ctxA, '18000');

    const created = await request(app)
      .post('/api/v1/sales-returns')
      .set(auth(adminA))
      .send({
        salesInvoiceId: sale.id,
        returnDate: '2026-09-10',
        items: [{ salesInvoiceItemId: sale.items[0].id, quantity: '1' }],
      });
    expect(created.status).toBe(201);
    const returned = await request(app)
      .post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`)
      .set(auth(adminA));
    expect(returned.status).toBe(200);

    const credit = await get(adminA, `/api/v1/customers/${ctxA.limitedId}/credit`);
    expect(credit.body.data.credit.position.outstanding).toBe('0.00');
    expect(credit.body.data.credit.position.availableCredit).toBe('20000.00');
  });

  it('8. never counts a draft or a cancelled invoice against the limit', async () => {
    // Neither reaches the customer ledger, so neither can consume credit.
    await draftSale(adminA, ctxA, '19000');

    const toCancel = await draftSale(adminA, ctxA, '19000');
    await request(app).post(`/api/v1/sales/${toCancel.id}/cancel`).set(auth(adminA));

    const credit = await get(adminA, `/api/v1/customers/${ctxA.limitedId}/credit`);
    expect(credit.body.data.credit.position.outstanding).toBe('0.00');

    // So a full-limit sale still posts.
    const sale = await postedSale(adminA, ctxA, '20000');
    expect(sale.status).toBe('POSTED');
  });
});

// ===========================================================================
// 9-13  The admin override
// ===========================================================================

describe('the credit-limit override', () => {
  it('9. lets an ADMIN post past the limit deliberately', async () => {
    await postedSale(adminA, ctxA, '15000');

    const draft = await draftSale(adminA, ctxA, '8000');
    const response = await postSale(adminA, draft.id, {
      creditLimitOverride: true,
      creditLimitOverrideReason: 'Regular customer, cheque already in hand',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.sale.status).toBe('POSTED');
  });

  it('10. records who overrode, why, and what was owed at the time', async () => {
    await postedSale(adminA, ctxA, '15000');
    const draft = await draftSale(adminA, ctxA, '8000');

    const response = await postSale(adminA, draft.id, {
      creditLimitOverride: true,
      creditLimitOverrideReason: 'Cheque in hand',
    });

    expect(response.body.data.sale.creditLimitOverride).toEqual({
      reason: 'Cheque in hand',
      // Frozen: the live balance moves afterwards, this must not.
      outstandingAtOverride: '15000.00',
    });

    const row = await prisma.salesInvoice.findUnique({ where: { id: draft.id } });
    expect(row.creditLimitOverride).toBe(true);
    expect(row.creditLimitOverrideById).not.toBeNull();
  });

  it('11. leaves an ordinary invoice with no override recorded', async () => {
    const sale = await postedSale(adminA, ctxA, '5000');

    expect(sale.creditLimitOverride).toBeNull();

    const row = await prisma.salesInvoice.findUnique({ where: { id: sale.id } });
    expect(row.creditLimitOverride).toBe(false);
    expect(row.creditLimitOverrideById).toBeNull();
    expect(row.creditLimitOverrideExposure).toBeNull();
  });

  it('12. does not let STAFF override, because STAFF cannot post at all', async () => {
    await postedSale(adminA, ctxA, '15000');
    const draft = await draftSale(staffA, ctxA, '8000');

    const response = await postSale(staffA, draft.id, { creditLimitOverride: true });

    expect(response.status).toBe(403);
    expect((await prisma.salesInvoice.findUnique({ where: { id: draft.id } })).status).toBe('DRAFT');
  });

  it('13. rejects a reason without an override, and an unknown field', async () => {
    const draft = await draftSale(adminA, ctxA, '5000');

    const reasonAlone = await postSale(adminA, draft.id, { creditLimitOverrideReason: 'why' });
    expect(reasonAlone.status).toBe(400);

    const unknown = await postSale(adminA, draft.id, { forceIt: true });
    expect(unknown.status).toBe(400);

    // And posting with no body at all still works, exactly as before.
    const plain = await postSale(adminA, draft.id);
    expect(plain.status).toBe(200);
  });
});

// ===========================================================================
// 14-20  Payment allocation
// ===========================================================================

describe('collecting and allocating payment', () => {
  /** The brief's worked example: 12,000 + 8,000, paid 15,000. */
  async function twoInvoices() {
    const a = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    const b = await postedSale(adminA, ctxA, '8000', { customerId: ctxA.openId });
    return {
      a,
      b,
      receivableA: await receivableFor(adminA, a.id),
      receivableB: await receivableFor(adminA, b.id),
    };
  }

  it('14. splits one receipt across two invoices', async () => {
    const { receivableA, receivableB } = await twoInvoices();

    const payment = await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '15000',
      allocations: [
        { receivableId: receivableA.id, amount: '12000' },
        { receivableId: receivableB.id, amount: '3000' },
      ],
    });

    expect(payment.allocatedAmount).toBe('15000.00');
    expect(payment.unallocatedAmount).toBe('0.00');

    const after = await get(adminA, '/api/v1/customer-receivables?limit=100');
    const a = after.body.data.find((r) => r.id === receivableA.id);
    const b = after.body.data.find((r) => r.id === receivableB.id);

    expect(a.paidAmount).toBe('12000.00');
    expect(a.outstandingAmount).toBe('0.00');
    expect(a.status).toBe('PAID');

    expect(b.paidAmount).toBe('3000.00');
    expect(b.outstandingAmount).toBe('5000.00');
    expect(b.status).toBe('PARTIALLY_PAID');
  });

  it('15. refuses to allocate more than the payment', async () => {
    const { receivableA, receivableB } = await twoInvoices();

    const response = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: ctxA.openId,
        paymentDate: '2026-09-15',
        amount: '15000',
        paymentMethod: 'CASH',
        allocations: [
          { receivableId: receivableA.id, amount: '12000' },
          { receivableId: receivableB.id, amount: '8000' },
        ],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
  });

  it('16. refuses to allocate more than an invoice owes', async () => {
    const { receivableB } = await twoInvoices();

    const response = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: ctxA.openId,
        paymentDate: '2026-09-15',
        amount: '20000',
        paymentMethod: 'CASH',
        allocations: [{ receivableId: receivableB.id, amount: '9000' }],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_ALLOCATION_EXCEEDS_RECEIVABLE');
  });

  it('17. holds an unallocated remainder as customer credit', async () => {
    const { receivableA } = await twoInvoices();

    const payment = await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '15000',
      allocations: [{ receivableId: receivableA.id, amount: '12000' }],
    });

    expect(payment.unallocatedAmount).toBe('3000.00');

    // The ledger balance nets the advance; the open invoices do not.
    const credit = await get(adminA, `/api/v1/customers/${ctxA.openId}/credit`);
    expect(credit.body.data.credit.position.outstanding).toBe('5000.00');
    expect(credit.body.data.credit.position.invoiceOutstanding).toBe('8000.00');
  });

  it('18. never lets an invoice go negative through over-payment', async () => {
    const { receivableA } = await twoInvoices();

    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '12000',
      allocations: [{ receivableId: receivableA.id, amount: '12000' }],
    });

    const again = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: ctxA.openId,
        paymentDate: '2026-09-16',
        amount: '1000',
        paymentMethod: 'CASH',
        allocations: [{ receivableId: receivableA.id, amount: '1000' }],
      });

    expect(again.status).toBe(422);

    const row = await prisma.customerReceivable.findUnique({ where: { id: receivableA.id } });
    expect(row.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(row.outstandingAmount.isNegative()).toBe(false);
  });

  it("19. refuses to allocate against another customer's invoice", async () => {
    const { receivableA } = await twoInvoices();

    const response = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: ctxA.limitedId,
        paymentDate: '2026-09-15',
        amount: '5000',
        paymentMethod: 'CASH',
        allocations: [{ receivableId: receivableA.id, amount: '5000' }],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_PAYMENT_ALLOCATION');
  });

  it('20. allocates a supplier payment across bills the same way', async () => {
    const billA = await stockUp(adminA, ctxA, '1000', '12');
    const billB = await stockUp(adminA, ctxA, '1000', '8');

    const payableA = await payableFor(adminA, billA.id);
    const payableB = await payableFor(adminA, billB.id);

    expect(payableA.outstandingAmount).toBe('12000.00');
    expect(payableB.outstandingAmount).toBe('8000.00');

    const created = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        paymentDate: '2026-09-15',
        amount: '15000',
        paymentMethod: 'BANK_TRANSFER',
        allocations: [
          { payableId: payableA.id, amount: '12000' },
          { payableId: payableB.id, amount: '3000' },
        ],
      });
    expect(created.status).toBe(201);

    const posted = await request(app)
      .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
      .set(auth(adminA));
    expect(posted.status).toBe(200);

    const after = await get(adminA, '/api/v1/supplier-payables?limit=100');
    expect(after.body.data.find((r) => r.id === payableA.id).outstandingAmount).toBe('0.00');
    expect(after.body.data.find((r) => r.id === payableB.id).outstandingAmount).toBe('5000.00');
  });
});

// ===========================================================================
// 21-24  Concurrency
// ===========================================================================

describe('two requests at once', () => {
  it('21. never lets two invoices breach a limit together', async () => {
    // 12,000 each against a 20,000 limit: one must fit and one must not.
    const first = await draftSale(adminA, ctxA, '12000');
    const second = await draftSale(adminA, ctxA, '12000');

    const [a, b] = await Promise.all([
      postSale(adminA, first.id),
      postSale(adminA, second.id),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const refused = a.status === 422 ? a : b;
    expect(refused.body.code).toBe('CREDIT_LIMIT_EXCEEDED');

    // And the customer ended up inside their limit, not over it.
    const credit = await get(adminA, `/api/v1/customers/${ctxA.limitedId}/credit`);
    expect(credit.body.data.credit.position.outstanding).toBe('12000.00');
    expect(credit.body.data.credit.position.isOverLimit).toBe(false);
  });

  it('22. posts a receipt exactly once under a double request', async () => {
    const sale = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    const receivable = await receivableFor(adminA, sale.id);

    const created = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: ctxA.openId,
        paymentDate: '2026-09-15',
        amount: '12000',
        paymentMethod: 'CASH',
        allocations: [{ receivableId: receivable.id, amount: '12000' }],
      });
    const paymentId = created.body.data.payment.id;

    const [a, b] = await Promise.all([
      request(app).post(`/api/v1/customer-payments/${paymentId}/post`).set(auth(adminA)),
      request(app).post(`/api/v1/customer-payments/${paymentId}/post`).set(auth(adminA)),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);

    // One journal entry, one ledger entry, one settlement.
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: 'CUSTOMER_PAYMENT', sourceId: paymentId },
      }),
    ).toBe(1);
    expect(
      await prisma.customerLedgerEntry.count({
        where: { referenceType: 'CUSTOMER_PAYMENT', referenceId: paymentId },
      }),
    ).toBe(1);

    const row = await prisma.customerReceivable.findUnique({ where: { id: receivable.id } });
    expect(row.paidAmount.toFixed(2)).toBe('12000.00');
    expect(row.outstandingAmount.toFixed(2)).toBe('0.00');
  });

  it('23. never over-allocates when two receipts target one invoice', async () => {
    const sale = await postedSale(adminA, ctxA, '10000', { customerId: ctxA.openId });
    const receivable = await receivableFor(adminA, sale.id);

    const drafts = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post('/api/v1/customer-payments')
          .set(auth(adminA))
          .send({
            customerId: ctxA.openId,
            paymentDate: '2026-09-15',
            amount: '10000',
            paymentMethod: 'CASH',
            allocations: [{ receivableId: receivable.id, amount: '10000' }],
          }),
      ),
    );

    // Both drafts were valid when written. Only one can post.
    const [a, b] = await Promise.all(
      drafts.map((d) =>
        request(app)
          .post(`/api/v1/customer-payments/${d.body.data.payment.id}/post`)
          .set(auth(adminA)),
      ),
    );

    expect([a.status, b.status].sort()).toEqual([200, 422]);

    const row = await prisma.customerReceivable.findUnique({ where: { id: receivable.id } });
    expect(row.paidAmount.toFixed(2)).toBe('10000.00');
    expect(row.outstandingAmount.toFixed(2)).toBe('0.00');
  });

  it('24. serialises two sales for different customers without blocking', async () => {
    // Different customers take different locks, so neither waits on the other
    // and both post.
    const first = await draftSale(adminA, ctxA, '9000');
    const second = await draftSale(adminA, ctxA, '9000', { customerId: ctxA.openId });

    const [a, b] = await Promise.all([
      postSale(adminA, first.id),
      postSale(adminA, second.id),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

// ===========================================================================
// 25-30  Statements
// ===========================================================================

describe('the customer statement', () => {
  async function activity() {
    const a = await postedSale(adminA, ctxA, '12000', {
      customerId: ctxA.openId,
      invoiceDate: '2026-09-01',
    });
    const b = await postedSale(adminA, ctxA, '8000', {
      customerId: ctxA.openId,
      invoiceDate: '2026-09-05',
    });
    const receivableA = await receivableFor(adminA, a.id);

    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '15000',
      paymentDate: '2026-09-15',
      allocations: [
        { receivableId: receivableA.id, amount: '12000' },
        { receivableId: (await receivableFor(adminA, b.id)).id, amount: '3000' },
      ],
    });

    return { a, b };
  }

  it('25. lists every document with a running balance', async () => {
    await activity();

    const response = await get(adminA, `/api/v1/customers/${ctxA.openId}/statement`);
    expect(response.status).toBe(200);
    const statement = response.body.data.statement;

    expect(statement.openingBalance).toBe('0.00');
    expect(statement.lines).toHaveLength(3);

    // 12,000 owed, then 20,000, then 15,000 paid leaves 5,000.
    expect(statement.lines.map((line) => line.balance)).toEqual([
      '12000.00',
      '20000.00',
      '5000.00',
    ]);
    expect(statement.closingBalance).toBe('5000.00');
  });

  it('26. names the document behind every line', async () => {
    const { a, b } = await activity();

    const statement = (await get(adminA, `/api/v1/customers/${ctxA.openId}/statement`)).body.data
      .statement;

    expect(statement.lines[0].documentNumber).toBe(a.invoiceNumber);
    expect(statement.lines[0].label).toBe('Invoice');
    expect(statement.lines[1].documentNumber).toBe(b.invoiceNumber);
    expect(statement.lines[2].label).toBe('Receipt');
    expect(statement.lines[2].documentNumber).toMatch(/^RCP-/);

    // Every line traces back to its source document.
    expect(statement.lines.every((line) => typeof line.documentId === 'string')).toBe(true);
  });

  it('27. puts debits and credits on the right sides', async () => {
    await activity();

    const statement = (await get(adminA, `/api/v1/customers/${ctxA.openId}/statement`)).body.data
      .statement;

    expect(statement.lines[0]).toMatchObject({ debit: '12000.00', credit: '0.00' });
    expect(statement.lines[2]).toMatchObject({ debit: '0.00', credit: '15000.00' });

    expect(statement.totals).toMatchObject({
      openingBalance: '0.00',
      totalDebit: '20000.00',
      totalCredit: '15000.00',
      closingBalance: '5000.00',
      entryCount: 3,
    });
  });

  it('28. does not lose history when a window is given', async () => {
    await activity();

    // Everything before the window becomes the opening balance, so the closing
    // figure is the real position rather than the movement inside the window.
    const windowed = (
      await get(
        adminA,
        `/api/v1/customers/${ctxA.openId}/statement?fromDate=2026-09-10&toDate=2026-09-30`,
      )
    ).body.data.statement;

    expect(windowed.openingBalance).toBe('20000.00');
    expect(windowed.lines).toHaveLength(1);
    expect(windowed.closingBalance).toBe('5000.00');
  });

  it('29. produces a supplier statement with the mirror sign', async () => {
    const bill = await stockUp(adminA, ctxA, '1000', '12');
    const payable = await payableFor(adminA, bill.id);

    const created = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        paymentDate: '2026-09-15',
        amount: '5000',
        paymentMethod: 'BANK_TRANSFER',
        allocations: [{ payableId: payable.id, amount: '5000' }],
      });
    await request(app)
      .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
      .set(auth(adminA));

    const statement = (await get(adminA, `/api/v1/suppliers/${ctxA.supplierId}/statement`)).body
      .data.statement;

    // The opening purchase from beforeEach is in here too, so check the shape
    // and the direction rather than one exact figure.
    const bills = statement.lines.filter((line) => line.label === 'Bill');
    const payments = statement.lines.filter((line) => line.label === 'Payment');

    expect(bills.length).toBeGreaterThanOrEqual(1);
    expect(payments).toHaveLength(1);
    // A bill credits the supplier (we owe more); a payment debits (we owe less).
    expect(bills.every((line) => line.credit !== '0.00')).toBe(true);
    expect(payments[0].debit).toBe('5000.00');
    expect(statement.balanceMeaning).toMatch(/business owes the supplier/i);
  });

  it('30. never shows a draft or a cancelled document', async () => {
    await activity();

    await draftSale(adminA, ctxA, '50000', { customerId: ctxA.openId });
    const toCancel = await draftSale(adminA, ctxA, '50000', { customerId: ctxA.openId });
    await request(app).post(`/api/v1/sales/${toCancel.id}/cancel`).set(auth(adminA));

    const statement = (await get(adminA, `/api/v1/customers/${ctxA.openId}/statement`)).body.data
      .statement;

    // Still three lines: neither ever reached the ledger.
    expect(statement.lines).toHaveLength(3);
    expect(statement.closingBalance).toBe('5000.00');
    expect(JSON.stringify(statement)).not.toContain('50000');
  });
});

// ===========================================================================
// 31-36  Collections and ageing
// ===========================================================================

describe('the collection summary', () => {
  async function overdueAndCurrent() {
    // Due 2026-09-01: badly overdue by 2026-10-15.
    await postedSale(adminA, ctxA, '12000', {
      customerId: ctxA.openId,
      invoiceDate: '2026-08-01',
      dueDate: '2026-09-01',
    });
    // Due 2026-10-20: not yet due.
    await postedSale(adminA, ctxA, '8000', {
      customerId: ctxA.openId,
      invoiceDate: '2026-10-01',
      dueDate: '2026-10-20',
    });
    // No due date, and no credit terms to derive one from: outstanding, but
    // never overdue. The "open" customer has no terms; the limited one has 30
    // days, which would fill a date in.
    await postedSale(adminA, ctxA, '5000', {
      customerId: ctxA.openId,
      invoiceDate: '2026-10-01',
      dueDate: null,
    });
  }

  it('31. separates overdue, not yet due and undated', async () => {
    await overdueAndCurrent();

    const response = await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15');
    expect(response.status).toBe(200);
    const collections = response.body.data.collections;

    expect(collections.outstanding.total).toBe('25000.00');
    expect(collections.outstanding.overdue).toBe('12000.00');
    expect(collections.outstanding.notYetDue).toBe('8000.00');
    // Outstanding but nobody agreed a date, so nothing has been missed.
    expect(collections.outstanding.undated).toBe('5000.00');
  });

  it('32. ages by days past due, not by document age', async () => {
    await overdueAndCurrent();

    const collections = (await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15')).body
      .data.collections;
    const bucket = Object.fromEntries(collections.ageing.map((row) => [row.bucket, row.amount]));

    // Due 2026-09-01, read on 2026-10-15: 44 days late.
    expect(bucket['31-60']).toBe('12000.00');
    expect(bucket.NOT_DUE).toBe('8000.00');
    expect(bucket.UNDATED).toBe('5000.00');

    // Every bucket is present even when empty, so a client never handles a gap.
    expect(collections.ageing.map((row) => row.bucket)).toEqual([
      'NOT_DUE',
      '1-30',
      '31-60',
      '61-90',
      '90+',
      'UNDATED',
    ]);
  });

  it('33. adds the buckets back up to the total', async () => {
    await overdueAndCurrent();

    const collections = (await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15')).body
      .data.collections;

    const summed = collections.ageing.reduce(
      (total, row) => total.plus(row.amount),
      DECIMAL_ZERO,
    );
    expect(summed.toFixed(2)).toBe(collections.outstanding.total);
  });

  it('34. reports what falls due soon', async () => {
    await overdueAndCurrent();

    const soon = (
      await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15&dueWithinDays=7')
    ).body.data.collections.dueSoon;

    // The 8,000 due on the 20th is inside a 7-day horizon from the 15th.
    expect(soon.total).toBe('8000.00');
    expect(soon.invoiceCount).toBe(1);
    expect(soon.toDate).toBe('2026-10-22');

    const narrow = (
      await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15&dueWithinDays=1')
    ).body.data.collections.dueSoon;
    expect(narrow.total).toBe('0.00');
  });

  it('35. ranks the customers worth chasing first', async () => {
    await overdueAndCurrent();

    const collections = (await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15')).body
      .data.collections;

    expect(collections.topOverdueCustomers).toHaveLength(1);
    expect(collections.topOverdueCustomers[0]).toMatchObject({
      overdue: '12000.00',
      daysPastDue: 44,
      overdueBucket: '31-60',
    });
    expect(collections.topOverdueCustomers[0].oldestDueDate).toBe('2026-09-01');
  });

  it('36. counts posted receipts only', async () => {
    await overdueAndCurrent();

    // A draft receipt has collected nothing.
    await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: ctxA.openId,
        paymentDate: '2026-10-15',
        amount: '4000',
        paymentMethod: 'CASH',
      });

    const before = (await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15')).body.data
      .collections;
    expect(before.collected.today.total).toBe('0.00');

    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '4000',
      paymentDate: '2026-10-15',
    });

    const after = (await get(adminA, '/api/v1/credit/collections?asOfDate=2026-10-15')).body.data
      .collections;
    expect(after.collected.today.total).toBe('4000.00');
    expect(after.collected.today.receiptCount).toBe(1);
    // Nothing was allocated, so it is all customer credit.
    expect(after.collected.period.unallocated).toBe('4000.00');
  });
});

// ===========================================================================
// 37-40  Exposure, payables summary and the dashboard
// ===========================================================================

describe('credit across the whole book', () => {
  it('37. reports exposure and headroom per customer', async () => {
    await postedSale(adminA, ctxA, '15000');
    await postedSale(adminA, ctxA, '9000', { customerId: ctxA.openId });

    const exposure = (await get(adminA, '/api/v1/credit/exposure')).body.data.exposure;

    expect(exposure.summary.totalOutstanding).toBe('24000.00');
    expect(exposure.summary.totalCreditLimit).toBe('20000.00');
    expect(exposure.summary.totalAvailableCredit).toBe('5000.00');
    expect(exposure.summary.customersWithLimit).toBe(1);
    expect(exposure.summary.customersWithoutLimit).toBe(1);

    const limited = exposure.customers.find((row) => row.customerId === ctxA.limitedId);
    expect(limited.utilisationPercent).toBe('75.00');
    expect(limited.isOverLimit).toBe(false);
  });

  it('38. flags a customer who is over their limit', async () => {
    await postedSale(adminA, ctxA, '15000');
    const draft = await draftSale(adminA, ctxA, '8000');
    await postSale(adminA, draft.id, { creditLimitOverride: true, creditLimitOverrideReason: 'ok' });

    const exposure = (await get(adminA, '/api/v1/credit/exposure')).body.data.exposure;
    const limited = exposure.customers.find((row) => row.customerId === ctxA.limitedId);

    expect(limited.outstanding).toBe('23000.00');
    expect(limited.isOverLimit).toBe(true);
    expect(limited.availableCredit).toBe('0.00');
    expect(limited.utilisationPercent).toBe('100.00');
    expect(exposure.summary.overLimitCount).toBe(1);
  });

  it('39. summarises payables the same way', async () => {
    const bill = await stockUp(adminA, ctxA, '1000', '12');

    const payables = (await get(adminA, '/api/v1/credit/payables-summary?asOfDate=2026-10-15')).body
      .data.payables;

    // The supplier has 15-day terms, so the bill dated 2026-08-01 is due
    // 2026-08-16 and badly overdue by 2026-10-15.
    expect(payables.outstanding.overdue).not.toBe('0.00');
    expect(payables.topOverdueSuppliers.length).toBeGreaterThanOrEqual(1);
    expect(payables.ageing.map((row) => row.bucket)).toContain('90+');
    expect(bill.dueDate).toBe('2026-08-16');
  });

  it('40. puts credit and collections on the dashboard', async () => {
    const today = new Date().toISOString().slice(0, 10);

    await postedSale(adminA, ctxA, '15000', { invoiceDate: today });
    await postedReceipt(adminA, {
      customerId: ctxA.limitedId,
      amount: '5000',
      paymentDate: today,
    });

    const dashboard = (await get(adminA, '/api/v1/dashboard')).body.data.dashboard;

    expect(dashboard.balances.customerCredit.totalCreditLimit).toBe('20000.00');
    expect(dashboard.balances.customerCredit.availableCredit).toBe('10000.00');
    expect(dashboard.balances.customerCredit.utilisationPercent).toBe('50.00');
    expect(dashboard.balances.customerCredit.customersWithoutLimit).toBe(1);

    expect(dashboard.collections.received.total).toBe('5000.00');
    expect(dashboard.collections.received.unallocated).toBe('5000.00');
    expect(dashboard.collections.received.receiptCount).toBe(1);
  });
});

// ===========================================================================
// 41-45  Reconciliation against the general ledger
// ===========================================================================

describe('the sub-ledgers reconcile to the general ledger', () => {
  it('41. customer outstanding == sub-ledger == AR control account', async () => {
    const a = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    await postedSale(adminA, ctxA, '8000', { customerId: ctxA.openId });
    const receivableA = await receivableFor(adminA, a.id);

    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '15000',
      allocations: [{ receivableId: receivableA.id, amount: '12000' }],
    });

    // 1. What the credit summary reports.
    const credit = (await get(adminA, `/api/v1/customers/${ctxA.openId}/credit`)).body.data.credit;

    // 2. What the sub-ledger's own invoice rows say.
    const receivables = await prisma.customerReceivable.aggregate({
      where: { companyId: companyA.id },
      _sum: { outstandingAmount: true },
    });

    // 3. What the general ledger's AR control account says.
    const arBalance = await balanceOf(companyA.id, ACCOUNTS_RECEIVABLE);

    expect(credit.position.invoiceOutstanding).toBe('8000.00');
    expect(receivables._sum.outstandingAmount.toFixed(2)).toBe('8000.00');
    expect(arBalance.toFixed(2)).toBe('8000.00');

    // The ledger balance nets the 3,000 advance the invoices do not know about;
    // the difference is exactly that advance, sitting in Customer Advances.
    expect(credit.position.outstanding).toBe('5000.00');
    expect((await balanceOf(companyA.id, '2200')).toFixed(2)).toBe('-3000.00');
  });

  it('42. supplier outstanding == sub-ledger == AP control account', async () => {
    const bill = await stockUp(adminA, ctxA, '1000', '12');
    const payable = await payableFor(adminA, bill.id);

    const created = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        paymentDate: '2026-09-15',
        amount: '5000',
        paymentMethod: 'BANK_TRANSFER',
        allocations: [{ payableId: payable.id, amount: '5000' }],
      });
    await request(app)
      .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
      .set(auth(adminA));

    const payables = await prisma.supplierPayable.aggregate({
      where: { companyId: companyA.id },
      _sum: { outstandingAmount: true },
    });
    const summary = (await get(adminA, '/api/v1/credit/payables-summary')).body.data.payables;
    const apBalance = await balanceOf(companyA.id, ACCOUNTS_PAYABLE);

    expect(summary.outstanding.total).toBe(payables._sum.outstandingAmount.toFixed(2));
    // AP is credit-normal, so a debit-positive balance is negative.
    expect(apBalance.negated().toFixed(2)).toBe(summary.outstanding.total);
  });

  it('43. cash and bank reports equal their GL balances', async () => {
    const sale = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    const receivable = await receivableFor(adminA, sale.id);

    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '7000',
      paymentMethod: 'CASH',
      allocations: [{ receivableId: receivable.id, amount: '7000' }],
    });
    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '5000',
      paymentMethod: 'BANK',
      allocations: [{ receivableId: receivable.id, amount: '5000' }],
    });

    const report = (await get(adminA, '/api/v1/reports/cash-bank?limit=100')).body.data.report;
    const cash = report.accounts.find((row) => row.code === CASH);
    const bank = report.accounts.find((row) => row.code === BANK);

    expect(cash.closingBalance).toBe((await balanceOf(companyA.id, CASH)).toFixed(2));
    expect(bank.closingBalance).toBe((await balanceOf(companyA.id, BANK)).toFixed(2));
    expect(cash.moneyIn).toBe('7000.00');
    expect(bank.moneyIn).toBe('5000.00');
  });

  it('44. gives every posted receipt exactly one balanced journal entry', async () => {
    const sale = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    const receivable = await receivableFor(adminA, sale.id);

    const payment = await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '15000',
      allocations: [{ receivableId: receivable.id, amount: '12000' }],
    });

    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: 'CUSTOMER_PAYMENT', sourceId: payment.id },
      include: { lines: { include: { account: true } } },
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.totalDebit.equals(entry.totalCredit)).toBe(true);
    expect(entry.totalDebit.toFixed(2)).toBe('15000.00');

    // Dr Cash 15,000 / Cr AR 12,000 / Cr Customer Advances 3,000.
    const by = Object.fromEntries(entry.lines.map((line) => [line.account.code, line]));
    expect(by[CASH].debit.toFixed(2)).toBe('15000.00');
    expect(by[ACCOUNTS_RECEIVABLE].credit.toFixed(2)).toBe('12000.00');
    expect(by['2200'].credit.toFixed(2)).toBe('3000.00');
  });

  it('45. keeps the whole ledger balanced through the entire workflow', async () => {
    const a = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    await postedSale(adminA, ctxA, '8000', { customerId: ctxA.openId });
    const receivableA = await receivableFor(adminA, a.id);

    await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '15000',
      allocations: [{ receivableId: receivableA.id, amount: '12000' }],
    });

    const lines = await prisma.journalLine.findMany({ where: { companyId: companyA.id } });
    const totals = lines.reduce(
      (acc, line) => ({ debit: acc.debit.plus(line.debit), credit: acc.credit.plus(line.credit) }),
      { debit: DECIMAL_ZERO, credit: DECIMAL_ZERO },
    );

    expect(totals.debit.toFixed(4)).toBe(totals.credit.toFixed(4));

    const trial = (await get(adminA, '/api/v1/accounting/trial-balance')).body.data.trialBalance;
    expect(trial.isBalanced).toBe(true);
  });
});

// ===========================================================================
// 46-50  Non-GST, tenant isolation and RBAC
// ===========================================================================

describe('a shop with no GST registration', () => {
  it('46. runs the entire credit workflow without any GST configuration', async () => {
    const company = await prisma.company.findUnique({ where: { id: companyA.id } });
    expect(company.gstin).toBeNull();
    expect(company.stateCode).toBeNull();

    // Sell on credit.
    const sale = await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });
    expect(sale.status).toBe('POSTED');

    // See what is outstanding.
    const credit = (await get(adminA, `/api/v1/customers/${ctxA.openId}/credit`)).body.data.credit;
    expect(credit.position.outstanding).toBe('12000.00');

    // Receive and allocate a payment.
    const receivable = await receivableFor(adminA, sale.id);
    const payment = await postedReceipt(adminA, {
      customerId: ctxA.openId,
      amount: '7000',
      allocations: [{ receivableId: receivable.id, amount: '7000' }],
    });
    expect(payment.allocatedAmount).toBe('7000.00');

    // Read the statement.
    const statement = (await get(adminA, `/api/v1/customers/${ctxA.openId}/statement`)).body.data
      .statement;
    expect(statement.closingBalance).toBe('5000.00');

    // Pay a supplier and see what is owed.
    const bill = await stockUp(adminA, ctxA, '100', '10');
    const payable = await payableFor(adminA, bill.id);
    const supplierPayment = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        paymentDate: '2026-09-15',
        amount: '600',
        paymentMethod: 'CASH',
        allocations: [{ payableId: payable.id, amount: '600' }],
      });
    expect(
      (
        await request(app)
          .post(`/api/v1/supplier-payments/${supplierPayment.body.data.payment.id}/post`)
          .set(auth(adminA))
      ).status,
    ).toBe(200);

    expect((await get(adminA, '/api/v1/credit/payables-summary')).status).toBe(200);

    // And see the cash move.
    const cashBank = (await get(adminA, '/api/v1/reports/cash-bank')).body.data.report;
    expect(cashBank.accounts.find((row) => row.code === CASH).moneyIn).toBe('7000.00');

    // Not one GST field anywhere in any of it.
    expect(JSON.stringify(statement)).not.toMatch(/gstin|cgst|sgst|igst|hsn/i);
    expect(JSON.stringify(credit)).not.toMatch(/gstin|cgst|sgst|igst|hsn/i);
  });

  it('47. behaves identically once GST is enabled', async () => {
    await request(app)
      .patch('/api/v1/tax/profile')
      .set(auth(adminB))
      .send({ stateCode: '27', gstin: '27AAPFU0939F1ZV', registrationType: 'REGULAR' });

    // Once GST is on, a document cannot be classified without knowing each
    // party's state. That is a GST rule, and it touches nothing about credit.
    await prisma.customer.updateMany({ where: { companyId: companyB.id }, data: { stateCode: '27' } });
    await prisma.supplier.updateMany({ where: { companyId: companyB.id }, data: { stateCode: '27' } });
    await prisma.warehouse.updateMany({ where: { companyId: companyB.id }, data: { stateCode: '27' } });

    await stockUp(adminB, ctxB);
    const sale = await postedSale(adminB, ctxB, '12000', { customerId: ctxB.openId });

    const credit = (await get(adminB, `/api/v1/customers/${ctxB.openId}/credit`)).body.data.credit;
    const statement = (await get(adminB, `/api/v1/customers/${ctxB.openId}/statement`)).body.data
      .statement;

    // The same shape and the same rules; GST changed nothing about credit.
    expect(sale.status).toBe('POSTED');
    expect(credit.terms.isUnlimited).toBe(true);
    expect(statement.closingBalance).toBe('12000.00');
    expect(statement.lines[0].label).toBe('Invoice');

    await prisma.company.update({
      where: { id: companyB.id },
      data: { stateCode: null, gstin: null },
    });
    await prisma.customer.updateMany({ where: { companyId: companyB.id }, data: { stateCode: null } });
    await prisma.supplier.updateMany({ where: { companyId: companyB.id }, data: { stateCode: null } });
  });
});

describe('access and isolation', () => {
  it("48. never shows another company's statement, credit or collections", async () => {
    await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });

    for (const path of [
      `/api/v1/customers/${ctxA.openId}/statement`,
      `/api/v1/customers/${ctxA.openId}/credit`,
      `/api/v1/suppliers/${ctxA.supplierId}/statement`,
    ]) {
      const response = await get(adminB, path);
      expect(`${path}:${response.status}`).toBe(`${path}:404`);
    }

    // And B's own collections see nothing of A's money.
    const collections = (await get(adminB, '/api/v1/credit/collections')).body.data.collections;
    expect(collections.outstanding.total).toBe('0.00');
    expect((await get(adminB, '/api/v1/credit/exposure')).body.data.exposure.summary.totalOutstanding).toBe(
      '0.00',
    );
  });

  it("49. refuses to post a sale against another company's customer", async () => {
    const response = await request(app)
      .post('/api/v1/sales')
      .set(auth(adminA))
      .send(saleBody(ctxA, '1000', { customerId: ctxB.openId }));

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('50. lets STAFF read every credit view, and requires a token', async () => {
    await postedSale(adminA, ctxA, '12000', { customerId: ctxA.openId });

    const paths = [
      `/api/v1/customers/${ctxA.openId}/statement`,
      `/api/v1/customers/${ctxA.openId}/credit`,
      `/api/v1/suppliers/${ctxA.supplierId}/statement`,
      '/api/v1/credit/collections',
      '/api/v1/credit/payables-summary',
      '/api/v1/credit/exposure',
    ];

    for (const path of paths) {
      // A staff member who takes payments has to see who owes what.
      const asStaff = await get(staffA, path);
      expect(`staff ${path}:${asStaff.status}`).toBe(`staff ${path}:200`);

      const anonymous = await request(app).get(path);
      expect(`anon ${path}:${anonymous.status}`).toBe(`anon ${path}:401`);
    }
  });
});
