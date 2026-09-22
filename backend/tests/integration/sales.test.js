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
    .send({ name: `SCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `SUnit ${suffix}`, shortCode: `SU${suffix}` });
  const tax = await request(app)
    .post('/api/v1/taxes')
    .set(auth(token))
    .send({ name: `SGST18 ${suffix}`, rate: '18' });

  const makeProduct = async (n) => {
    const response = await request(app)
      .post('/api/v1/products')
      .set(auth(token))
      .send({
        name: `SProd${n} ${suffix}`,
        sku: `SSKU${n}-${suffix}`,
        categoryId: category.body.data.category.id,
        unitId: unit.body.data.unit.id,
        sellingPrice: '120',
      });
    return response.body.data.product.id;
  };

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `SSup ${suffix}` });
  const customer = await request(app)
    .post('/api/v1/customers')
    .set(auth(token))
    .send({ name: `SCust ${suffix}` });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `SWH ${suffix}`, code: `SW${suffix}` });

  return {
    productId: await makeProduct('A'),
    productId2: await makeProduct('B'),
    taxId: tax.body.data.tax.id,
    supplierId: supplier.body.data.supplier.id,
    customerId: customer.body.data.customer.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

/** Buys stock so there is something to sell: quantity @ unitCost, posted. */
async function stockUp(token, ctx, productId, quantity, unitCost) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `SB-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-01',
      items: [{ productId, quantity, unitCost }],
    });

  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));

  expect(posted.status).toBe(200);
}

const createSale = (token, body) => request(app).post('/api/v1/sales').set(auth(token)).send(body);
const postSale = (token, id) => request(app).post(`/api/v1/sales/${id}/post`).set(auth(token));
const readBalance = (token, productId, warehouseId) =>
  request(app).get(`/api/v1/inventory/${productId}/${warehouseId}`).set(auth(token));

