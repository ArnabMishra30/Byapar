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
    .send({ name: `RCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `RUnit ${suffix}`, shortCode: `RU${suffix}` });

  const makeProduct = async (n) => {
    const response = await request(app)
      .post('/api/v1/products')
      .set(auth(token))
      .send({
        name: `RProd${n} ${suffix}`,
        sku: `RSKU${n}-${suffix}`,
        categoryId: category.body.data.category.id,
        unitId: unit.body.data.unit.id,
        purchasePrice: '999',
      });
    return response.body.data.product.id;
  };

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `RSupplier ${suffix}` });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `RMain ${suffix}`, code: `RM${suffix}` });
  const warehouse2 = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `RBranch ${suffix}`, code: `RB${suffix}` });

  return {
    productId: await makeProduct('A'),
    productId2: await makeProduct('B'),
    supplierId: supplier.body.data.supplier.id,
    warehouseId: warehouse.body.data.warehouse.id,
    warehouseId2: warehouse2.body.data.warehouse.id,
  };
}

/** Creates and posts a purchase, returning the posted document. */
async function postedPurchase(token, ctx, items) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `PI-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-28',
      items,
    });

  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));

  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

/** The default fixture: 100 units at 80.00, posted. */
async function standardPurchase(token = adminA, ctx = ctxA) {
  return postedPurchase(token, ctx, [
    { productId: ctx.productId, quantity: '100', unitCost: '80.00' },
  ]);
}

const createReturn = (token, body) =>
  request(app).post('/api/v1/purchase-returns').set(auth(token)).send(body);

const postReturn = (token, id) =>
  request(app).post(`/api/v1/purchase-returns/${id}/post`).set(auth(token));

const readBalance = (token, productId, warehouseId) =>
  request(app).get(`/api/v1/inventory/${productId}/${warehouseId}`).set(auth(token));

