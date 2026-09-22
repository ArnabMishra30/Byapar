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
    .send({ name: `SRCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `SRUnit ${suffix}`, shortCode: `SR${suffix}` });
  const tax = await request(app)
    .post('/api/v1/taxes')
    .set(auth(token))
    .send({ name: `SRGST ${suffix}`, rate: '18' });

  const makeProduct = async (n) => {
    const response = await request(app)
      .post('/api/v1/products')
      .set(auth(token))
      .send({
        name: `SRProd${n} ${suffix}`,
        sku: `SRSKU${n}-${suffix}`,
        categoryId: category.body.data.category.id,
        unitId: unit.body.data.unit.id,
      });
    return response.body.data.product.id;
  };

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `SRSup ${suffix}` });
  const customer = await request(app)
    .post('/api/v1/customers')
    .set(auth(token))
    .send({ name: `SRCust ${suffix}` });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `SRWH ${suffix}`, code: `SW${suffix}` });

  return {
    productId: await makeProduct('A'),
    productId2: await makeProduct('B'),
    taxId: tax.body.data.tax.id,
    supplierId: supplier.body.data.supplier.id,
    customerId: customer.body.data.customer.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

async function stockUp(token, ctx, productId, quantity, unitCost) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `SRB-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-01',
      items: [{ productId, quantity, unitCost }],
    });
  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
}