function saleBody(ctx, overrides = {}) {
  return {
    customerId: ctx.customerId,
    warehouseId: ctx.warehouseId,
    invoiceDate: '2026-09-01',
    dueDate: '2026-09-30',
    items: [{ productId: ctx.productId, taxId: ctx.taxId, quantity: '10', unitPrice: '120' }],
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
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
}

describe('sales invoice drafts', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
  });

  it('creates a draft with a generated invoice number', async () => {
    const response = await createSale(adminA, saleBody(ctxA));

    expect(response.status).toBe(201);
    expect(response.body.data.sale.status).toBe('DRAFT');
    expect(response.body.data.sale.invoiceNumber).toMatch(/^INV-2026-\d{6}$/);
    expect(response.body.data.sale.createdBy.id).toBe(companyA.admin.id);
  });

  it('calculates the line and totals, ignoring client-sent totals', async () => {
    const response = await createSale(adminA, {
      ...saleBody(ctxA),
      // A lying client.
      subtotal: '999999',
      grandTotal: '1',
      cogsTotal: '1',
      items: [
        {
          productId: ctxA.productId,
          taxId: ctxA.taxId,
          quantity: '10',
          unitPrice: '120',
          lineTotal: '5',
          taxAmount: '5',
        },
      ],
    });

    const sale = response.body.data.sale;
    // 10 * 120 = 1200, + 18% = 1416
    expect(sale.items[0].taxableAmount).toBe('1200.00');
    expect(sale.items[0].taxAmount).toBe('216.00');
    expect(sale.items[0].lineTotal).toBe('1416.00');
    expect(sale.subtotal).toBe('1200.00');
    expect(sale.taxTotal).toBe('216.00');
    expect(sale.grandTotal).toBe('1416.00');
  });

  it('applies a percentage discount before tax', async () => {
    const response = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [
        {
          productId: ctxA.productId,
          taxId: ctxA.taxId,
          quantity: '10',
          unitPrice: '120',
          discountType: 'PERCENTAGE',
          discountValue: '10',
        },
      ],
    });

    const sale = response.body.data.sale;
    expect(sale.discountTotal).toBe('120.00');
    expect(sale.items[0].taxableAmount).toBe('1080.00');
    expect(sale.taxTotal).toBe('194.40');
    expect(sale.grandTotal).toBe('1274.40');
  });

  it('stores product, unit and tax snapshots', async () => {
    const response = await createSale(adminA, saleBody(ctxA));
    const item = response.body.data.sale.items[0];

    expect(item.productName).toBe('SProdA A');
    expect(item.sku).toBe('SSKUA-A');
    expect(item.unitName).toBe('SUA');
    expect(item.taxName).toBe('SGST18 A');
    expect(item.taxRate).toBe('18.00');
  });

  it('does NOT change stock, create a receivable or write a ledger entry', async () => {
    await createSale(adminA, saleBody(ctxA));

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(0);
    expect(await prisma.customerReceivable.count()).toBe(0);
    expect(await prisma.customerLedgerEntry.count()).toBe(0);
  });

  it('reports zero COGS while it is a draft', async () => {
    const response = await createSale(adminA, saleBody(ctxA));

    expect(response.body.data.sale.cogsTotal).toBe('0.00');
    expect(response.body.data.sale.items[0].cogsAmount).toBe('0.00');
  });

  it('updates a draft and recalculates the totals', async () => {
    const created = await createSale(adminA, saleBody(ctxA));

    const response = await request(app)
      .patch(`/api/v1/sales/${created.body.data.sale.id}`)
      .set(auth(adminA))
      .send({
        ...saleBody(ctxA),
        items: [{ productId: ctxA.productId, taxId: ctxA.taxId, quantity: '20', unitPrice: '120' }],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.sale.grandTotal).toBe('2832.00');
    expect(response.body.data.sale.invoiceNumber).toBe(created.body.data.sale.invoiceNumber);
  });

  it('allows changing the customer and warehouse on a draft', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const otherCustomer = await request(app)
      .post('/api/v1/customers')
      .set(auth(adminA))
      .send({ name: `Another Customer ${Math.random().toString(36).slice(2, 8)}` });

    const response = await request(app)
      .patch(`/api/v1/sales/${created.body.data.sale.id}`)
      .set(auth(adminA))
      .send({ ...saleBody(ctxA), customerId: otherCustomer.body.data.customer.id });

    expect(response.status).toBe(200);
    expect(response.body.data.sale.customer.id).toBe(otherCustomer.body.data.customer.id);
  });

  it('cancels a draft, after which it cannot be posted', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const id = created.body.data.sale.id;

    const cancelled = await request(app).post(`/api/v1/sales/${id}/cancel`).set(auth(adminA));
    expect(cancelled.body.data.sale.status).toBe('CANCELLED');

    const posted = await postSale(adminA, id);
    expect(posted.status).toBe(409);
    expect(posted.body.code).toBe('SALE_NOT_DRAFT');
  });

  it('lists and filters invoices', async () => {
    await createSale(adminA, saleBody(ctxA));

    const list = await request(app).get('/api/v1/sales?page=1&limit=10').set(auth(adminA));
    const drafts = await request(app).get('/api/v1/sales?status=DRAFT').set(auth(adminA));
    const byCustomer = await request(app)
      .get(`/api/v1/sales?customerId=${ctxA.customerId}`)
      .set(auth(adminA));

    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].items).toBeUndefined();
    expect(drafts.body.pagination.total).toBe(1);
    expect(byCustomer.body.pagination.total).toBe(1);
  });
});