function returnBody(purchase, lines, overrides = {}) {
  return {
    purchaseId: purchase.id,
    returnDate: '2026-08-30',
    reason: 'Damaged in transit',
    items: lines,
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
  // Supplier sub-ledger first: it references purchases and payables.
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

describe('purchase return drafts', () => {
  let purchase;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await standardPurchase();
  });

  it('creates a draft with a generated return number', async () => {
    const response = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.purchaseReturn.status).toBe('DRAFT');
    expect(response.body.data.purchaseReturn.returnNumber).toMatch(/^PR-2026-\d{6}$/);
    expect(response.body.data.purchaseReturn.createdBy.id).toBe(companyA.admin.id);
  });

  it('derives the cost from the original purchase line, not the product master', async () => {
    // The product master says 999; the purchase said 80.
    const response = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );

    const item = response.body.data.purchaseReturn.items[0];
    expect(item.unitCost).toBe('80.0000');
    expect(item.lineTotal).toBe('1600.00');
    expect(response.body.data.purchaseReturn.grandTotal).toBe('1600.00');
  });

  it('ignores a client-supplied unitCost, lineTotal, grandTotal and warehouseId', async () => {
    const response = await createReturn(adminA, {
      ...returnBody(purchase, [
        { purchaseItemId: purchase.items[0].id, quantity: '20', unitCost: '5', lineTotal: '1' },
      ]),
      grandTotal: '1',
      warehouseId: ctxA.warehouseId2,
      companyId: companyB.company.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.purchaseReturn.items[0].unitCost).toBe('80.0000');
    expect(response.body.data.purchaseReturn.grandTotal).toBe('1600.00');
    // The warehouse came from the purchase, not from the request.
    expect(response.body.data.purchaseReturn.warehouse.id).toBe(ctxA.warehouseId);

    const stored = await prisma.purchaseReturn.findUnique({
      where: { id: response.body.data.purchaseReturn.id },
    });
    expect(stored.companyId).toBe(companyA.company.id);
    expect(stored.warehouseId).toBe(ctxA.warehouseId);
  });

  it('does not change stock when only a draft exists', async () => {
    await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(0);
  });

  it('reads a return back with its lines', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );

    const response = await request(app)
      .get(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.purchaseReturn.items).toHaveLength(1);
    expect(response.body.data.purchaseReturn.purchase.purchaseNumber).toBe(purchase.purchaseNumber);
  });

  it('lists returns with pagination and filters', async () => {
    await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '5' }]),
    );

    const list = await request(app)
      .get('/api/v1/purchase-returns?page=1&limit=10')
      .set(auth(adminA));
    const byStatus = await request(app)
      .get('/api/v1/purchase-returns?status=DRAFT')
      .set(auth(adminA));
    const byPurchase = await request(app)
      .get(`/api/v1/purchase-returns?purchaseId=${purchase.id}`)
      .set(auth(adminA));

    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].items).toBeUndefined();
    expect(byStatus.body.pagination.total).toBe(1);
    expect(byPurchase.body.pagination.total).toBe(1);
  });

  it('updates a draft and recalculates the total', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );

    const response = await request(app)
      .patch(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}`)
      .set(auth(adminA))
      .send(returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '30' }]));

    expect(response.status).toBe(200);
    expect(response.body.data.purchaseReturn.items[0].quantity).toBe('30.000');
    expect(response.body.data.purchaseReturn.grandTotal).toBe('2400.00');
    expect(response.body.data.purchaseReturn.returnNumber).toBe(
      created.body.data.purchaseReturn.returnNumber,
    );
  });

  it('refuses to move a return to a different purchase', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const other = await standardPurchase();

    const response = await request(app)
      .patch(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}`)
      .set(auth(adminA))
      .send(returnBody(other, [{ purchaseItemId: other.items[0].id, quantity: '5' }]));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PURCHASE_RETURN_PURCHASE_IMMUTABLE');
  });

  it('cancels a draft, after which it cannot be posted', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const id = created.body.data.purchaseReturn.id;

    const cancelled = await request(app)
      .post(`/api/v1/purchase-returns/${id}/cancel`)
      .set(auth(adminA));

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.purchaseReturn.status).toBe('CANCELLED');

    const posted = await postReturn(adminA, id);
    expect(posted.status).toBe(409);
    expect(posted.body.code).toBe('PURCHASE_RETURN_NOT_POSTABLE');
  });

  it('reports what is still returnable on a purchase', async () => {
    const response = await request(app)
      .get(`/api/v1/purchase-returns/returnable/${purchase.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const line = response.body.data.returnable.lines[0];
    expect(line.purchasedQuantity).toBe('100.000');
    expect(line.returnedQuantity).toBe('0.000');
    expect(line.remainingQuantity).toBe('100.000');
    expect(line.unitCost).toBe('80.0000');
  });
});

describe('purchase return validation', () => {
  let purchase;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await standardPurchase();
  });

  it('rejects an empty item list', async () => {
    const response = await createReturn(adminA, returnBody(purchase, []));
    expect(response.status).toBe(400);
  });

  it('rejects a zero or negative quantity', async () => {
    const zero = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '0' }]),
    );
    const negative = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '-5' }]),
    );

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects the same purchase line twice in one return', async () => {
    const response = await createReturn(
      adminA,
      returnBody(purchase, [
        { purchaseItemId: purchase.items[0].id, quantity: '5' },
        { purchaseItemId: purchase.items[0].id, quantity: '6' },
      ]),
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('more than once');
  });

  it('rejects a malformed date and a malformed id', async () => {
    const badDate = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '1' }], {
        returnDate: '30/08/2026',
      }),
    );
    const badId = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: 'not-a-uuid', quantity: '1' }]),
    );

    expect(badDate.status).toBe(400);
    expect(badId.status).toBe(400);
  });

  it('rejects an unknown purchase', async () => {
    const response = await createReturn(adminA, {
      purchaseId: '00000000-0000-4000-8000-000000000000',
      returnDate: '2026-08-30',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: '1' }],
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_NOT_FOUND');
  });

  it('rejects a purchase line that belongs to another purchase', async () => {
    const other = await standardPurchase();

    const response = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: other.items[0].id, quantity: '1' }]),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_ITEM_NOT_FOUND');
  });

  it('refuses to return against a DRAFT purchase', async () => {
    const draft = await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `PI-DRAFT-${Math.random().toString(36).slice(2, 8)}`,
        invoiceDate: '2026-08-28',
        items: [{ productId: ctxA.productId, quantity: '10', unitCost: '80' }],
      });

    const response = await createReturn(
      adminA,
      returnBody(draft.body.data.purchase, [
        { purchaseItemId: draft.body.data.purchase.items[0].id, quantity: '1' },
      ]),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PURCHASE_NOT_POSTED');
  });

  it('refuses to return against a CANCELLED purchase', async () => {
    const draft = await request(app)
      .post('/api/v1/purchases')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        warehouseId: ctxA.warehouseId,
        invoiceNumber: `PI-CANC-${Math.random().toString(36).slice(2, 8)}`,
        invoiceDate: '2026-08-28',
        items: [{ productId: ctxA.productId, quantity: '10', unitCost: '80' }],
      });
    await request(app)
      .post(`/api/v1/purchases/${draft.body.data.purchase.id}/cancel`)
      .set(auth(adminA));

    const response = await createReturn(
      adminA,
      returnBody(draft.body.data.purchase, [
        { purchaseItemId: draft.body.data.purchase.items[0].id, quantity: '1' },
      ]),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PURCHASE_NOT_POSTED');
  });

  it('rejects returning more than was purchased', async () => {
    const response = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '101' }]),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY');
  });
});

describe('posting a purchase return', () => {
  let purchase;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await standardPurchase();
  });

  it('posts and records who and when', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const response = await postReturn(adminA, created.body.data.purchaseReturn.id);

    expect(response.status).toBe(200);
    expect(response.body.data.purchaseReturn.status).toBe('POSTED');
    expect(response.body.data.purchaseReturn.postedBy.id).toBe(companyA.admin.id);
    expect(response.body.data.purchaseReturn.postedAt).toBeTruthy();
  });

  it('creates a STOCK_OUT movement at the original purchase cost', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const returnId = created.body.data.purchaseReturn.id;
    await postReturn(adminA, returnId);

    const movements = await request(app)
      .get(`/api/v1/inventory/movements?type=STOCK_OUT`)
      .set(auth(adminA));

    expect(movements.body.pagination.total).toBe(1);
    const movement = movements.body.data[0];
    expect(movement.quantity).toBe('20.000');
    expect(movement.unitCost).toBe('80.0000');
    expect(movement.totalCost).toBe('1600.00');
    expect(movement.referenceType).toBe('PURCHASE_RETURN');
    expect(movement.referenceId).toBe(returnId);
  });

  it('reduces the balance and leaves the average cost unchanged', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('80.000');
    // Stock leaving never changes the average cost of what remains.
    expect(balance.body.data.balance.averageCost).toBe('80.0000');
    expect(balance.body.data.balance.inventoryValue).toBe('6400.00');
  });

  it('returns at the ORIGINAL cost even when the average has since moved', async () => {
    // A second purchase at a higher price lifts the average to 100.
    await postedPurchase(adminA, ctxA, [
      { productId: ctxA.productId, quantity: '100', unitCost: '120.00' },
    ]);

    const beforeReturn = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(beforeReturn.body.data.balance.averageCost).toBe('100.0000');

    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '10' }]),
    );
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    const movements = await request(app)
      .get('/api/v1/inventory/movements?type=STOCK_OUT')
      .set(auth(adminA));

    // 80 - what this supplier charged - not the 100 average.
    expect(movements.body.data[0].unitCost).toBe('80.0000');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('190.000');
    expect(balance.body.data.balance.averageCost).toBe('100.0000');
  });

  it('never modifies the original purchase', async () => {
    const before = await request(app)
      .get(`/api/v1/purchases/${purchase.id}`)
      .set(auth(adminA));

    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    const after = await request(app).get(`/api/v1/purchases/${purchase.id}`).set(auth(adminA));

    expect(after.body.data.purchase.status).toBe('POSTED');
    expect(after.body.data.purchase.grandTotal).toBe(before.body.data.purchase.grandTotal);
    expect(after.body.data.purchase.items[0].quantity).toBe('100.000');
    expect(after.body.data.purchase.items[0].unitCost).toBe('80.0000');
  });

  it('cannot post the same return twice', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const id = created.body.data.purchaseReturn.id;

    await postReturn(adminA, id);
    const second = await postReturn(adminA, id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PURCHASE_RETURN_ALREADY_POSTED');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(1);
  });

  it('cannot edit a posted return', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    const response = await request(app)
      .patch(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}`)
      .set(auth(adminA))
      .send(returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '5' }]));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PURCHASE_RETURN_ALREADY_POSTED');
  });

  it('cannot cancel a posted return', async () => {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    const response = await request(app)
      .post(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}/cancel`)
      .set(auth(adminA));

    expect(response.status).toBe(409);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('80.000');
  });

  it('returns 404 for an unknown return', async () => {
    const response = await postReturn(adminA, '00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_RETURN_NOT_FOUND');
  });
});

describe('partial returns', () => {
  let purchase;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await standardPurchase();
  });

  async function returnQuantity(quantity) {
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity }]),
    );
    if (created.status !== 201) return created;
    return postReturn(adminA, created.body.data.purchaseReturn.id);
  }

  async function remaining() {
    const response = await request(app)
      .get(`/api/v1/purchase-returns/returnable/${purchase.id}`)
      .set(auth(adminA));
    return response.body.data.returnable.lines[0].remainingQuantity;
  }

  it('walks 100 down to 0 across several returns and then refuses more', async () => {
    expect(await remaining()).toBe('100.000');

    expect((await returnQuantity('20')).status).toBe(200);
    expect(await remaining()).toBe('80.000');

    expect((await returnQuantity('30')).status).toBe(200);
    expect(await remaining()).toBe('50.000');

    expect((await returnQuantity('50')).status).toBe(200);
    expect(await remaining()).toBe('0.000');

    const excess = await returnQuantity('1');
    expect(excess.status).toBe(422);
    expect(excess.body.code).toBe('PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.000');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(3);
  });

  it('counts only POSTED returns against the remaining quantity', async () => {
    // A draft for 100 reserves nothing.
    await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '100' }]),
    );

    expect(await remaining()).toBe('100.000');

    // So a different return can still be posted.
    expect((await returnQuantity('40')).status).toBe(200);
    expect(await remaining()).toBe('60.000');
  });

  it('blocks posting a stale draft that exceeds what is now returnable', async () => {
    const first = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '90' }]),
    );
    const second = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '90' }]),
    );

    expect((await postReturn(adminA, first.body.data.purchaseReturn.id)).status).toBe(200);

    const stale = await postReturn(adminA, second.body.data.purchaseReturn.id);
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('10.000');
  });

  it('handles fractional quantities without drift', async () => {
    const fractional = await postedPurchase(adminA, ctxA, [
      { productId: ctxA.productId2, quantity: '0.3', unitCost: '10.5' },
    ]);

    const created = await createReturn(
      adminA,
      returnBody(fractional, [{ purchaseItemId: fractional.items[0].id, quantity: '0.1' }]),
    );
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    expect(created.body.data.purchaseReturn.items[0].lineTotal).toBe('1.05');

    const balance = await readBalance(adminA, ctxA.productId2, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.200');
  });
});

describe('stock availability', () => {
  beforeEach(resetTransactions);

  it('refuses to return more than is currently in stock', async () => {
    const purchase = await standardPurchase();

    // Sell/remove 95 units through an adjustment, leaving 5.
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth(adminA))
      .send({
        productId: ctxA.productId,
        warehouseId: ctxA.warehouseId,
        type: 'ADJUSTMENT_OUT',
        quantity: '95',
      });

    // 50 is within the purchased quantity but exceeds what is physically there.
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '50' }]),
    );
    const response = await postReturn(adminA, created.body.data.purchaseReturn.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PURCHASE_RETURN_INSUFFICIENT_STOCK');

    // Nothing changed.
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('5.000');
    expect(await prisma.stockMovement.count({ where: { referenceType: 'PURCHASE_RETURN' } })).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}`)
      .set(auth(adminA));
    expect(reread.body.data.purchaseReturn.status).toBe('DRAFT');
  });

  it('rolls back every line when a later line has insufficient stock', async () => {
    const purchase = await postedPurchase(adminA, ctxA, [
      { productId: ctxA.productId, quantity: '10', unitCost: '80' },
      { productId: ctxA.productId2, quantity: '10', unitCost: '90' },
    ]);

    // Empty the SECOND product only.
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth(adminA))
      .send({
        productId: ctxA.productId2,
        warehouseId: ctxA.warehouseId,
        type: 'ADJUSTMENT_OUT',
        quantity: '10',
      });

    const created = await createReturn(
      adminA,
      returnBody(purchase, [
        { purchaseItemId: purchase.items[0].id, quantity: '5' },
        { purchaseItemId: purchase.items[1].id, quantity: '5' },
      ]),
    );
    const response = await postReturn(adminA, created.body.data.purchaseReturn.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PURCHASE_RETURN_INSUFFICIENT_STOCK');

    // The valid first line did not move either.
    const first = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(first.body.data.balance.quantity).toBe('10.000');
    expect(await prisma.stockMovement.count({ where: { referenceType: 'PURCHASE_RETURN' } })).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}`)
      .set(auth(adminA));
    expect(reread.body.data.purchaseReturn.status).toBe('DRAFT');
  });

  it('returns stock from the purchase warehouse, not another one', async () => {
    const purchase = await standardPurchase();

    // Stock also exists in the second warehouse; the return must not touch it.
    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set(auth(adminA))
      .send({
        productId: ctxA.productId,
        warehouseId: ctxA.warehouseId2,
        quantity: '500',
        unitCost: '80',
      });

    const created = await createReturn(adminA, {
      ...returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
      warehouseId: ctxA.warehouseId2,
    });
    await postReturn(adminA, created.body.data.purchaseReturn.id);

    const main = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const branch = await readBalance(adminA, ctxA.productId, ctxA.warehouseId2);

    expect(main.body.data.balance.quantity).toBe('80.000');
    expect(branch.body.data.balance.quantity).toBe('500.000');
  });
});

describe('purchase return concurrency', () => {
  beforeEach(resetTransactions);

  it('allows only one of two simultaneous posts of the same return', async () => {
    const purchase = await standardPurchase();
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const id = created.body.data.purchaseReturn.id;

    const results = await Promise.all(Array.from({ length: 5 }, () => postReturn(adminA, id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('80.000');
    expect(await prisma.stockMovement.count({ where: { referenceType: 'PURCHASE_RETURN' } })).toBe(1);
  });

  it('allows only one of two different returns competing for the last 20 units', async () => {
    const purchase = await standardPurchase();

    // Use up 80 of the 100 purchased.
    const first = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '80' }]),
    );
    await postReturn(adminA, first.body.data.purchaseReturn.id);

    // Two separate drafts, each asking for the remaining 20.
    const a = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );
    const b = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '20' }]),
    );

    const results = await Promise.all([
      postReturn(adminA, a.body.data.purchaseReturn.id),
      postReturn(adminA, b.body.data.purchaseReturn.id),
    ]);

    const succeeded = results.filter((r) => r.status === 200);
    const failed = results.filter((r) => r.status === 422);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].body.code).toBe('PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY');

    // Never over-returned, never negative.
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.000');

    const returned = await prisma.purchaseReturnItem.aggregate({
      where: { purchaseReturn: { purchaseId: purchase.id, status: 'POSTED' } },
      _sum: { quantity: true },
    });
    expect(Number(returned._sum.quantity)).toBe(100);
  });

  it('gives concurrent drafts distinct return numbers', async () => {
    const purchase = await standardPurchase();

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createReturn(
          adminA,
          returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '1' }]),
        ),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.data.purchaseReturn.returnNumber);
    expect(new Set(numbers).size).toBe(6);
  });
});

describe('purchase return RBAC', () => {
  let purchase;
  let draftId;

  beforeEach(async () => {
    await resetTransactions();
    purchase = await standardPurchase();
    const created = await createReturn(
      adminA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '10' }]),
    );
    draftId = created.body.data.purchaseReturn.id;
  });

  it('lets STAFF read and create drafts', async () => {
    const list = await request(app).get('/api/v1/purchase-returns').set(auth(staffA));
    const one = await request(app)
      .get(`/api/v1/purchase-returns/${draftId}`)
      .set(auth(staffA));
    const created = await createReturn(
      staffA,
      returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '5' }]),
    );

    expect(list.status).toBe(200);
    expect(one.status).toBe(200);
    expect(created.status).toBe(201);
  });

  it('lets STAFF edit a draft', async () => {
    const response = await request(app)
      .patch(`/api/v1/purchase-returns/${draftId}`)
      .set(auth(staffA))
      .send(returnBody(purchase, [{ purchaseItemId: purchase.items[0].id, quantity: '15' }]));

    expect(response.status).toBe(200);
  });

  it('forbids STAFF from posting or cancelling', async () => {
    const posted = await postReturn(staffA, draftId);
    const cancelled = await request(app)
      .post(`/api/v1/purchase-returns/${draftId}/cancel`)
      .set(auth(staffA));

    expect(posted.status).toBe(403);
    expect(cancelled.status).toBe(403);

    // And no stock moved.
    expect(await prisma.stockMovement.count({ where: { referenceType: 'PURCHASE_RETURN' } })).toBe(0);
  });

  it('requires authentication', async () => {
    const list = await request(app).get('/api/v1/purchase-returns');
    const create = await request(app).post('/api/v1/purchase-returns').send({});
    const post = await request(app).post(`/api/v1/purchase-returns/${draftId}/post`);

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    expect(post.status).toBe(401);
  });
});

describe('purchase return tenant isolation', () => {
  let purchaseA;
  let purchaseB;
  let returnA;

  beforeEach(async () => {
    await resetTransactions();

    purchaseA = await standardPurchase(adminA, ctxA);
    purchaseB = await postedPurchase(adminB, ctxB, [
      { productId: ctxB.productId, quantity: '100', unitCost: '80.00' },
    ]);

    returnA = (
      await createReturn(
        adminA,
        returnBody(purchaseA, [{ purchaseItemId: purchaseA.items[0].id, quantity: '10' }]),
      )
    ).body.data.purchaseReturn;
  });

  it('lists only the current company returns', async () => {
    const listA = await request(app).get('/api/v1/purchase-returns').set(auth(adminA));
    const listB = await request(app).get('/api/v1/purchase-returns').set(auth(adminB));

    expect(listA.body.pagination.total).toBe(1);
    expect(listB.body.pagination.total).toBe(0);
  });

  it('returns 404 when reading, editing, posting or cancelling another company return', async () => {
    const read = await request(app)
      .get(`/api/v1/purchase-returns/${returnA.id}`)
      .set(auth(adminB));
    const edit = await request(app)
      .patch(`/api/v1/purchase-returns/${returnA.id}`)
      .set(auth(adminB))
      .send(returnBody(purchaseB, [{ purchaseItemId: purchaseB.items[0].id, quantity: '1' }]));
    const post = await postReturn(adminB, returnA.id);
    const cancel = await request(app)
      .post(`/api/v1/purchase-returns/${returnA.id}/cancel`)
      .set(auth(adminB));

    expect(read.status).toBe(404);
    expect(edit.status).toBe(404);
    expect(post.status).toBe(404);
    expect(cancel.status).toBe(404);

    const reread = await request(app)
      .get(`/api/v1/purchase-returns/${returnA.id}`)
      .set(auth(adminA));
    expect(reread.body.data.purchaseReturn.status).toBe('DRAFT');
  });

  it('refuses to reference another company purchase', async () => {
    const response = await createReturn(
      adminB,
      returnBody(purchaseA, [{ purchaseItemId: purchaseA.items[0].id, quantity: '1' }]),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_NOT_FOUND');
  });

  it('refuses to reference another company purchase item', async () => {
    const response = await createReturn(
      adminB,
      returnBody(purchaseB, [{ purchaseItemId: purchaseA.items[0].id, quantity: '1' }]),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_ITEM_NOT_FOUND');
  });

  it('refuses to read another company returnable lines', async () => {
    const response = await request(app)
      .get(`/api/v1/purchase-returns/returnable/${purchaseA.id}`)
      .set(auth(adminB));

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_NOT_FOUND');
  });

  it('does not touch the other company stock when posting', async () => {
    await postReturn(adminA, returnA.id);

    const balanceA = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const balanceB = await readBalance(adminB, ctxB.productId, ctxB.warehouseId);

    expect(balanceA.body.data.balance.quantity).toBe('90.000');
    expect(balanceB.body.data.balance.quantity).toBe('100.000');
  });

  it('numbers returns per company', async () => {
    const forB = await createReturn(
      adminB,
      returnBody(purchaseB, [{ purchaseItemId: purchaseB.items[0].id, quantity: '1' }]),
    );

    expect(returnA.returnNumber).toBe('PR-2026-000001');
    expect(forB.body.data.purchaseReturn.returnNumber).toBe('PR-2026-000001');
    expect(returnA.id).not.toBe(forB.body.data.purchaseReturn.id);
  });
});