/** Posts a sales invoice and returns it. Defaults: 10 @ 120 with 18% tax. */
async function postedSale(token, ctx, items) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId: ctx.customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate: '2026-09-01',
      dueDate: '2026-09-30',
      items: items ?? [{ productId: ctx.productId, taxId: ctx.taxId, quantity: '10', unitPrice: '120' }],
    });

  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/sales/${created.body.data.sale.id}/post`)
    .set(auth(token));

  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

const createReturn = (token, body) =>
  request(app).post('/api/v1/sales-returns').set(auth(token)).send(body);
const postReturn = (token, id) =>
  request(app).post(`/api/v1/sales-returns/${id}/post`).set(auth(token));
const readBalance = (token, productId, warehouseId) =>
  request(app).get(`/api/v1/inventory/${productId}/${warehouseId}`).set(auth(token));
const returnableFor = (token, saleId) =>
  request(app).get(`/api/v1/sales-returns/returnable/${saleId}`).set(auth(token));

async function receivableFor(token, saleId) {
  const response = await request(app)
    .get('/api/v1/customer-receivables?limit=100')
    .set(auth(token));
  return response.body.data.find((r) => r.salesInvoice.id === saleId);
}

function returnBody(sale, lines, overrides = {}) {
  return {
    salesInvoiceId: sale.id,
    returnDate: '2026-09-10',
    reason: 'Damaged on delivery',
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
  await prisma.salesReturnItem.deleteMany();
  await prisma.salesReturn.deleteMany();
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

describe('sales return drafts', () => {
  let sale;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    sale = await postedSale(adminA, ctxA);
  });

  it('creates a draft with a generated return number', async () => {
    const response = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.salesReturn.status).toBe('DRAFT');
    expect(response.body.data.salesReturn.returnNumber).toMatch(/^SR-2026-\d{6}$/);
    expect(response.body.data.salesReturn.createdBy.id).toBe(companyA.admin.id);
  });

  it('rebuilds the credit from the original invoice line', async () => {
    const response = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );

    const item = response.body.data.salesReturn.items[0];
    // 4 * 120 = 480, + 18% = 566.40
    expect(item.unitPrice).toBe('120.0000');
    expect(item.taxableAmount).toBe('480.00');
    expect(item.taxAmount).toBe('86.40');
    expect(item.lineTotal).toBe('566.40');
    expect(response.body.data.salesReturn.grandTotal).toBe('566.40');
  });

  it('carries the frozen COGS onto the return line', async () => {
    const response = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );

    const item = response.body.data.salesReturn.items[0];
    expect(item.cogsUnitCost).toBe('80.0000');
    expect(item.cogsAmount).toBe('320.00');
  });

  it('ignores client-supplied totals, COGS, company and warehouse', async () => {
    const response = await createReturn(adminA, {
      ...returnBody(sale, [
        { salesInvoiceItemId: sale.items[0].id, quantity: '4', unitPrice: '5', lineTotal: '1', cogsUnitCost: '999' },
      ]),
      grandTotal: '1',
      cogsTotal: '999',
      companyId: companyB.company.id,
      warehouseId: ctxB.warehouseId,
      customerId: ctxB.customerId,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.salesReturn.grandTotal).toBe('566.40');
    expect(response.body.data.salesReturn.items[0].unitPrice).toBe('120.0000');
    expect(response.body.data.salesReturn.items[0].cogsUnitCost).toBe('80.0000');
    expect(response.body.data.salesReturn.warehouse.id).toBe(ctxA.warehouseId);
    expect(response.body.data.salesReturn.customer.id).toBe(ctxA.customerId);

    const stored = await prisma.salesReturn.findUnique({
      where: { id: response.body.data.salesReturn.id },
    });
    expect(stored.companyId).toBe(companyA.company.id);
    expect(stored.warehouseId).toBe(ctxA.warehouseId);
  });

  it('does NOT change stock or the receivable while it is a draft', async () => {
    await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('90.000');

    const receivable = await receivableFor(adminA, sale.id);
    expect(receivable.outstandingAmount).toBe('1416.00');
    expect(receivable.creditAmount).toBe('0.00');

    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { referenceType: 'SALES_RETURN' } })).toBe(0);
  });

  it('reads a return back, and lists and filters returns', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '2' }]),
    );

    const one = await request(app)
      .get(`/api/v1/sales-returns/${created.body.data.salesReturn.id}`)
      .set(auth(adminA));
    const list = await request(app).get('/api/v1/sales-returns?page=1&limit=10').set(auth(adminA));
    const byInvoice = await request(app)
      .get(`/api/v1/sales-returns?salesInvoiceId=${sale.id}`)
      .set(auth(adminA));
    const drafts = await request(app).get('/api/v1/sales-returns?status=DRAFT').set(auth(adminA));

    expect(one.status).toBe(200);
    expect(one.body.data.salesReturn.items).toHaveLength(1);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].items).toBeUndefined();
    expect(byInvoice.body.pagination.total).toBe(1);
    expect(drafts.body.pagination.total).toBe(1);
  });

  it('updates a draft and recalculates the credit', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '2' }]),
    );

    const response = await request(app)
      .patch(`/api/v1/sales-returns/${created.body.data.salesReturn.id}`)
      .set(auth(adminA))
      .send(returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '5' }]));

    expect(response.status).toBe(200);
    expect(response.body.data.salesReturn.items[0].quantity).toBe('5.000');
    expect(response.body.data.salesReturn.grandTotal).toBe('708.00');
    expect(response.body.data.salesReturn.returnNumber).toBe(
      created.body.data.salesReturn.returnNumber,
    );
  });

  it('refuses to move a return to a different invoice', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '2' }]),
    );
    const other = await postedSale(adminA, ctxA);

    const response = await request(app)
      .patch(`/api/v1/sales-returns/${created.body.data.salesReturn.id}`)
      .set(auth(adminA))
      .send(returnBody(other, [{ salesInvoiceItemId: other.items[0].id, quantity: '1' }]));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SALES_RETURN_INVOICE_IMMUTABLE');
  });

  it('cancels a draft; the cancelled return affects nothing', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    const id = created.body.data.salesReturn.id;

    const cancelled = await request(app)
      .post(`/api/v1/sales-returns/${id}/cancel`)
      .set(auth(adminA));

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.salesReturn.status).toBe('CANCELLED');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('90.000');
    expect((await receivableFor(adminA, sale.id)).outstandingAmount).toBe('1416.00');

    // And a cancelled return does not consume returnable quantity.
    const returnable = await returnableFor(adminA, sale.id);
    expect(returnable.body.data.returnable.lines[0].remainingQuantity).toBe('10.000');

    const posted = await postReturn(adminA, id);
    expect(posted.status).toBe(409);
    expect(posted.body.code).toBe('SALES_RETURN_NOT_POSTABLE');
  });

  it('reports what is still returnable on the invoice', async () => {
    const response = await returnableFor(adminA, sale.id);

    expect(response.status).toBe(200);
    const line = response.body.data.returnable.lines[0];
    expect(line.soldQuantity).toBe('10.000');
    expect(line.returnedQuantity).toBe('0.000');
    expect(line.remainingQuantity).toBe('10.000');
    expect(line.unitPrice).toBe('120.0000');
    expect(line.cogsUnitCost).toBe('80.0000');
  });
});

describe('sales return validation', () => {
  let sale;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    sale = await postedSale(adminA, ctxA);
  });

  it('rejects an empty item list', async () => {
    const response = await createReturn(adminA, returnBody(sale, []));
    expect(response.status).toBe(400);
  });

  it('rejects a zero or negative quantity', async () => {
    const zero = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '0' }]),
    );
    const negative = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '-5' }]),
    );

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects the same invoice line twice in one return', async () => {
    const response = await createReturn(
      adminA,
      returnBody(sale, [
        { salesInvoiceItemId: sale.items[0].id, quantity: '2' },
        { salesInvoiceItemId: sale.items[0].id, quantity: '3' },
      ]),
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('more than once');
  });

  it('rejects a malformed date and a malformed id', async () => {
    const badDate = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '1' }], {
        returnDate: '10/09/2026',
      }),
    );
    const badId = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: 'not-a-uuid', quantity: '1' }]),
    );

    expect(badDate.status).toBe(400);
    expect(badId.status).toBe(400);
  });

  it('rejects an unknown invoice', async () => {
    const response = await createReturn(adminA, {
      salesInvoiceId: '00000000-0000-4000-8000-000000000000',
      returnDate: '2026-09-10',
      items: [{ salesInvoiceItemId: sale.items[0].id, quantity: '1' }],
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SALE_NOT_FOUND');
  });

  it('rejects a line belonging to another invoice', async () => {
    const other = await postedSale(adminA, ctxA);

    const response = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: other.items[0].id, quantity: '1' }]),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SALE_ITEM_NOT_FOUND');
  });

  it('refuses to return against a DRAFT invoice', async () => {
    const draft = await request(app)
      .post('/api/v1/sales')
      .set(auth(adminA))
      .send({
        customerId: ctxA.customerId,
        warehouseId: ctxA.warehouseId,
        invoiceDate: '2026-09-01',
        items: [{ productId: ctxA.productId, quantity: '2', unitPrice: '120' }],
      });

    const response = await createReturn(
      adminA,
      returnBody(draft.body.data.sale, [
        { salesInvoiceItemId: draft.body.data.sale.items[0].id, quantity: '1' },
      ]),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SALE_NOT_POSTED');
  });

  it('refuses to return against a CANCELLED invoice', async () => {
    const draft = await request(app)
      .post('/api/v1/sales')
      .set(auth(adminA))
      .send({
        customerId: ctxA.customerId,
        warehouseId: ctxA.warehouseId,
        invoiceDate: '2026-09-01',
        items: [{ productId: ctxA.productId, quantity: '2', unitPrice: '120' }],
      });
    await request(app)
      .post(`/api/v1/sales/${draft.body.data.sale.id}/cancel`)
      .set(auth(adminA));

    const response = await createReturn(
      adminA,
      returnBody(draft.body.data.sale, [
        { salesInvoiceItemId: draft.body.data.sale.items[0].id, quantity: '1' },
      ]),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SALE_NOT_POSTED');
  });

  it('rejects returning more than was sold', async () => {
    const response = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '11' }]),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('SALES_RETURN_EXCEEDS_INVOICE_QTY');
  });
});

describe('posting a sales return', () => {
  let sale;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    sale = await postedSale(adminA, ctxA);
  });

  it('posts and records who and when', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    const response = await postReturn(adminA, created.body.data.salesReturn.id);

    expect(response.status).toBe(200);
    expect(response.body.data.salesReturn.status).toBe('POSTED');
    expect(response.body.data.salesReturn.postedBy.id).toBe(companyA.admin.id);
    expect(response.body.data.salesReturn.postedAt).toBeTruthy();
  });

  it('puts stock back at the frozen COGS cost', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    const returnId = created.body.data.salesReturn.id;
    await postReturn(adminA, returnId);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('94.000');
    // Returning at the same cost it left at restores the average exactly.
    expect(balance.body.data.balance.averageCost).toBe('80.0000');

    const movements = await request(app)
      .get('/api/v1/inventory/movements?type=STOCK_IN')
      .set(auth(adminA));
    const movement = movements.body.data.find((m) => m.referenceType === 'SALES_RETURN');

    expect(movement.quantity).toBe('4.000');
    expect(movement.unitCost).toBe('80.0000');
    expect(movement.totalCost).toBe('320.00');
    expect(movement.referenceId).toBe(returnId);
    expect(created.body.data.salesReturn.items[0].cogsAmount).toBe('320.00');
  });

  it('uses the ORIGINAL frozen cost even when the average has since moved', async () => {
    // A later, dearer purchase lifts the average well above 80.
    await stockUp(adminA, ctxA, ctxA.productId, '90', '200');
    const before = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(before.body.data.balance.averageCost).not.toBe('80.0000');

    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    await postReturn(adminA, created.body.data.salesReturn.id);

    const movements = await request(app)
      .get('/api/v1/inventory/movements?type=STOCK_IN')
      .set(auth(adminA));
    const movement = movements.body.data.find((m) => m.referenceType === 'SALES_RETURN');

    // 80, not today's average.
    expect(movement.unitCost).toBe('80.0000');
  });

  it('reduces the receivable and writes exactly one SALES_RETURN ledger entry', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    await postReturn(adminA, created.body.data.salesReturn.id);

    const receivable = await receivableFor(adminA, sale.id);
    // 1416 invoiced, 566.40 credited.
    expect(receivable.creditAmount).toBe('566.40');
    expect(receivable.outstandingAmount).toBe('849.60');
    expect(receivable.status).toBe('PARTIALLY_PAID');

    const ledger = await request(app)
      .get(`/api/v1/customers/${ctxA.customerId}/ledger`)
      .set(auth(adminA));
    const entries = ledger.body.data.ledger.entries;

    expect(entries).toHaveLength(2);
    expect(entries[1].type).toBe('SALES_RETURN');
    expect(entries[1].credit).toBe('566.40');
    expect(entries[1].balance).toBe('849.60');
    expect(entries[1].referenceId).toBe(created.body.data.salesReturn.id);
    expect(ledger.body.data.ledger.closingBalance).toBe('849.60');

    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } })).toBe(1);
  });

  it('takes the customer outstanding to zero on a full return', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '10' }]),
    );
    await postReturn(adminA, created.body.data.salesReturn.id);

    const receivable = await receivableFor(adminA, sale.id);
    expect(receivable.creditAmount).toBe('1416.00');
    expect(receivable.outstandingAmount).toBe('0.00');
    expect(receivable.status).toBe('CREDITED');

    const outstanding = await request(app)
      .get(`/api/v1/customers/${ctxA.customerId}/outstanding`)
      .set(auth(adminA));
    expect(outstanding.body.data.outstanding.totalReturns).toBe('1416.00');
    expect(outstanding.body.data.outstanding.outstandingAmount).toBe('0.00');

    // And all stock is back.
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
  });

  it('never modifies the original invoice', async () => {
    const before = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(adminA));

    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    await postReturn(adminA, created.body.data.salesReturn.id);

    const after = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(adminA));

    expect(after.body.data.sale.status).toBe('POSTED');
    expect(after.body.data.sale.grandTotal).toBe(before.body.data.sale.grandTotal);
    expect(after.body.data.sale.items[0].quantity).toBe('10.000');
    expect(after.body.data.sale.items[0].cogsUnitCost).toBe('80.0000');
    expect(after.body.data.sale.cogsTotal).toBe(before.body.data.sale.cogsTotal);
  });

  it('cannot post the same return twice', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    const id = created.body.data.salesReturn.id;

    await postReturn(adminA, id);
    const second = await postReturn(adminA, id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SALES_RETURN_ALREADY_POSTED');
    expect(await prisma.stockMovement.count({ where: { referenceType: 'SALES_RETURN' } })).toBe(1);
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } })).toBe(1);
  });

  it('cannot edit or cancel a posted return', async () => {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    await postReturn(adminA, created.body.data.salesReturn.id);

    const edited = await request(app)
      .patch(`/api/v1/sales-returns/${created.body.data.salesReturn.id}`)
      .set(auth(adminA))
      .send(returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '2' }]));
    const cancelled = await request(app)
      .post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/cancel`)
      .set(auth(adminA));

    expect(edited.status).toBe(409);
    expect(edited.body.code).toBe('SALES_RETURN_ALREADY_POSTED');
    expect(cancelled.status).toBe(409);
  });

  it('returns 404 for an unknown return', async () => {
    const response = await postReturn(adminA, '00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SALES_RETURN_NOT_FOUND');
  });

  it('keeps decimal precision exactly', async () => {
    await stockUp(adminA, ctxA, ctxA.productId2, '1', '0.1');
    const preciseSale = await postedSale(adminA, ctxA, [
      { productId: ctxA.productId2, quantity: '0.3', unitPrice: '0.2' },
    ]);

    const created = await createReturn(
      adminA,
      returnBody(preciseSale, [{ salesInvoiceItemId: preciseSale.items[0].id, quantity: '0.1' }]),
    );
    await postReturn(adminA, created.body.data.salesReturn.id);

    expect(created.body.data.salesReturn.grandTotal).toBe('0.02');

    const balance = await readBalance(adminA, ctxA.productId2, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.800');
  });
});