describe('sales invoice validation', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
  });

  it('rejects an empty item list', async () => {
    const response = await createSale(adminA, { ...saleBody(ctxA), items: [] });
    expect(response.status).toBe(400);
  });

  it('rejects a zero or negative quantity', async () => {
    const zero = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '0', unitPrice: '120' }],
    });
    const negative = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '-1', unitPrice: '120' }],
    });

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects a negative price', async () => {
    const response = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '1', unitPrice: '-5' }],
    });

    expect(response.status).toBe(400);
  });

  it('rejects an excessive discount', async () => {
    const percentage = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitPrice: '120', discountType: 'PERCENTAGE', discountValue: '150' },
      ],
    });
    const fixed = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitPrice: '120', discountType: 'FIXED', discountValue: '500' },
      ],
    });

    expect(percentage.status).toBe(400);
    expect(fixed.status).toBe(422);
    expect(fixed.body.code).toBe('INVALID_DISCOUNT');
  });

  it('rejects the same product on two lines', async () => {
    const response = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '1', unitPrice: '120' },
        { productId: ctxA.productId, quantity: '2', unitPrice: '130' },
      ],
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('more than once');
  });

  it('rejects a due date before the invoice date', async () => {
    const response = await createSale(adminA, {
      ...saleBody(ctxA),
      invoiceDate: '2026-09-01',
      dueDate: '2026-08-01',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.dueDate');
  });

  it('rejects unknown customer, warehouse, product or tax', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    const customer = await createSale(adminA, { ...saleBody(ctxA), customerId: missing });
    const warehouse = await createSale(adminA, { ...saleBody(ctxA), warehouseId: missing });
    const product = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: missing, quantity: '1', unitPrice: '1' }],
    });
    const tax = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId, taxId: missing, quantity: '1', unitPrice: '1' }],
    });

    expect(customer.body.code).toBe('CUSTOMER_NOT_FOUND');
    expect(warehouse.body.code).toBe('WAREHOUSE_NOT_FOUND');
    expect(product.body.code).toBe('PRODUCT_NOT_FOUND');
    expect(tax.body.code).toBe('TAX_NOT_FOUND');
  });

  it('rejects an inactive customer, product or warehouse', async () => {
    await request(app)
      .patch(`/api/v1/customers/${ctxA.customerId}/status`)
      .set(auth(adminA))
      .send({ isActive: false });
    const inactiveCustomer = await createSale(adminA, saleBody(ctxA));
    expect(inactiveCustomer.status).toBe(422);
    expect(inactiveCustomer.body.code).toBe('CUSTOMER_INACTIVE');
    await request(app)
      .patch(`/api/v1/customers/${ctxA.customerId}/status`)
      .set(auth(adminA))
      .send({ isActive: true });

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });
    const inactiveProduct = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId2, quantity: '1', unitPrice: '1' }],
    });
    expect(inactiveProduct.body.code).toBe('PRODUCT_INACTIVE');
    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });

    await request(app)
      .patch(`/api/v1/warehouses/${ctxA.warehouseId}/status`)
      .set(auth(adminA))
      .send({ isActive: false });
    const inactiveWarehouse = await createSale(adminA, saleBody(ctxA));
    expect(inactiveWarehouse.body.code).toBe('WAREHOUSE_INACTIVE');
    await request(app)
      .patch(`/api/v1/warehouses/${ctxA.warehouseId}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('posting a sales invoice', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
  });

  it('posts and records who and when', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.status).toBe(200);
    expect(response.body.data.sale.status).toBe('POSTED');
    expect(response.body.data.sale.postedBy.id).toBe(companyA.admin.id);
    expect(response.body.data.sale.postedAt).toBeTruthy();
  });

  it('reduces stock and creates a STOCK_OUT movement referencing the invoice', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const saleId = created.body.data.sale.id;
    await postSale(adminA, saleId);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('90.000');
    // Stock leaving never changes the average.
    expect(balance.body.data.balance.averageCost).toBe('80.0000');

    const movements = await request(app)
      .get('/api/v1/inventory/movements?type=STOCK_OUT')
      .set(auth(adminA));

    expect(movements.body.pagination.total).toBe(1);
    expect(movements.body.data[0].quantity).toBe('10.000');
    expect(movements.body.data[0].referenceType).toBe('SALES_INVOICE');
    expect(movements.body.data[0].referenceId).toBe(saleId);
  });

  it('freezes COGS at the moving average, not the selling price', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const response = await postSale(adminA, created.body.data.sale.id);

    const sale = response.body.data.sale;
    // Sold 10 @ 120 = 1200 revenue; cost 10 @ 80 = 800.
    expect(sale.items[0].cogsUnitCost).toBe('80.0000');
    expect(sale.items[0].cogsAmount).toBe('800.00');
    expect(sale.cogsTotal).toBe('800.00');
    expect(sale.grossMargin).toBe('400.00');
  });

  it('uses the blended average when stock was bought at two prices', async () => {
    // 100 @ 80 already; add 100 @ 120 -> average 100.
    await stockUp(adminA, ctxA, ctxA.productId, '100', '120');

    const created = await createSale(adminA, saleBody(ctxA));
    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.body.data.sale.items[0].cogsUnitCost).toBe('100.0000');
    expect(response.body.data.sale.cogsTotal).toBe('1000.00');
  });

  it('does NOT change historical COGS when the average moves later', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    await postSale(adminA, created.body.data.sale.id);

    // A later, dearer purchase lifts the average.
    await stockUp(adminA, ctxA, ctxA.productId, '100', '200');

    const reread = await request(app)
      .get(`/api/v1/sales/${created.body.data.sale.id}`)
      .set(auth(adminA));

    expect(reread.body.data.sale.items[0].cogsUnitCost).toBe('80.0000');
    expect(reread.body.data.sale.cogsTotal).toBe('800.00');
  });

  it('creates exactly one receivable and one SALE ledger entry', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    await postSale(adminA, created.body.data.sale.id);

    const receivables = await request(app).get('/api/v1/customer-receivables').set(auth(adminA));
    expect(receivables.body.pagination.total).toBe(1);
    const receivable = receivables.body.data[0];
    expect(receivable.originalAmount).toBe('1416.00');
    expect(receivable.outstandingAmount).toBe('1416.00');
    expect(receivable.status).toBe('OPEN');
    expect(receivable.dueDate).toBe('2026-09-30');

    const ledger = await request(app)
      .get(`/api/v1/customers/${ctxA.customerId}/ledger`)
      .set(auth(adminA));
    expect(ledger.body.data.ledger.entries).toHaveLength(1);
    expect(ledger.body.data.ledger.entries[0].type).toBe('SALE');
    expect(ledger.body.data.ledger.entries[0].debit).toBe('1416.00');
    expect(ledger.body.data.ledger.closingBalance).toBe('1416.00');
  });

  it('handles several products in one invoice', async () => {
    await stockUp(adminA, ctxA, ctxA.productId2, '50', '40');

    const created = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '10', unitPrice: '120' },
        { productId: ctxA.productId2, quantity: '5', unitPrice: '60' },
      ],
    });
    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.status).toBe(200);
    // COGS: 10*80 + 5*40 = 1000
    expect(response.body.data.sale.cogsTotal).toBe('1000.00');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(2);

    const first = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const second = await readBalance(adminA, ctxA.productId2, ctxA.warehouseId);
    expect(first.body.data.balance.quantity).toBe('90.000');
    expect(second.body.data.balance.quantity).toBe('45.000');
  });

  it('rejects selling more than is in stock, and changes nothing', async () => {
    const created = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId, quantity: '500', unitPrice: '120' }],
    });
    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SALE_INSUFFICIENT_STOCK');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(0);
    expect(await prisma.customerReceivable.count()).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/sales/${created.body.data.sale.id}`)
      .set(auth(adminA));
    expect(reread.body.data.sale.status).toBe('DRAFT');
  });

  it('cannot post the same invoice twice', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const id = created.body.data.sale.id;

    await postSale(adminA, id);
    const second = await postSale(adminA, id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SALE_ALREADY_POSTED');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(1);
    expect(await prisma.customerReceivable.count()).toBe(1);
    expect(await prisma.customerLedgerEntry.count()).toBe(1);
  });

  it('cannot edit or cancel a posted invoice', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    await postSale(adminA, created.body.data.sale.id);

    const edited = await request(app)
      .patch(`/api/v1/sales/${created.body.data.sale.id}`)
      .set(auth(adminA))
      .send(saleBody(ctxA));
    const cancelled = await request(app)
      .post(`/api/v1/sales/${created.body.data.sale.id}/cancel`)
      .set(auth(adminA));

    expect(edited.status).toBe(409);
    expect(edited.body.code).toBe('SALE_ALREADY_POSTED');
    expect(cancelled.status).toBe(409);
  });

  it('refuses to post when a product was deactivated after drafting', async () => {
    await stockUp(adminA, ctxA, ctxA.productId2, '10', '40');
    const created = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId2, quantity: '1', unitPrice: '60' }],
    });

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PRODUCT_INACTIVE');
    expect(await prisma.customerReceivable.count()).toBe(0);

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });

  it('rolls back every line when a later line fails', async () => {
    // Only product 2 is short of stock.
    await stockUp(adminA, ctxA, ctxA.productId2, '2', '40');

    const created = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [
        { productId: ctxA.productId, quantity: '10', unitPrice: '120' },
        { productId: ctxA.productId2, quantity: '50', unitPrice: '60' },
      ],
    });
    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SALE_INSUFFICIENT_STOCK');

    // The valid first line did not move either.
    const first = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(first.body.data.balance.quantity).toBe('100.000');
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(0);
    expect(await prisma.customerReceivable.count()).toBe(0);
    expect(await prisma.customerLedgerEntry.count()).toBe(0);

    const reread = await request(app)
      .get(`/api/v1/sales/${created.body.data.sale.id}`)
      .set(auth(adminA));
    expect(reread.body.data.sale.status).toBe('DRAFT');
    expect(reread.body.data.sale.cogsTotal).toBe('0.00');
  });

  it('keeps decimal precision exactly', async () => {
    await stockUp(adminA, ctxA, ctxA.productId2, '1', '0.1');

    const created = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId2, quantity: '0.3', unitPrice: '0.2' }],
    });
    const response = await postSale(adminA, created.body.data.sale.id);

    expect(response.body.data.sale.grandTotal).toBe('0.06');
    expect(response.body.data.sale.items[0].cogsUnitCost).toBe('0.1000');

    const balance = await readBalance(adminA, ctxA.productId2, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.700');
  });
});

