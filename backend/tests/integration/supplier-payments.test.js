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
    .send({ name: `PayCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `PayUnit ${suffix}`, shortCode: `PU${suffix}` });
  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `PayProd ${suffix}`,
      sku: `PAYSKU-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });
  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `PaySupplier ${suffix}` });
  const supplier2 = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `PaySupplier2 ${suffix}` });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `PayWH ${suffix}`, code: `PW${suffix}` });

  return {
    productId: product.body.data.product.id,
    supplierId: supplier.body.data.supplier.id,
    supplierId2: supplier2.body.data.supplier.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

/** Posts a purchase for a given total: quantity 1 at `total`, no tax. */
async function postedPurchase(token, ctx, total, supplierId) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: supplierId ?? ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `PAYI-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-28',
      dueDate: '2026-09-27',
      items: [{ productId: ctx.productId, quantity: '1', unitCost: total }],
    });

  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));

  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

async function payableFor(token, purchaseId) {
  const response = await request(app)
    .get('/api/v1/supplier-payables?limit=100')
    .set(auth(token));
  return response.body.data.find((payable) => payable.purchase.id === purchaseId);
}

const createPayment = (token, body) =>
  request(app).post('/api/v1/supplier-payments').set(auth(token)).send(body);

const postPayment = (token, id) =>
  request(app).post(`/api/v1/supplier-payments/${id}/post`).set(auth(token));

const outstandingFor = (token, supplierId) =>
  request(app).get(`/api/v1/suppliers/${supplierId}/outstanding`).set(auth(token));

const ledgerFor = (token, supplierId) =>
  request(app).get(`/api/v1/suppliers/${supplierId}/ledger`).set(auth(token));

function paymentBody(ctx, overrides = {}) {
  return {
    supplierId: ctx.supplierId,
    paymentDate: '2026-09-01',
    amount: '10000.00',
    paymentMethod: 'BANK_TRANSFER',
    referenceNumber: 'UTR123456',
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
  await prisma.supplierPaymentAllocation.deleteMany();
  await prisma.supplierLedgerEntry.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.supplierPayable.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
}

describe('payables raised by posting a purchase', () => {
  beforeEach(resetTransactions);

  it('creates exactly one payable for the purchase total', async () => {
    const purchase = await postedPurchase(adminA, ctxA, '100000');

    const payables = await request(app).get('/api/v1/supplier-payables').set(auth(adminA));

    expect(payables.body.pagination.total).toBe(1);
    const payable = payables.body.data[0];
    expect(payable.originalAmount).toBe('100000.00');
    expect(payable.outstandingAmount).toBe('100000.00');
    expect(payable.paidAmount).toBe('0.00');
    expect(payable.creditAmount).toBe('0.00');
    expect(payable.status).toBe('OPEN');
    expect(payable.purchase.id).toBe(purchase.id);
    expect(payable.dueDate).toBe('2026-09-27');
  });

  it('creates no payable while the purchase is a draft', async () => {
    await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `DRAFT-${Math.random().toString(36).slice(2, 8)}`,
        invoiceDate: '2026-08-28',
        items: [{ productId: ctxA.productId, quantity: '1', unitCost: '500' }],
      });

    expect(await prisma.supplierPayable.count()).toBe(0);
    expect(await prisma.supplierLedgerEntry.count()).toBe(0);
  });

  it('creates no payable for a cancelled purchase', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `CANC-${Math.random().toString(36).slice(2, 8)}`,
        invoiceDate: '2026-08-28',
        items: [{ productId: ctxA.productId, quantity: '1', unitCost: '500' }],
      });
    await request(app)
      .post(`/api/v1/purchases/${created.body.data.purchase.id}/cancel`)
      .set(auth(adminA));

    expect(await prisma.supplierPayable.count()).toBe(0);
  });

  it('does not create a second payable when the purchase is posted again', async () => {
    const purchase = await postedPurchase(adminA, ctxA, '100000');

    const second = await request(app)
      .post(`/api/v1/purchases/${purchase.id}/post`)
      .set(auth(adminA));

    expect(second.status).toBe(409);
    expect(await prisma.supplierPayable.count()).toBe(1);
    expect(await prisma.supplierLedgerEntry.count()).toBe(1);
  });

  it('writes one PURCHASE ledger entry as a credit', async () => {
    await postedPurchase(adminA, ctxA, '100000');

    const ledger = await ledgerFor(adminA, ctxA.supplierId);

    expect(ledger.body.data.ledger.entries).toHaveLength(1);
    const entry = ledger.body.data.ledger.entries[0];
    expect(entry.type).toBe('PURCHASE');
    expect(entry.credit).toBe('100000.00');
    expect(entry.debit).toBe('0.00');
    expect(entry.balance).toBe('100000.00');
    expect(ledger.body.data.ledger.closingBalance).toBe('100000.00');
  });

  it('rolls back the payable when posting fails', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `FAIL-${Math.random().toString(36).slice(2, 8)}`,
        invoiceDate: '2026-08-28',
        items: [{ productId: ctxA.productId, quantity: '1', unitCost: '500' }],
      });

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const posted = await request(app)
      .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
      .set(auth(adminA));

    expect(posted.status).toBe(422);
    expect(await prisma.supplierPayable.count()).toBe(0);
    expect(await prisma.supplierLedgerEntry.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('credits raised by posting a purchase return', () => {
  beforeEach(resetTransactions);

  async function purchaseAndReturn(purchaseTotal, returnQuantity) {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `RET-${Math.random().toString(36).slice(2, 10)}`,
        invoiceDate: '2026-08-28',
        items: [{ productId: ctxA.productId, quantity: '10', unitCost: purchaseTotal }],
      });
    const purchase = created.body.data.purchase;
    await request(app).post(`/api/v1/purchases/${purchase.id}/post`).set(auth(adminA));

    const draftReturn = await request(app)
      .post('/api/v1/purchase-returns')
      .set(auth(adminA))
      .send({
        purchaseId: purchase.id,
        returnDate: '2026-08-30',
        items: [{ purchaseItemId: purchase.items[0].id, quantity: returnQuantity }],
      });
    await request(app)
      .post(`/api/v1/purchase-returns/${draftReturn.body.data.purchaseReturn.id}/post`)
      .set(auth(adminA));

    return { purchase, purchaseReturn: draftReturn.body.data.purchaseReturn };
  }

  it('reduces the payable rather than creating a new one', async () => {
    // 10 x 10000 = 100000 purchased; return 2 = 20000 credit.
    await purchaseAndReturn('10000', '2');

    const payables = await request(app).get('/api/v1/supplier-payables').set(auth(adminA));

    expect(payables.body.pagination.total).toBe(1);
    const payable = payables.body.data[0];
    expect(payable.originalAmount).toBe('100000.00');
    expect(payable.creditAmount).toBe('20000.00');
    expect(payable.outstandingAmount).toBe('80000.00');
    expect(payable.status).toBe('PARTIALLY_PAID');
  });

  it('shows the credit as a debit entry and lowers the balance to 80000', async () => {
    await purchaseAndReturn('10000', '2');

    const ledger = await ledgerFor(adminA, ctxA.supplierId);
    const entries = ledger.body.data.ledger.entries;

    expect(entries).toHaveLength(2);
    expect(entries[1].type).toBe('PURCHASE_RETURN');
    expect(entries[1].debit).toBe('20000.00');
    expect(entries[1].balance).toBe('80000.00');
    expect(ledger.body.data.ledger.closingBalance).toBe('80000.00');
  });

  it('does not alter the original purchase', async () => {
    const { purchase } = await purchaseAndReturn('10000', '2');

    const reread = await request(app).get(`/api/v1/purchases/${purchase.id}`).set(auth(adminA));
    expect(reread.body.data.purchase.grandTotal).toBe('100000.00');
    expect(reread.body.data.purchase.items[0].quantity).toBe('10.000');
  });

  it('marks the payable CREDITED when returns settle it entirely', async () => {
    await purchaseAndReturn('10000', '10');

    const payables = await request(app).get('/api/v1/supplier-payables').set(auth(adminA));
    expect(payables.body.data[0].outstandingAmount).toBe('0.00');
    expect(payables.body.data[0].status).toBe('CREDITED');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('0.00');
  });
});

describe('supplier payment drafts', () => {
  let purchase;
  let payable;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await postedPurchase(adminA, ctxA, '100000');
    payable = await payableFor(adminA, purchase.id);
  });

  it('creates a draft with a generated payment number', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '30000', allocations: [{ payableId: payable.id, amount: '30000' }] }),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.payment.status).toBe('DRAFT');
    expect(response.body.data.payment.paymentNumber).toMatch(/^PAY-2026-\d{6}$/);
    expect(response.body.data.payment.allocatedAmount).toBe('30000.00');
    expect(response.body.data.payment.unallocatedAmount).toBe('0.00');
  });

  it('does not change the payable or the ledger while it is a draft', async () => {
    await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '30000', allocations: [{ payableId: payable.id, amount: '30000' }] }),
    );

    const reread = await payableFor(adminA, purchase.id);
    expect(reread.outstandingAmount).toBe('100000.00');
    expect(await prisma.supplierLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);
  });

  it('reads and lists payments', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '5000' }));

    const one = await request(app)
      .get(`/api/v1/supplier-payments/${created.body.data.payment.id}`)
      .set(auth(adminA));
    const list = await request(app).get('/api/v1/supplier-payments').set(auth(adminA));

    expect(one.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].allocations).toBeUndefined();
  });

  it('updates a draft and recalculates the split', async () => {
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '30000', allocations: [{ payableId: payable.id, amount: '30000' }] }),
    );

    const response = await request(app)
      .patch(`/api/v1/supplier-payments/${created.body.data.payment.id}`)
      .set(auth(adminA))
      .send(paymentBody(ctxA, { amount: '50000', allocations: [{ payableId: payable.id, amount: '40000' }] }));

    expect(response.status).toBe(200);
    expect(response.body.data.payment.amount).toBe('50000.00');
    expect(response.body.data.payment.allocatedAmount).toBe('40000.00');
    expect(response.body.data.payment.unallocatedAmount).toBe('10000.00');
  });

  it('cancels a draft, after which it cannot be posted', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }));
    const id = created.body.data.payment.id;

    const cancelled = await request(app)
      .post(`/api/v1/supplier-payments/${id}/cancel`)
      .set(auth(adminA));
    expect(cancelled.body.data.payment.status).toBe('CANCELLED');

    const posted = await postPayment(adminA, id);
    expect(posted.status).toBe(409);
  });

  it('refuses to move a payment to a different supplier', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }));

    const response = await request(app)
      .patch(`/api/v1/supplier-payments/${created.body.data.payment.id}`)
      .set(auth(adminA))
      .send(paymentBody(ctxA, { amount: '1000', supplierId: ctxA.supplierId2 }));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SUPPLIER_PAYMENT_SUPPLIER_IMMUTABLE');
  });
});

describe('supplier payment validation', () => {
  let purchase;
  let payable;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await postedPurchase(adminA, ctxA, '100000');
    payable = await payableFor(adminA, purchase.id);
  });

  it('rejects a zero or negative amount', async () => {
    const zero = await createPayment(adminA, paymentBody(ctxA, { amount: '0' }));
    const negative = await createPayment(adminA, paymentBody(ctxA, { amount: '-100' }));

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects an unknown payment method and a malformed date', async () => {
    const method = await createPayment(adminA, paymentBody(ctxA, { paymentMethod: 'BITCOIN' }));
    const date = await createPayment(adminA, paymentBody(ctxA, { paymentDate: '01/09/2026' }));

    expect(method.status).toBe(400);
    expect(date.status).toBe(400);
  });

  it('rejects the same payable twice in one payment', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, {
        amount: '5000',
        allocations: [
          { payableId: payable.id, amount: '1000' },
          { payableId: payable.id, amount: '2000' },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('more than once');
  });

  it('rejects allocations totalling more than the payment', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '5000', allocations: [{ payableId: payable.id, amount: '6000' }] }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
  });

  it('rejects allocating more than the bill has outstanding', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, {
        amount: '200000',
        allocations: [{ payableId: payable.id, amount: '150000' }],
      }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_ALLOCATION_EXCEEDS_PAYABLE');
  });

  it('rejects a bill belonging to another supplier', async () => {
    const otherPurchase = await postedPurchase(adminA, ctxA, '5000', ctxA.supplierId2);
    const otherPayable = await payableFor(adminA, otherPurchase.id);

    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '5000', allocations: [{ payableId: otherPayable.id, amount: '5000' }] }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_PAYMENT_ALLOCATION');
  });

  it('rejects an unknown payable', async () => {
    const response = await createPayment(
      adminA,
      paymentBody(ctxA, {
        amount: '5000',
        allocations: [{ payableId: '00000000-0000-4000-8000-000000000000', amount: '5000' }],
      }),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SUPPLIER_PAYABLE_NOT_FOUND');
  });

  it('rejects an inactive supplier', async () => {
    await request(app)
      .patch(`/api/v1/suppliers/${ctxA.supplierId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await createPayment(
      adminA,
      paymentBody(ctxA, { supplierId: ctxA.supplierId2, amount: '1000' }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SUPPLIER_INACTIVE');

    await request(app)
      .patch(`/api/v1/suppliers/${ctxA.supplierId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('posting supplier payments', () => {
  let purchase;
  let payable;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await postedPurchase(adminA, ctxA, '100000');
    payable = await payableFor(adminA, purchase.id);
  });

  async function payAndPost(amount, allocations) {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount, allocations }));
    expect(created.status).toBe(201);
    return postPayment(adminA, created.body.data.payment.id);
  }

  it('posts and records who and when', async () => {
    const response = await payAndPost('30000', [{ payableId: payable.id, amount: '30000' }]);

    expect(response.status).toBe(200);
    expect(response.body.data.payment.status).toBe('POSTED');
    expect(response.body.data.payment.postedBy.id).toBe(companyA.admin.id);
    expect(response.body.data.payment.postedAt).toBeTruthy();
  });

  it('walks a bill from OPEN to PAID across three partial payments', async () => {
    await payAndPost('30000', [{ payableId: payable.id, amount: '30000' }]);
    let reread = await payableFor(adminA, purchase.id);
    expect(reread.outstandingAmount).toBe('70000.00');
    expect(reread.status).toBe('PARTIALLY_PAID');

    await payAndPost('50000', [{ payableId: payable.id, amount: '50000' }]);
    reread = await payableFor(adminA, purchase.id);
    expect(reread.outstandingAmount).toBe('20000.00');

    await payAndPost('20000', [{ payableId: payable.id, amount: '20000' }]);
    reread = await payableFor(adminA, purchase.id);
    expect(reread.outstandingAmount).toBe('0.00');
    expect(reread.paidAmount).toBe('100000.00');
    expect(reread.status).toBe('PAID');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('0.00');
    expect(outstanding.body.data.outstanding.totalPayments).toBe('100000.00');
  });

  it('splits one payment across several bills', async () => {
    const purchaseB = await postedPurchase(adminA, ctxA, '30000');
    const purchaseC = await postedPurchase(adminA, ctxA, '20000');
    const payableB = await payableFor(adminA, purchaseB.id);
    const payableC = await payableFor(adminA, purchaseC.id);

    // Owes 100000 + 30000 + 20000. Pay 60000 across the first two.
    const response = await payAndPost('60000', [
      { payableId: payable.id, amount: '50000' },
      { payableId: payableB.id, amount: '10000' },
    ]);

    expect(response.status).toBe(200);

    expect((await payableFor(adminA, purchase.id)).outstandingAmount).toBe('50000.00');
    expect((await payableFor(adminA, purchaseB.id)).outstandingAmount).toBe('20000.00');
    expect((await payableFor(adminA, purchaseC.id)).outstandingAmount).toBe('20000.00');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('90000.00');
  });

  it('writes one PAYMENT ledger entry as a debit for the full amount', async () => {
    await payAndPost('40000', [{ payableId: payable.id, amount: '40000' }]);

    const ledger = await ledgerFor(adminA, ctxA.supplierId);
    const entries = ledger.body.data.ledger.entries;

    expect(entries).toHaveLength(2);
    expect(entries[1].type).toBe('PAYMENT');
    expect(entries[1].debit).toBe('40000.00');
    expect(entries[1].credit).toBe('0.00');
    expect(entries[1].balance).toBe('60000.00');
    expect(ledger.body.data.ledger.closingBalance).toBe('60000.00');
  });

  it('rejects allocating more than the bill has left, under the lock', async () => {
    await payAndPost('90000', [{ payableId: payable.id, amount: '90000' }]);

    // A draft prepared while 100000 was outstanding, posted after only 10000 is.
    const stale = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '50000', allocations: [] }),
    );
    await prisma.supplierPaymentAllocation.create({
      data: { supplierPaymentId: stale.body.data.payment.id, supplierPayableId: payable.id, amount: '50000' },
    });

    const response = await postPayment(adminA, stale.body.data.payment.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING');

    // Nothing moved.
    expect((await payableFor(adminA, purchase.id)).outstandingAmount).toBe('10000.00');
    expect(await prisma.supplierLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(1);
  });

  it('rolls back completely when one allocation of several is invalid', async () => {
    const purchaseB = await postedPurchase(adminA, ctxA, '30000');
    const payableB = await payableFor(adminA, purchaseB.id);

    // Prepare a payment whose SECOND allocation will exceed its bill.
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '50000', allocations: [{ payableId: payable.id, amount: '30000' }] }),
    );
    await prisma.supplierPaymentAllocation.create({
      data: {
        supplierPaymentId: created.body.data.payment.id,
        supplierPayableId: payableB.id,
        amount: '40000',
      },
    });

    const response = await postPayment(adminA, created.body.data.payment.id);
    expect(response.status).toBe(422);

    // The valid first allocation did not apply either.
    expect((await payableFor(adminA, purchase.id)).outstandingAmount).toBe('100000.00');
    expect((await payableFor(adminA, purchaseB.id)).outstandingAmount).toBe('30000.00');
    expect(await prisma.supplierLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/supplier-payments/${created.body.data.payment.id}`)
      .set(auth(adminA));
    expect(reread.body.data.payment.status).toBe('DRAFT');
  });

  it('cannot post the same payment twice', async () => {
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '10000', allocations: [{ payableId: payable.id, amount: '10000' }] }),
    );
    const id = created.body.data.payment.id;

    await postPayment(adminA, id);
    const second = await postPayment(adminA, id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SUPPLIER_PAYMENT_ALREADY_POSTED');
    expect(await prisma.supplierLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(1);
    expect((await payableFor(adminA, purchase.id)).outstandingAmount).toBe('90000.00');
  });

  it('cannot edit or cancel a posted payment', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '1000' }));
    await postPayment(adminA, created.body.data.payment.id);

    const edited = await request(app)
      .patch(`/api/v1/supplier-payments/${created.body.data.payment.id}`)
      .set(auth(adminA))
      .send(paymentBody(ctxA, { amount: '2000' }));
    const cancelled = await request(app)
      .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/cancel`)
      .set(auth(adminA));

    expect(edited.status).toBe(409);
    expect(cancelled.status).toBe(409);
  });

  it('keeps decimal precision exactly', async () => {
    const precise = await postedPurchase(adminA, ctxA, '0.10');
    const precisePayable = await payableFor(adminA, precise.id);

    await payAndPost('0.10', [{ payableId: precisePayable.id, amount: '0.10' }]);

    const reread = await payableFor(adminA, precise.id);
    expect(reread.paidAmount).toBe('0.10');
    expect(reread.outstandingAmount).toBe('0.00');
    expect(reread.status).toBe('PAID');
  });
});

describe('supplier advances', () => {
  beforeEach(resetTransactions);

  it('accepts a payment with no allocations and holds it as an advance', async () => {
    const created = await createPayment(adminA, paymentBody(ctxA, { amount: '20000', allocations: [] }));
    const posted = await postPayment(adminA, created.body.data.payment.id);

    expect(posted.status).toBe(200);
    expect(posted.body.data.payment.allocatedAmount).toBe('0.00');
    expect(posted.body.data.payment.unallocatedAmount).toBe('20000.00');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    // Negative: we are in credit with this supplier.
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('-20000.00');
    expect(outstanding.body.data.outstanding.unallocatedCredit).toBe('20000.00');
  });

  it('keeps the partly-unallocated remainder as an advance', async () => {
    const purchase = await postedPurchase(adminA, ctxA, '30000');
    const payable = await payableFor(adminA, purchase.id);

    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '50000', allocations: [{ payableId: payable.id, amount: '30000' }] }),
    );
    const posted = await postPayment(adminA, created.body.data.payment.id);

    expect(posted.body.data.payment.allocatedAmount).toBe('30000.00');
    expect(posted.body.data.payment.unallocatedAmount).toBe('20000.00');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('-20000.00');
    expect(outstanding.body.data.outstanding.billOutstanding).toBe('0.00');
  });
});

describe('supplier ledger and outstanding', () => {
  beforeEach(resetTransactions);

  it('reproduces the worked example: 100000 - 40000 - 10000 - 20000 = 30000', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `LEDGER-${Math.random().toString(36).slice(2, 8)}`,
        invoiceDate: '2026-08-01',
        items: [{ productId: ctxA.productId, quantity: '10', unitCost: '10000' }],
      });
    const purchase = created.body.data.purchase;
    await request(app).post(`/api/v1/purchases/${purchase.id}/post`).set(auth(adminA));
    const payable = await payableFor(adminA, purchase.id);

    // Payment 40000
    const first = await createPayment(
      adminA,
      paymentBody(ctxA, {
        paymentDate: '2026-08-05',
        amount: '40000',
        allocations: [{ payableId: payable.id, amount: '40000' }],
      }),
    );
    await postPayment(adminA, first.body.data.payment.id);

    // Return of 1 unit = 10000
    const ret = await request(app)
      .post('/api/v1/purchase-returns')
      .set(auth(adminA))
      .send({
        purchaseId: purchase.id,
        returnDate: '2026-08-10',
        items: [{ purchaseItemId: purchase.items[0].id, quantity: '1' }],
      });
    await request(app)
      .post(`/api/v1/purchase-returns/${ret.body.data.purchaseReturn.id}/post`)
      .set(auth(adminA));

    // Payment 20000
    const second = await createPayment(
      adminA,
      paymentBody(ctxA, {
        paymentDate: '2026-08-15',
        amount: '20000',
        allocations: [{ payableId: payable.id, amount: '20000' }],
      }),
    );
    await postPayment(adminA, second.body.data.payment.id);

    const ledger = await ledgerFor(adminA, ctxA.supplierId);
    const entries = ledger.body.data.ledger.entries;

    expect(entries.map((e) => e.type)).toEqual([
      'PURCHASE',
      'PAYMENT',
      'PURCHASE_RETURN',
      'PAYMENT',
    ]);
    expect(entries.map((e) => e.balance)).toEqual([
      '100000.00',
      '60000.00',
      '50000.00',
      '30000.00',
    ]);
    expect(ledger.body.data.ledger.closingBalance).toBe('30000.00');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    expect(outstanding.body.data.outstanding).toMatchObject({
      totalPurchases: '100000.00',
      totalReturns: '10000.00',
      totalPayments: '60000.00',
      outstandingAmount: '30000.00',
      billOutstanding: '30000.00',
      unallocatedCredit: '0.00',
    });
  });

  it('collapses earlier entries into an opening balance when filtered by date', async () => {
    const purchase = await postedPurchase(adminA, ctxA, '50000');
    const payable = await payableFor(adminA, purchase.id);
    const payment = await createPayment(
      adminA,
      paymentBody(ctxA, {
        paymentDate: '2026-09-05',
        amount: '10000',
        allocations: [{ payableId: payable.id, amount: '10000' }],
      }),
    );
    await postPayment(adminA, payment.body.data.payment.id);

    const filtered = await request(app)
      .get(`/api/v1/suppliers/${ctxA.supplierId}/ledger?fromDate=2026-09-01`)
      .set(auth(adminA));

    // The purchase (28 Aug) is before the window, so it forms the opening balance.
    expect(filtered.body.data.ledger.openingBalance).toBe('50000.00');
    expect(filtered.body.data.ledger.entries).toHaveLength(1);
    expect(filtered.body.data.ledger.closingBalance).toBe('40000.00');
  });

  it('lists only bills that still owe money', async () => {
    const paid = await postedPurchase(adminA, ctxA, '1000');
    await postedPurchase(adminA, ctxA, '2000');
    const paidPayable = await payableFor(adminA, paid.id);

    const payment = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '1000', allocations: [{ payableId: paidPayable.id, amount: '1000' }] }),
    );
    await postPayment(adminA, payment.body.data.payment.id);

    const outstandingBills = await request(app)
      .get(`/api/v1/suppliers/${ctxA.supplierId}/payables`)
      .set(auth(adminA));

    expect(outstandingBills.body.data.payables).toHaveLength(1);
    expect(outstandingBills.body.data.payables[0].outstandingAmount).toBe('2000.00');
  });

  it('filters payables by status and outstanding', async () => {
    await postedPurchase(adminA, ctxA, '1000');

    const open = await request(app)
      .get('/api/v1/supplier-payables?status=OPEN')
      .set(auth(adminA));
    const outstandingOnly = await request(app)
      .get('/api/v1/supplier-payables?onlyOutstanding=true')
      .set(auth(adminA));
    const paidOnly = await request(app)
      .get('/api/v1/supplier-payables?status=PAID')
      .set(auth(adminA));

    expect(open.body.pagination.total).toBe(1);
    expect(outstandingOnly.body.pagination.total).toBe(1);
    expect(paidOnly.body.pagination.total).toBe(0);
  });

  it('filters payments by status, method and supplier', async () => {
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '500', paymentMethod: 'CASH' }),
    );
    await postPayment(adminA, created.body.data.payment.id);
    await createPayment(adminA, paymentBody(ctxA, { amount: '600', paymentMethod: 'UPI' }));

    const posted = await request(app)
      .get('/api/v1/supplier-payments?status=POSTED')
      .set(auth(adminA));
    const cash = await request(app)
      .get('/api/v1/supplier-payments?paymentMethod=CASH')
      .set(auth(adminA));
    const bySupplier = await request(app)
      .get(`/api/v1/supplier-payments?supplierId=${ctxA.supplierId}`)
      .set(auth(adminA));

    expect(posted.body.pagination.total).toBe(1);
    expect(cash.body.pagination.total).toBe(1);
    expect(bySupplier.body.pagination.total).toBe(2);
  });
});

describe('supplier payment concurrency', () => {
  beforeEach(resetTransactions);

  it('lets only one of five simultaneous posts of the same payment through', async () => {
    const purchase = await postedPurchase(adminA, ctxA, '10000');
    const payable = await payableFor(adminA, purchase.id);

    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '10000', allocations: [{ payableId: payable.id, amount: '10000' }] }),
    );
    const id = created.body.data.payment.id;

    const results = await Promise.all(Array.from({ length: 5 }, () => postPayment(adminA, id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);

    expect((await payableFor(adminA, purchase.id)).outstandingAmount).toBe('0.00');
    expect(await prisma.supplierLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(1);
  });

  it('lets only one of five different payments consume the same outstanding 10000', async () => {
    const purchase = await postedPurchase(adminA, ctxA, '10000');
    const payable = await payableFor(adminA, purchase.id);

    const drafts = await Promise.all(
      Array.from({ length: 5 }, () =>
        createPayment(
          adminA,
          paymentBody(ctxA, {
            amount: '10000',
            allocations: [{ payableId: payable.id, amount: '10000' }],
          }),
        ),
      ),
    );

    const results = await Promise.all(
      drafts.map((draft) => postPayment(adminA, draft.body.data.payment.id)),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(4);
    expect(
      results.filter((r) => r.status === 422).every((r) => r.body.code === 'PAYMENT_EXCEEDS_OUTSTANDING'),
    ).toBe(true);

    // Never negative, never double-counted.
    const reread = await payableFor(adminA, purchase.id);
    expect(reread.outstandingAmount).toBe('0.00');
    expect(reread.paidAmount).toBe('10000.00');

    const outstanding = await outstandingFor(adminA, ctxA.supplierId);
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('0.00');
  });

  it('gives concurrent drafts distinct payment numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createPayment(adminA, paymentBody(ctxA, { amount: '100' }))),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.payment.paymentNumber)).size).toBe(6);
  });
});

describe('supplier payment RBAC', () => {
  let payableId;
  let draftId;

  beforeEach(async () => {
    await resetTransactions();
    const purchase = await postedPurchase(adminA, ctxA, '10000');
    payableId = (await payableFor(adminA, purchase.id)).id;
    const created = await createPayment(
      adminA,
      paymentBody(ctxA, { amount: '1000', allocations: [{ payableId, amount: '1000' }] }),
    );
    draftId = created.body.data.payment.id;
  });

  it('lets STAFF read payables, payments and the ledger', async () => {
    const payables = await request(app).get('/api/v1/supplier-payables').set(auth(staffA));
    const payments = await request(app).get('/api/v1/supplier-payments').set(auth(staffA));
    const ledger = await ledgerFor(staffA, ctxA.supplierId);
    const outstanding = await outstandingFor(staffA, ctxA.supplierId);

    expect(payables.status).toBe(200);
    expect(payments.status).toBe(200);
    expect(ledger.status).toBe(200);
    expect(outstanding.status).toBe(200);
  });

  it('forbids STAFF from creating, editing, posting or cancelling a payment', async () => {
    const created = await createPayment(staffA, paymentBody(ctxA, { amount: '100' }));
    const edited = await request(app)
      .patch(`/api/v1/supplier-payments/${draftId}`)
      .set(auth(staffA))
      .send(paymentBody(ctxA, { amount: '200' }));
    const posted = await postPayment(staffA, draftId);
    const cancelled = await request(app)
      .post(`/api/v1/supplier-payments/${draftId}/cancel`)
      .set(auth(staffA));

    expect(created.status).toBe(403);
    expect(edited.status).toBe(403);
    expect(posted.status).toBe(403);
    expect(cancelled.status).toBe(403);
    expect(await prisma.supplierLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);
  });

  it('requires authentication', async () => {
    const payables = await request(app).get('/api/v1/supplier-payables');
    const payments = await request(app).get('/api/v1/supplier-payments');
    const ledger = await request(app).get(`/api/v1/suppliers/${ctxA.supplierId}/ledger`);

    expect(payables.status).toBe(401);
    expect(payments.status).toBe(401);
    expect(ledger.status).toBe(401);
  });
});

describe('supplier payable tenant isolation', () => {
  let purchaseA;
  let payableA;
  let paymentA;

  beforeEach(async () => {
    await resetTransactions();

    purchaseA = await postedPurchase(adminA, ctxA, '10000');
    payableA = await payableFor(adminA, purchaseA.id);
    paymentA = (
      await createPayment(
        adminA,
        paymentBody(ctxA, { amount: '1000', allocations: [{ payableId: payableA.id, amount: '1000' }] }),
      )
    ).body.data.payment;

    await postedPurchase(adminB, ctxB, '7777');
  });

  it('lists only the current company payables and payments', async () => {
    const payablesA = await request(app).get('/api/v1/supplier-payables').set(auth(adminA));
    const payablesB = await request(app).get('/api/v1/supplier-payables').set(auth(adminB));
    const paymentsB = await request(app).get('/api/v1/supplier-payments').set(auth(adminB));

    expect(payablesA.body.pagination.total).toBe(1);
    expect(payablesA.body.data[0].originalAmount).toBe('10000.00');
    expect(payablesB.body.data[0].originalAmount).toBe('7777.00');
    expect(paymentsB.body.pagination.total).toBe(0);
  });

  it('returns 404 for another company payable, payment and ledger', async () => {
    const payable = await request(app)
      .get(`/api/v1/supplier-payables/${payableA.id}`)
      .set(auth(adminB));
    const payment = await request(app)
      .get(`/api/v1/supplier-payments/${paymentA.id}`)
      .set(auth(adminB));
    const ledger = await ledgerFor(adminB, ctxA.supplierId);
    const outstanding = await outstandingFor(adminB, ctxA.supplierId);

    expect(payable.status).toBe(404);
    expect(payment.status).toBe(404);
    expect(ledger.status).toBe(404);
    expect(ledger.body.code).toBe('SUPPLIER_NOT_FOUND');
    expect(outstanding.status).toBe(404);
  });

  it('refuses to post or cancel another company payment', async () => {
    const posted = await postPayment(adminB, paymentA.id);
    const cancelled = await request(app)
      .post(`/api/v1/supplier-payments/${paymentA.id}/cancel`)
      .set(auth(adminB));

    expect(posted.status).toBe(404);
    expect(cancelled.status).toBe(404);

    const reread = await request(app)
      .get(`/api/v1/supplier-payments/${paymentA.id}`)
      .set(auth(adminA));
    expect(reread.body.data.payment.status).toBe('DRAFT');
  });

  it('refuses to allocate a payment against another company payable', async () => {
    const response = await createPayment(
      adminB,
      paymentBody(ctxB, {
        supplierId: ctxB.supplierId,
        amount: '1000',
        allocations: [{ payableId: payableA.id, amount: '1000' }],
      }),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SUPPLIER_PAYABLE_NOT_FOUND');
  });

  it('ignores a companyId sent in the body', async () => {
    const response = await createPayment(adminA, {
      ...paymentBody(ctxA, { amount: '500' }),
      companyId: companyB.company.id,
    });

    expect(response.status).toBe(201);
    const stored = await prisma.supplierPayment.findUnique({
      where: { id: response.body.data.payment.id },
    });
    expect(stored.companyId).toBe(companyA.company.id);
  });
});