describe('partial sales returns', () => {
  let sale;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    sale = await postedSale(adminA, ctxA);
  });

  async function returnQuantity(quantity) {
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity }]),
    );
    if (created.status !== 201) return created;
    return postReturn(adminA, created.body.data.salesReturn.id);
  }

  async function remaining() {
    const response = await returnableFor(adminA, sale.id);
    return response.body.data.returnable.lines[0].remainingQuantity;
  }

  it('walks 10 down to 0 across several returns and then refuses more', async () => {
    expect(await remaining()).toBe('10.000');

    expect((await returnQuantity('2')).status).toBe(200);
    expect(await remaining()).toBe('8.000');

    expect((await returnQuantity('3')).status).toBe(200);
    expect(await remaining()).toBe('5.000');

    expect((await returnQuantity('5')).status).toBe(200);
    expect(await remaining()).toBe('0.000');

    const excess = await returnQuantity('1');
    expect(excess.status).toBe(422);
    expect(excess.body.code).toBe('SALES_RETURN_EXCEEDS_INVOICE_QTY');

    // All stock back, receivable fully credited.
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');

    const receivable = await receivableFor(adminA, sale.id);
    expect(receivable.creditAmount).toBe('1416.00');
    expect(receivable.outstandingAmount).toBe('0.00');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } })).toBe(3);
  });

  it('counts only POSTED returns against the remaining quantity', async () => {
    // A draft for everything reserves nothing.
    await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '10' }]),
    );

    expect(await remaining()).toBe('10.000');

    expect((await returnQuantity('4')).status).toBe(200);
    expect(await remaining()).toBe('6.000');
  });

  it('blocks posting a stale draft that exceeds what is now returnable', async () => {
    const first = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '9' }]),
    );
    const second = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '9' }]),
    );

    expect((await postReturn(adminA, first.body.data.salesReturn.id)).status).toBe(200);

    const stale = await postReturn(adminA, second.body.data.salesReturn.id);
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('SALES_RETURN_EXCEEDS_INVOICE_QTY');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('99.000');
  });
});