describe('sales concurrency', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
  });

  it('posts exactly once when five requests arrive together', async () => {
    const created = await createSale(adminA, saleBody(ctxA));
    const id = created.body.data.sale.id;

    const results = await Promise.all(Array.from({ length: 5 }, () => postSale(adminA, id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);

    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(1);
    expect(await prisma.customerReceivable.count()).toBe(1);
    expect(await prisma.customerLedgerEntry.count()).toBe(1);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('90.000');
  });

  it('never oversells when several invoices compete for the last stock', async () => {
    // 100 in stock; five invoices of 30 each. At most three can succeed.
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () =>
        createSale(adminA, {
          ...saleBody(ctxA),
          items: [{ productId: ctxA.productId, quantity: '30', unitPrice: '120' }],
        }),
      ),
    );

    const results = await Promise.all(
      drafts.map((draft) => postSale(adminA, draft.body.data.sale.id)),
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status === 422).length;

    expect(succeeded).toBe(3);
    expect(rejected).toBe(2);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('10.000');
    expect(Number(balance.body.data.balance.quantity)).toBeGreaterThanOrEqual(0);
  });

  it('gives concurrent drafts distinct invoice numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createSale(adminA, saleBody(ctxA))),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.sale.invoiceNumber)).size).toBe(6);
  });
});

