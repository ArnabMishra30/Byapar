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

/** Master data one company needs to buy things. */
async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `Tablets ${suffix}` });

  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `Strip ${suffix}`, shortCode: `ST${suffix}` });

  const tax18 = await request(app)
    .post('/api/v1/taxes')
    .set(auth(token))
    .send({ name: `GST 18 ${suffix}`, rate: '18' });

  const tax12 = await request(app)
    .post('/api/v1/taxes')
    .set(auth(token))
    .send({ name: `GST 12 ${suffix}`, rate: '12' });

  const makeProduct = async (name, sku) => {
    const response = await request(app)
      .post('/api/v1/products')
      .set(auth(token))
      .send({
        name,
        sku,
        categoryId: category.body.data.category.id,
        unitId: unit.body.data.unit.id,
        purchasePrice: '100',
      });
    return response.body.data.product.id;
  };

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `ABC Distributors ${suffix}` });

  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Main ${suffix}`, code: `MN${suffix}` });

  return {
    productId: await makeProduct(`Paracetamol ${suffix}`, `SKU-A-${suffix}`),
    productId2: await makeProduct(`Amoxicillin ${suffix}`, `SKU-B-${suffix}`),
    taxId: tax18.body.data.tax.id,
    taxId12: tax12.body.data.tax.id,
    supplierId: supplier.body.data.supplier.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

/** A valid draft body: 100 @ 10 with 5% discount and 18% tax. */
function draftBody(ctx, overrides = {}) {
  return {
    supplierId: ctx.supplierId,
    warehouseId: ctx.warehouseId,
    invoiceNumber: `SUP-INV-${Math.random().toString(36).slice(2, 10)}`,
    invoiceDate: '2026-08-28',
    dueDate: '2026-09-27',
    notes: 'Monthly stock purchase',
    items: [
      {
        productId: ctx.productId,
        taxId: ctx.taxId,
        quantity: '100',
        unitCost: '10.00',
        discountType: 'PERCENTAGE',
        discountValue: '5',
      },
    ],
    ...overrides,
  };
}

const createDraft = (token, body) =>
  request(app).post('/api/v1/purchases').set(auth(token)).send(body);

const postPurchase = (token, id) =>
  request(app).post(`/api/v1/purchases/${id}/post`).set(auth(token));

const readBalance = (token, productId, warehouseId) =>
  request(app).get(`/api/v1/inventory/${productId}/${warehouseId}`).set(auth(token));

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

/** Clears purchases and stock but keeps master data. */
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
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  // Counters too, so each block starts numbering from 1.
  await prisma.documentSequence.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
}

describe('purchase drafts', () => {
  beforeEach(resetTransactions);

  it('creates a draft with a generated purchase number', async () => {
    const response = await createDraft(adminA, draftBody(ctxA));

    expect(response.status).toBe(201);
    expect(response.body.data.purchase.status).toBe('DRAFT');
    expect(response.body.data.purchase.purchaseNumber).toMatch(/^PUR-2026-\d{6}$/);
    expect(response.body.data.purchase.createdBy.id).toBe(companyA.admin.id);
  });

  it('keeps the supplier invoice number separate from our purchase number', async () => {
    const body = draftBody(ctxA, { invoiceNumber: 'SUP-INV-1001' });
    const response = await createDraft(adminA, body);

    expect(response.body.data.purchase.invoiceNumber).toBe('SUP-INV-1001');
    expect(response.body.data.purchase.purchaseNumber).not.toBe('SUP-INV-1001');
  });

  it('issues sequential purchase numbers', async () => {
    const first = await createDraft(adminA, draftBody(ctxA));
    const second = await createDraft(adminA, draftBody(ctxA));

    const firstNumber = Number(first.body.data.purchase.purchaseNumber.split('-')[2]);
    const secondNumber = Number(second.body.data.purchase.purchaseNumber.split('-')[2]);

    expect(secondNumber).toBe(firstNumber + 1);
  });

  it('does NOT change inventory', async () => {
    await createDraft(adminA, draftBody(ctxA));

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.000');
    expect(await prisma.inventoryBalance.count()).toBe(0);
  });

  it('does NOT create any stock movement', async () => {
    await createDraft(adminA, draftBody(ctxA));

    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    expect(movements.body.pagination.total).toBe(0);
  });

  it('calculates the line and the totals, ignoring client-sent totals', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      // A lying client.
      subtotal: '999999',
      grandTotal: '1',
    });

    const purchase = response.body.data.purchase;
    const item = purchase.items[0];

    // 100 * 10 = 1000, less 5% = 950, + 18% = 1121
    expect(item.discountAmount).toBe('50.00');
    expect(item.taxableAmount).toBe('950.00');
    expect(item.taxAmount).toBe('171.00');
    expect(item.lineTotal).toBe('1121.00');

    expect(purchase.subtotal).toBe('1000.00');
    expect(purchase.discountTotal).toBe('50.00');
    expect(purchase.taxTotal).toBe('171.00');
    expect(purchase.grandTotal).toBe('1121.00');
  });

  it('stores product, unit and tax snapshots', async () => {
    const response = await createDraft(adminA, draftBody(ctxA));
    const item = response.body.data.purchase.items[0];

    expect(item.productName).toBe('Paracetamol A');
    expect(item.sku).toBe('SKU-A-A');
    expect(item.unitName).toBe('STA');
    expect(item.taxName).toBe('GST 18 A');
    expect(item.taxRate).toBe('18.00');
  });

  it('keeps the snapshot after the product is renamed', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId}`)
      .set(auth(adminA))
      .send({ name: 'Renamed Product' });

    const reread = await request(app)
      .get(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA));

    expect(reread.body.data.purchase.items[0].productName).toBe('Paracetamol A');

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId}`)
      .set(auth(adminA))
      .send({ name: 'Paracetamol A' });
  });

  it('uses the bill price, not the product master price', async () => {
    // Product master purchasePrice is 100; this bill says 92.
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '10', unitCost: '92' }],
    });

    expect(response.body.data.purchase.items[0].unitCost).toBe('92.0000');
    expect(response.body.data.purchase.grandTotal).toBe('920.00');
  });

  it('supports several items with different taxes and discounts', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, taxId: ctxA.taxId, quantity: '100', unitCost: '10', discountType: 'PERCENTAGE', discountValue: '5' },
        { productId: ctxA.productId2, taxId: ctxA.taxId12, quantity: '50', unitCost: '20', discountType: 'FIXED', discountValue: '100' },
      ],
    });

    expect(response.status).toBe(201);
    const purchase = response.body.data.purchase;

    expect(purchase.items).toHaveLength(2);
    expect(purchase.subtotal).toBe('2000.00');
    expect(purchase.discountTotal).toBe('150.00');
    // 171 + (900 * 12%) = 171 + 108
    expect(purchase.taxTotal).toBe('279.00');
    expect(purchase.grandTotal).toBe('2129.00');
  });

  it('allows a line with no tax', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '10', unitCost: '10' }],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.purchase.items[0].taxAmount).toBe('0.00');
    expect(response.body.data.purchase.items[0].taxRate).toBeNull();
  });

  it('reads a draft back', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const response = await request(app)
      .get(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.purchase.id).toBe(created.body.data.purchase.id);
    expect(response.body.data.purchase.items).toHaveLength(1);
  });

  it('updates a draft and recalculates the totals', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));

    const response = await request(app)
      .patch(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA))
      .send({
        ...draftBody(ctxA, { invoiceNumber: created.body.data.purchase.invoiceNumber }),
        items: [{ productId: ctxA.productId, taxId: ctxA.taxId, quantity: '200', unitCost: '10' }],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.purchase.items).toHaveLength(1);
    expect(response.body.data.purchase.subtotal).toBe('2000.00');
    expect(response.body.data.purchase.taxTotal).toBe('360.00');
    expect(response.body.data.purchase.grandTotal).toBe('2360.00');

    // The purchase number never changes.
    expect(response.body.data.purchase.purchaseNumber).toBe(created.body.data.purchase.purchaseNumber);
  });

  it('does not leave orphan items after an update', async () => {
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitCost: '1' },
        { productId: ctxA.productId2, quantity: '1', unitCost: '1' },
      ],
    });

    await request(app)
      .patch(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA))
      .send({
        ...draftBody(ctxA, { invoiceNumber: created.body.data.purchase.invoiceNumber }),
        items: [{ productId: ctxA.productId, quantity: '1', unitCost: '1' }],
      });

    const items = await prisma.purchaseItem.count({
      where: { purchaseId: created.body.data.purchase.id },
    });
    expect(items).toBe(1);
  });

  it('cancels a draft', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));

    const response = await request(app)
      .post(`/api/v1/purchases/${created.body.data.purchase.id}/cancel`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.purchase.status).toBe('CANCELLED');
    expect(response.body.data.purchase.cancelledBy.id).toBe(companyA.admin.id);
    expect(response.body.data.purchase.cancelledAt).toBeTruthy();
  });

  it('cannot post or edit a cancelled purchase', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const id = created.body.data.purchase.id;
    await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth(adminA));

    const posted = await postPurchase(adminA, id);
    const edited = await request(app)
      .patch(`/api/v1/purchases/${id}`)
      .set(auth(adminA))
      .send(draftBody(ctxA, { invoiceNumber: created.body.data.purchase.invoiceNumber }));

    expect(posted.status).toBe(409);
    expect(posted.body.code).toBe('PURCHASE_NOT_DRAFT');
    expect(edited.status).toBe(409);
  });
});

describe('purchase draft validation', () => {
  beforeEach(resetTransactions);

  it('rejects an empty item list', async () => {
    const response = await createDraft(adminA, { ...draftBody(ctxA), items: [] });
    expect(response.status).toBe(400);
  });

  it('rejects a zero or negative quantity', async () => {
    const zero = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '0', unitCost: '10' }],
    });
    const negative = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '-1', unitCost: '10' }],
    });

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects a negative unit cost', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '1', unitCost: '-5' }],
    });

    expect(response.status).toBe(400);
  });

  it('rejects a percentage discount above 100', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitCost: '10', discountType: 'PERCENTAGE', discountValue: '150' },
      ],
    });

    expect(response.status).toBe(400);
  });

  it('rejects a fixed discount larger than the line', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitCost: '10', discountType: 'FIXED', discountValue: '500' },
      ],
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_DISCOUNT');
  });

  it('rejects a discount type with no value', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '1', unitCost: '10', discountType: 'PERCENTAGE' }],
    });

    expect(response.status).toBe(400);
  });

  it('rejects the same product on two lines', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitCost: '10' },
        { productId: ctxA.productId, quantity: '2', unitCost: '11' },
      ],
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('more than once');
  });

  it('rejects a due date before the invoice date', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      invoiceDate: '2026-08-28',
      dueDate: '2026-08-01',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.dueDate');
  });

  it('rejects a malformed date', async () => {
    const response = await createDraft(adminA, { ...draftBody(ctxA), invoiceDate: '28/08/2026' });
    expect(response.status).toBe(400);
  });

  it('rejects a missing invoice number', async () => {
    const response = await createDraft(adminA, { ...draftBody(ctxA), invoiceNumber: '   ' });
    expect(response.status).toBe(400);
  });

  it('rejects the same invoice number twice for one supplier', async () => {
    const body = draftBody(ctxA, { invoiceNumber: 'DUP-001' });
    await createDraft(adminA, body);

    const response = await createDraft(adminA, draftBody(ctxA, { invoiceNumber: 'DUP-001' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_INVOICE_NUMBER');
  });

  it('allows the same invoice number for a different supplier', async () => {
    const second = await request(app)
      .post('/api/v1/suppliers')
      .set(auth(adminA))
      .send({ name: 'Second Supplier A' });

    await createDraft(adminA, draftBody(ctxA, { invoiceNumber: 'SHARED-001' }));

    const response = await createDraft(adminA, {
      ...draftBody(ctxA, { invoiceNumber: 'SHARED-001' }),
      supplierId: second.body.data.supplier.id,
    });

    expect(response.status).toBe(201);
  });

  it('rejects an unknown supplier, warehouse, product or tax', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    const supplier = await createDraft(adminA, { ...draftBody(ctxA), supplierId: missing });
    const warehouse = await createDraft(adminA, { ...draftBody(ctxA), warehouseId: missing });
    const product = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: missing, quantity: '1', unitCost: '1' }],
    });
    const tax = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, taxId: missing, quantity: '1', unitCost: '1' }],
    });

    expect(supplier.body.code).toBe('SUPPLIER_NOT_FOUND');
    expect(warehouse.body.code).toBe('WAREHOUSE_NOT_FOUND');
    expect(product.body.code).toBe('PRODUCT_NOT_FOUND');
    expect(tax.body.code).toBe('TAX_NOT_FOUND');
  });

  it('rejects inactive master data', async () => {
    await request(app)
      .patch(`/api/v1/suppliers/${ctxA.supplierId}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await createDraft(adminA, draftBody(ctxA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SUPPLIER_INACTIVE');

    await request(app)
      .patch(`/api/v1/suppliers/${ctxA.supplierId}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });

  it('rejects an inactive product', async () => {
    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId2, quantity: '1', unitCost: '1' }],
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PRODUCT_INACTIVE');

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('posting a purchase', () => {
  beforeEach(resetTransactions);

  it('posts a draft and records who and when', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const response = await postPurchase(adminA, created.body.data.purchase.id);

    expect(response.status).toBe(200);
    expect(response.body.data.purchase.status).toBe('POSTED');
    expect(response.body.data.purchase.postedBy.id).toBe(companyA.admin.id);
    expect(response.body.data.purchase.postedAt).toBeTruthy();
  });

  it('creates a STOCK_IN movement and updates the balance', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    await postPurchase(adminA, created.body.data.purchase.id);

    const movements = await request(app)
      .get(`/api/v1/inventory/movements?productId=${ctxA.productId}`)
      .set(auth(adminA));

    expect(movements.body.pagination.total).toBe(1);
    const movement = movements.body.data[0];
    expect(movement.type).toBe('STOCK_IN');
    expect(movement.quantity).toBe('100.000');
    expect(movement.unitCost).toBe('10.0000');
    expect(movement.referenceType).toBe('PURCHASE');
    expect(movement.referenceId).toBe(created.body.data.purchase.id);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
    expect(balance.body.data.balance.averageCost).toBe('10.0000');
  });

  it('uses the bill price for inventory costing, not the product master price', async () => {
    // Product master says 100. The bill says 92.
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '10', unitCost: '92' }],
    });
    await postPurchase(adminA, created.body.data.purchase.id);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.averageCost).toBe('92.0000');
  });

  it('recalculates the moving weighted average through the inventory service', async () => {
    // Existing stock: 100 @ 10.
    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set(auth(adminA))
      .send({
        productId: ctxA.productId,
        warehouseId: ctxA.warehouseId,
        quantity: '100',
        unitCost: '10.00',
      });

    // Purchase: 50 @ 14.
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '50', unitCost: '14.00' }],
    });
    await postPurchase(adminA, created.body.data.purchase.id);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    // (100*10 + 50*14) / 150 = 11.3333 - the same result the inventory module
    // produces for an adjustment, because it is the same code.
    expect(balance.body.data.balance.quantity).toBe('150.000');
    expect(balance.body.data.balance.averageCost).toBe('11.3333');

    const movements = await request(app)
      .get(`/api/v1/inventory/movements?productId=${ctxA.productId}&type=STOCK_IN`)
      .set(auth(adminA));

    const movement = movements.body.data[0];
    expect(movement.quantityBefore).toBe('100.000');
    expect(movement.quantityAfter).toBe('150.000');
    expect(movement.averageCostBefore).toBe('10.0000');
    expect(movement.averageCostAfter).toBe('11.3333');
  });

  it('applies each item to its own product independently', async () => {
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '100', unitCost: '10' },
        { productId: ctxA.productId2, quantity: '50', unitCost: '20' },
      ],
    });
    await postPurchase(adminA, created.body.data.purchase.id);

    const first = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const second = await readBalance(adminA, ctxA.productId2, ctxA.warehouseId);

    expect(first.body.data.balance.quantity).toBe('100.000');
    expect(first.body.data.balance.averageCost).toBe('10.0000');
    expect(second.body.data.balance.quantity).toBe('50.000');
    expect(second.body.data.balance.averageCost).toBe('20.0000');

    expect(await prisma.stockMovement.count()).toBe(2);
  });

  it('keeps the totals unchanged by posting', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const posted = await postPurchase(adminA, created.body.data.purchase.id);

    expect(posted.body.data.purchase.grandTotal).toBe(created.body.data.purchase.grandTotal);
    expect(posted.body.data.purchase.items[0].lineTotal).toBe('1121.00');
  });

  it('cannot post the same purchase twice', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const id = created.body.data.purchase.id;

    await postPurchase(adminA, id);
    const second = await postPurchase(adminA, id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PURCHASE_ALREADY_POSTED');
    expect(await prisma.stockMovement.count()).toBe(1);
  });

  it('cannot edit a posted purchase', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    await postPurchase(adminA, created.body.data.purchase.id);

    const response = await request(app)
      .patch(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA))
      .send(draftBody(ctxA, { invoiceNumber: created.body.data.purchase.invoiceNumber }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PURCHASE_ALREADY_POSTED');
  });

  it('cannot cancel a posted purchase in this phase', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    await postPurchase(adminA, created.body.data.purchase.id);

    const response = await request(app)
      .post(`/api/v1/purchases/${created.body.data.purchase.id}/cancel`)
      .set(auth(adminA));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PURCHASE_ALREADY_POSTED');

    // Stock is untouched by the rejected cancellation.
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
  });

  it('refuses to post when a product was deactivated after the draft was created', async () => {
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId2, quantity: '5', unitCost: '10' }],
    });

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await postPurchase(adminA, created.body.data.purchase.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PRODUCT_INACTIVE');

    const reread = await request(app)
      .get(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA));
    expect(reread.body.data.purchase.status).toBe('DRAFT');

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });

  it('returns 404 for an unknown purchase', async () => {
    const response = await postPurchase(adminA, '00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_NOT_FOUND');
  });
});

describe('posting rolls back completely on failure', () => {
  beforeEach(resetTransactions);

  it('leaves no partial inventory when the second item fails', async () => {
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '100', unitCost: '10' },
        { productId: ctxA.productId2, quantity: '50', unitCost: '20' },
      ],
    });

    // Break only the SECOND item, after the draft exists.
    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await postPurchase(adminA, created.body.data.purchase.id);
    expect(response.status).toBe(422);

    // Nothing at all happened: not even the first item, which was valid.
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.inventoryBalance.count()).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(adminA));
    expect(reread.body.data.purchase.status).toBe('DRAFT');
    expect(reread.body.data.purchase.postedAt).toBeNull();

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });

  it('rolls back the first item too when the warehouse is deactivated', async () => {
    const created = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '10', unitCost: '10' }],
    });

    await request(app)
      .patch(`/api/v1/warehouses/${ctxA.warehouseId}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await postPurchase(adminA, created.body.data.purchase.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('WAREHOUSE_INACTIVE');
    expect(await prisma.stockMovement.count()).toBe(0);

    await request(app)
      .patch(`/api/v1/warehouses/${ctxA.warehouseId}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('concurrent posting', () => {
  beforeEach(resetTransactions);

  it('posts exactly once when five requests arrive together', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const id = created.body.data.purchase.id;

    const results = await Promise.all(Array.from({ length: 5 }, () => postPurchase(adminA, id)));

    const succeeded = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(rejected.every((r) => ['PURCHASE_ALREADY_POSTED', 'PURCHASE_NOT_DRAFT'].includes(r.body.code))).toBe(true);

    // Exactly one set of stock movements, and stock counted once.
    expect(await prisma.stockMovement.count()).toBe(1);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');

    const reread = await request(app).get(`/api/v1/purchases/${id}`).set(auth(adminA));
    expect(reread.body.data.purchase.status).toBe('POSTED');
  });

  it('gives concurrent drafts distinct purchase numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createDraft(adminA, draftBody(ctxA))),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);

    const numbers = results.map((r) => r.body.data.purchase.purchaseNumber);
    expect(new Set(numbers).size).toBe(6);
  });
});

describe('purchase listing', () => {
  beforeEach(async () => {
    await resetTransactions();
    await createDraft(adminA, draftBody(ctxA, { invoiceNumber: 'LIST-001' }));
    const second = await createDraft(adminA, draftBody(ctxA, { invoiceNumber: 'LIST-002' }));
    await postPurchase(adminA, second.body.data.purchase.id);
  });

  it('lists purchases with pagination', async () => {
    const response = await request(app).get('/api/v1/purchases?page=1&limit=10').set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(2);
    expect(response.body.pagination.page).toBe(1);
  });

  it('does not include item lines in the list', async () => {
    const response = await request(app).get('/api/v1/purchases').set(auth(adminA));
    expect(response.body.data[0].items).toBeUndefined();
  });

  it('filters by status', async () => {
    const drafts = await request(app).get('/api/v1/purchases?status=DRAFT').set(auth(adminA));
    const posted = await request(app).get('/api/v1/purchases?status=POSTED').set(auth(adminA));

    expect(drafts.body.pagination.total).toBe(1);
    expect(posted.body.pagination.total).toBe(1);
    expect(posted.body.data[0].invoiceNumber).toBe('LIST-002');
  });

  it('searches by invoice number and supplier name', async () => {
    const byInvoice = await request(app).get('/api/v1/purchases?search=LIST-001').set(auth(adminA));
    const bySupplier = await request(app).get('/api/v1/purchases?search=ABC').set(auth(adminA));

    expect(byInvoice.body.pagination.total).toBe(1);
    expect(bySupplier.body.pagination.total).toBe(2);
  });

  it('filters by supplier, warehouse and date range', async () => {
    const bySupplier = await request(app)
      .get(`/api/v1/purchases?supplierId=${ctxA.supplierId}`)
      .set(auth(adminA));
    const byWarehouse = await request(app)
      .get(`/api/v1/purchases?warehouseId=${ctxA.warehouseId}`)
      .set(auth(adminA));
    const future = await request(app)
      .get('/api/v1/purchases?fromDate=2027-01-01')
      .set(auth(adminA));

    expect(bySupplier.body.pagination.total).toBe(2);
    expect(byWarehouse.body.pagination.total).toBe(2);
    expect(future.body.pagination.total).toBe(0);
  });

  it('returns business dates as plain dates, not timestamps', async () => {
    const response = await request(app).get('/api/v1/purchases').set(auth(adminA));

    expect(response.body.data[0].invoiceDate).toBe('2026-08-28');
    expect(response.body.data[0].dueDate).toBe('2026-09-27');
  });
});

describe('purchase RBAC', () => {
  beforeEach(resetTransactions);

  it('lets STAFF read purchases', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));

    const list = await request(app).get('/api/v1/purchases').set(auth(staffA));
    const one = await request(app)
      .get(`/api/v1/purchases/${created.body.data.purchase.id}`)
      .set(auth(staffA));

    expect(list.status).toBe(200);
    expect(one.status).toBe(200);
  });

  it('forbids STAFF from creating, editing, posting or cancelling', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const id = created.body.data.purchase.id;

    const create = await createDraft(staffA, draftBody(ctxA));
    const edit = await request(app).patch(`/api/v1/purchases/${id}`).set(auth(staffA)).send(draftBody(ctxA));
    const post = await postPurchase(staffA, id);
    const cancel = await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth(staffA));

    expect(create.status).toBe(403);
    expect(edit.status).toBe(403);
    expect(post.status).toBe(403);
    expect(cancel.status).toBe(403);

    // And nothing happened.
    expect(await prisma.stockMovement.count()).toBe(0);
    const reread = await request(app).get(`/api/v1/purchases/${id}`).set(auth(adminA));
    expect(reread.body.data.purchase.status).toBe('DRAFT');
  });

  it('requires authentication', async () => {
    const list = await request(app).get('/api/v1/purchases');
    const create = await request(app).post('/api/v1/purchases').send({});

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
  });
});

describe('purchase tenant isolation', () => {
  let purchaseA;
  let purchaseB;

  beforeEach(async () => {
    await resetTransactions();
    purchaseA = (await createDraft(adminA, draftBody(ctxA))).body.data.purchase;
    purchaseB = (await createDraft(adminB, draftBody(ctxB))).body.data.purchase;
  });

  it('lists only the current company purchases', async () => {
    const listA = await request(app).get('/api/v1/purchases').set(auth(adminA));

    expect(listA.body.pagination.total).toBe(1);
    expect(listA.body.data[0].id).toBe(purchaseA.id);
  });

  it('returns 404 when reading another company purchase', async () => {
    const response = await request(app).get(`/api/v1/purchases/${purchaseB.id}`).set(auth(adminA));

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PURCHASE_NOT_FOUND');
  });

  it('returns 404 when editing another company purchase, and changes nothing', async () => {
    const response = await request(app)
      .patch(`/api/v1/purchases/${purchaseB.id}`)
      .set(auth(adminA))
      .send(draftBody(ctxA));

    expect(response.status).toBe(404);

    const reread = await request(app).get(`/api/v1/purchases/${purchaseB.id}`).set(auth(adminB));
    expect(reread.body.data.purchase.grandTotal).toBe(purchaseB.grandTotal);
  });

  it('returns 404 when posting another company purchase, and creates no stock', async () => {
    const response = await postPurchase(adminA, purchaseB.id);

    expect(response.status).toBe(404);
    expect(await prisma.stockMovement.count()).toBe(0);

    const reread = await request(app).get(`/api/v1/purchases/${purchaseB.id}`).set(auth(adminB));
    expect(reread.body.data.purchase.status).toBe('DRAFT');
  });

  it('returns 404 when cancelling another company purchase', async () => {
    const response = await request(app)
      .post(`/api/v1/purchases/${purchaseB.id}/cancel`)
      .set(auth(adminA));

    expect(response.status).toBe(404);
  });

  it('refuses another company supplier, warehouse, product or tax', async () => {
    const supplier = await createDraft(adminA, { ...draftBody(ctxA), supplierId: ctxB.supplierId });
    const warehouse = await createDraft(adminA, { ...draftBody(ctxA), warehouseId: ctxB.warehouseId });
    const product = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxB.productId, quantity: '1', unitCost: '1' }],
    });
    const tax = await createDraft(adminA, {
      ...draftBody(ctxA),
      items: [{ productId: ctxA.productId, taxId: ctxB.taxId, quantity: '1', unitCost: '1' }],
    });

    expect(supplier.body.code).toBe('SUPPLIER_NOT_FOUND');
    expect(warehouse.body.code).toBe('WAREHOUSE_NOT_FOUND');
    expect(product.body.code).toBe('PRODUCT_NOT_FOUND');
    expect(tax.body.code).toBe('TAX_NOT_FOUND');
  });

  it('ignores a companyId sent in the body', async () => {
    const response = await createDraft(adminA, {
      ...draftBody(ctxA),
      companyId: companyB.company.id,
    });

    expect(response.status).toBe(201);

    const stored = await prisma.purchase.findUnique({
      where: { id: response.body.data.purchase.id },
    });
    expect(stored.companyId).toBe(companyA.company.id);
  });

  it('keeps purchase numbering separate per company', async () => {
    // Each company has its own counter, so both start at 000001 and the
    // identical number is not a collision - they are different documents.
    expect(purchaseA.purchaseNumber).toBe('PUR-2026-000001');
    expect(purchaseB.purchaseNumber).toBe('PUR-2026-000001');
    expect(purchaseA.id).not.toBe(purchaseB.id);
  });

  it('posts into the correct company inventory only', async () => {
    await postPurchase(adminA, purchaseA.id);

    const balanceA = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const listB = await request(app).get('/api/v1/inventory').set(auth(adminB));

    expect(balanceA.body.data.balance.quantity).toBe('100.000');
    expect(listB.body.pagination.total).toBe(0);
  });
});

describe('supplier payable foundation', () => {
  beforeEach(resetTransactions);

  it('keeps what a future payable phase needs on the posted purchase', async () => {
    const created = await createDraft(adminA, draftBody(ctxA));
    const posted = await postPurchase(adminA, created.body.data.purchase.id);
    const purchase = posted.body.data.purchase;

    expect(purchase.supplier.id).toBe(ctxA.supplierId);
    expect(purchase.grandTotal).toBe('1121.00');
    expect(purchase.invoiceDate).toBe('2026-08-28');
    expect(purchase.dueDate).toBe('2026-09-27');
    expect(purchase.status).toBe('POSTED');
  });

  it('does not touch Supplier.openingBalance', async () => {
    const before = await prisma.supplier.findUnique({ where: { id: ctxA.supplierId } });

    const created = await createDraft(adminA, draftBody(ctxA));
    await postPurchase(adminA, created.body.data.purchase.id);

    const after = await prisma.supplier.findUnique({ where: { id: ctxA.supplierId } });
    // Opening balance is master data, not a running ledger.
    expect(after.openingBalance.toString()).toBe(before.openingBalance.toString());
  });

  it('counts only posted purchases towards what the supplier is owed', async () => {
    const draft = await createDraft(adminA, draftBody(ctxA));
    const toPost = await createDraft(adminA, draftBody(ctxA));
    await postPurchase(adminA, toPost.body.data.purchase.id);

    const totals = await prisma.purchase.aggregate({
      where: { companyId: companyA.company.id, supplierId: ctxA.supplierId, status: 'POSTED' },
      _sum: { grandTotal: true },
    });

    expect(totals._sum.grandTotal.toString()).toBe('1121');
    expect(draft.body.data.purchase.status).toBe('DRAFT');
  });
});