describe('sales return rollback', () => {
  beforeEach(resetTransactions);

  it('rolls back every line when a later line exceeds what is returnable', async () => {
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    await stockUp(adminA, ctxA, ctxA.productId2, '100', '40');

    const sale = await postedSale(adminA, ctxA, [
      { productId: ctxA.productId, quantity: '10', unitPrice: '120' },
      { productId: ctxA.productId2, quantity: '10', unitPrice: '60' },
    ]);

    // Use up the second line with a posted return.
    const first = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[1].id, quantity: '10' }]),
    );
    await postReturn(adminA, first.body.data.salesReturn.id);

    const stockBefore = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const receivableBefore = await receivableFor(adminA, sale.id);
    const ledgerBefore = await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } });

    // Line 1 is valid, line 2 has nothing left to return.
    const second = await createReturn(
      adminA,
      returnBody(sale, [
        { salesInvoiceItemId: sale.items[0].id, quantity: '5' },
        { salesInvoiceItemId: sale.items[1].id, quantity: '5' },
      ]),
    );

    expect(second.status).toBe(422);
    expect(second.body.code).toBe('SALES_RETURN_EXCEEDS_INVOICE_QTY');

    // Nothing at all happened - not even the valid first line.
    const stockAfter = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(stockAfter.body.data.balance.quantity).toBe(stockBefore.body.data.balance.quantity);
    expect((await receivableFor(adminA, sale.id)).creditAmount).toBe(receivableBefore.creditAmount);
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } })).toBe(ledgerBefore);
  });

  it('leaves nothing behind when posting fails on the second line', async () => {
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    await stockUp(adminA, ctxA, ctxA.productId2, '100', '40');

    const sale = await postedSale(adminA, ctxA, [
      { productId: ctxA.productId, quantity: '10', unitPrice: '120' },
      { productId: ctxA.productId2, quantity: '10', unitPrice: '60' },
    ]);

    // Two drafts each claiming everything on line 2; post one, then the other.
    const draftA = await createReturn(
      adminA,
      returnBody(sale, [
        { salesInvoiceItemId: sale.items[0].id, quantity: '5' },
        { salesInvoiceItemId: sale.items[1].id, quantity: '10' },
      ]),
    );
    const draftB = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[1].id, quantity: '10' }]),
    );

    expect((await postReturn(adminA, draftB.body.data.salesReturn.id)).status).toBe(200);

    const stockBefore = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const movementsBefore = await prisma.stockMovement.count({ where: { referenceType: 'SALES_RETURN' } });

    const failed = await postReturn(adminA, draftA.body.data.salesReturn.id);
    expect(failed.status).toBe(422);

    // The valid first line of draftA did not move stock.
    const stockAfter = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(stockAfter.body.data.balance.quantity).toBe(stockBefore.body.data.balance.quantity);
    expect(await prisma.stockMovement.count({ where: { referenceType: 'SALES_RETURN' } })).toBe(movementsBefore);

    const reread = await request(app)
      .get(`/api/v1/sales-returns/${draftA.body.data.salesReturn.id}`)
      .set(auth(adminA));
    expect(reread.body.data.salesReturn.status).toBe('DRAFT');
    expect(reread.body.data.salesReturn.cogsTotal).toBe('0.00');
  });
});