describe('sales RBAC', () => {
  let draftId;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    const created = await createSale(adminA, saleBody(ctxA));
    draftId = created.body.data.sale.id;
  });

  it('lets STAFF read and create drafts', async () => {
    const list = await request(app).get('/api/v1/sales').set(auth(staffA));
    const one = await request(app).get(`/api/v1/sales/${draftId}`).set(auth(staffA));
    const created = await createSale(staffA, saleBody(ctxA));

    expect(list.status).toBe(200);
    expect(one.status).toBe(200);
    expect(created.status).toBe(201);
  });

  it('lets STAFF edit a draft', async () => {
    const response = await request(app)
      .patch(`/api/v1/sales/${draftId}`)
      .set(auth(staffA))
      .send({ ...saleBody(ctxA), notes: 'Edited by staff' });

    expect(response.status).toBe(200);
  });

  it('forbids STAFF from posting or cancelling', async () => {
    const posted = await postSale(staffA, draftId);
    const cancelled = await request(app)
      .post(`/api/v1/sales/${draftId}/cancel`)
      .set(auth(staffA));

    expect(posted.status).toBe(403);
    expect(cancelled.status).toBe(403);
    expect(await prisma.stockMovement.count({ where: { type: 'STOCK_OUT' } })).toBe(0);
  });

  it('requires authentication', async () => {
    const list = await request(app).get('/api/v1/sales');
    const create = await request(app).post('/api/v1/sales').send({});

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
  });
});