describe('sales return concurrency', () => {
  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '1000', '80');
  });

  it('allows only one of five simultaneous posts of the same return', async () => {
    const sale = await postedSale(adminA, ctxA);
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }]),
    );
    const id = created.body.data.salesReturn.id;

    const results = await Promise.all(Array.from({ length: 5 }, () => postReturn(adminA, id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);

    // Exactly one stock movement and one ledger entry - no double credit.
    expect(await prisma.stockMovement.count({ where: { referenceType: 'SALES_RETURN' } })).toBe(1);
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'SALES_RETURN' } })).toBe(1);

    const receivable = await receivableFor(adminA, sale.id);
    expect(receivable.creditAmount).toBe('566.40');
  });

  it('allows only one of two returns competing for the same remaining quantity', async () => {
    const sale = await postedSale(adminA, ctxA);

    // Two separate drafts, each asking for 6 of the 10 sold.
    const a = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '6' }]),
    );
    const b = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '6' }]),
    );

    const results = await Promise.all([
      postReturn(adminA, a.body.data.salesReturn.id),
      postReturn(adminA, b.body.data.salesReturn.id),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(1);
    expect(results.find((r) => r.status === 422).body.code).toBe('SALES_RETURN_EXCEEDS_INVOICE_QTY');

    // Never over-returned.
    const returned = await prisma.salesReturnItem.aggregate({
      where: { salesReturn: { salesInvoiceId: sale.id, status: 'POSTED' } },
      _sum: { quantity: true },
    });
    expect(Number(returned._sum.quantity)).toBe(6);

    const receivable = await receivableFor(adminA, sale.id);
    expect(Number(receivable.creditAmount)).toBeLessThanOrEqual(Number(receivable.originalAmount));
  });

  it('gives concurrent drafts distinct return numbers', async () => {
    const sale = await postedSale(adminA, ctxA);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createReturn(
          adminA,
          returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '1' }]),
        ),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.salesReturn.returnNumber)).size).toBe(6);
  });
});

describe('sales return RBAC', () => {
  let sale;
  let draftId;

  beforeEach(async () => {
    await resetTransactions();
    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    sale = await postedSale(adminA, ctxA);
    const created = await createReturn(
      adminA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '2' }]),
    );
    draftId = created.body.data.salesReturn.id;
  });

  it('lets STAFF read, create and edit drafts', async () => {
    const list = await request(app).get('/api/v1/sales-returns').set(auth(staffA));
    const one = await request(app).get(`/api/v1/sales-returns/${draftId}`).set(auth(staffA));
    const returnable = await returnableFor(staffA, sale.id);
    const created = await createReturn(
      staffA,
      returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '1' }]),
    );
    const edited = await request(app)
      .patch(`/api/v1/sales-returns/${draftId}`)
      .set(auth(staffA))
      .send(returnBody(sale, [{ salesInvoiceItemId: sale.items[0].id, quantity: '3' }]));

    expect(list.status).toBe(200);
    expect(one.status).toBe(200);
    expect(returnable.status).toBe(200);
    expect(created.status).toBe(201);
    expect(edited.status).toBe(200);
  });

  it('forbids STAFF from posting or cancelling', async () => {
    const posted = await postReturn(staffA, draftId);
    const cancelled = await request(app)
      .post(`/api/v1/sales-returns/${draftId}/cancel`)
      .set(auth(staffA));

    expect(posted.status).toBe(403);
    expect(cancelled.status).toBe(403);
    expect(await prisma.stockMovement.count({ where: { referenceType: 'SALES_RETURN' } })).toBe(0);
  });

  it('requires authentication', async () => {
    const list = await request(app).get('/api/v1/sales-returns');
    const create = await request(app).post('/api/v1/sales-returns').send({});
    const post = await request(app).post(`/api/v1/sales-returns/${draftId}/post`);

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    expect(post.status).toBe(401);
  });
});