describe('sales tenant isolation', () => {
  let saleA;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    await stockUp(adminB, ctxB, ctxB.productId, '100', '80');
    saleA = (await createSale(adminA, saleBody(ctxA))).body.data.sale;
  });

  it('lists only the current company invoices', async () => {
    const listA = await request(app).get('/api/v1/sales').set(auth(adminA));
    const listB = await request(app).get('/api/v1/sales').set(auth(adminB));

    expect(listA.body.pagination.total).toBe(1);
    expect(listB.body.pagination.total).toBe(0);
  });

  it('returns 404 when reading, editing, posting or cancelling another company invoice', async () => {
    const read = await request(app).get(`/api/v1/sales/${saleA.id}`).set(auth(adminB));
    const edit = await request(app)
      .patch(`/api/v1/sales/${saleA.id}`)
      .set(auth(adminB))
      .send(saleBody(ctxB));
    const posted = await postSale(adminB, saleA.id);
    const cancelled = await request(app)
      .post(`/api/v1/sales/${saleA.id}/cancel`)
      .set(auth(adminB));

    expect(read.status).toBe(404);
    expect(edit.status).toBe(404);
    expect(posted.status).toBe(404);
    expect(cancelled.status).toBe(404);

    const reread = await request(app).get(`/api/v1/sales/${saleA.id}`).set(auth(adminA));
    expect(reread.body.data.sale.status).toBe('DRAFT');
  });

  it('refuses another company customer, product or warehouse', async () => {
    const customer = await createSale(adminA, { ...saleBody(ctxA), customerId: ctxB.customerId });
    const warehouse = await createSale(adminA, { ...saleBody(ctxA), warehouseId: ctxB.warehouseId });
    const product = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxB.productId, quantity: '1', unitPrice: '1' }],
    });
    const tax = await createSale(adminA, {
      ...saleBody(ctxA),
      items: [{ productId: ctxA.productId, taxId: ctxB.taxId, quantity: '1', unitPrice: '1' }],
    });

    expect(customer.body.code).toBe('CUSTOMER_NOT_FOUND');
    expect(warehouse.body.code).toBe('WAREHOUSE_NOT_FOUND');
    expect(product.body.code).toBe('PRODUCT_NOT_FOUND');
    expect(tax.body.code).toBe('TAX_NOT_FOUND');
  });

  it('ignores a companyId sent in the body', async () => {
    const response = await createSale(adminA, { ...saleBody(ctxA), companyId: companyB.company.id });

    expect(response.status).toBe(201);
    const stored = await prisma.salesInvoice.findUnique({
      where: { id: response.body.data.sale.id },
    });
    expect(stored.companyId).toBe(companyA.company.id);
  });

  it('posts into the correct company stock only', async () => {
    await postSale(adminA, saleA.id);

    const balanceA = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const balanceB = await readBalance(adminB, ctxB.productId, ctxB.warehouseId);

    expect(balanceA.body.data.balance.quantity).toBe('90.000');
    expect(balanceB.body.data.balance.quantity).toBe('100.000');
  });

  it('numbers invoices per company', async () => {
    const saleB = await createSale(adminB, saleBody(ctxB));

    expect(saleA.invoiceNumber).toBe('INV-2026-000001');
    expect(saleB.body.data.sale.invoiceNumber).toBe('INV-2026-000001');
    expect(saleA.id).not.toBe(saleB.body.data.sale.id);
  });
});