describe('sales return tenant isolation', () => {
  let saleA;
  let saleB;
  let returnA;

  beforeEach(async () => {
    await resetTransactions();

    await stockUp(adminA, ctxA, ctxA.productId, '100', '80');
    await stockUp(adminB, ctxB, ctxB.productId, '100', '80');

    saleA = await postedSale(adminA, ctxA);
    saleB = await postedSale(adminB, ctxB);

    returnA = (
      await createReturn(
        adminA,
        returnBody(saleA, [{ salesInvoiceItemId: saleA.items[0].id, quantity: '2' }]),
      )
    ).body.data.salesReturn;
  });

  it('lists only the current company returns', async () => {
    const listA = await request(app).get('/api/v1/sales-returns').set(auth(adminA));
    const listB = await request(app).get('/api/v1/sales-returns').set(auth(adminB));

    expect(listA.body.pagination.total).toBe(1);
    expect(listB.body.pagination.total).toBe(0);
  });

  it('returns 404 when reading, editing, posting or cancelling another company return', async () => {
    const read = await request(app).get(`/api/v1/sales-returns/${returnA.id}`).set(auth(adminB));
    const edit = await request(app)
      .patch(`/api/v1/sales-returns/${returnA.id}`)
      .set(auth(adminB))
      .send(returnBody(saleB, [{ salesInvoiceItemId: saleB.items[0].id, quantity: '1' }]));
    const posted = await postReturn(adminB, returnA.id);
    const cancelled = await request(app)
      .post(`/api/v1/sales-returns/${returnA.id}/cancel`)
      .set(auth(adminB));

    expect(read.status).toBe(404);
    expect(edit.status).toBe(404);
    expect(posted.status).toBe(404);
    expect(cancelled.status).toBe(404);

    const reread = await request(app).get(`/api/v1/sales-returns/${returnA.id}`).set(auth(adminA));
    expect(reread.body.data.salesReturn.status).toBe('DRAFT');
  });

  it('refuses to reference another company invoice or invoice line', async () => {
    const invoice = await createReturn(
      adminB,
      returnBody(saleA, [{ salesInvoiceItemId: saleA.items[0].id, quantity: '1' }]),
    );
    const line = await createReturn(
      adminB,
      returnBody(saleB, [{ salesInvoiceItemId: saleA.items[0].id, quantity: '1' }]),
    );

    expect(invoice.status).toBe(404);
    expect(invoice.body.code).toBe('SALE_NOT_FOUND');
    expect(line.status).toBe(404);
    expect(line.body.code).toBe('SALE_ITEM_NOT_FOUND');
  });

  it('refuses to read another company returnable lines', async () => {
    const response = await returnableFor(adminB, saleA.id);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SALE_NOT_FOUND');
  });

  it('does not touch the other company stock or ledger when posting', async () => {
    await postReturn(adminA, returnA.id);

    const balanceA = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const balanceB = await readBalance(adminB, ctxB.productId, ctxB.warehouseId);
    const ledgerB = await request(app)
      .get(`/api/v1/customers/${ctxB.customerId}/ledger`)
      .set(auth(adminB));

    expect(balanceA.body.data.balance.quantity).toBe('92.000');
    expect(balanceB.body.data.balance.quantity).toBe('90.000');
    expect(ledgerB.body.data.ledger.entries.every((e) => e.type !== 'SALES_RETURN')).toBe(true);
  });

  it('numbers returns per company', async () => {
    const forB = await createReturn(
      adminB,
      returnBody(saleB, [{ salesInvoiceItemId: saleB.items[0].id, quantity: '1' }]),
    );

    expect(returnA.returnNumber).toBe('SR-2026-000001');
    expect(forB.body.data.salesReturn.returnNumber).toBe('SR-2026-000001');
    expect(returnA.id).not.toBe(forB.body.data.salesReturn.id);
  });
});
