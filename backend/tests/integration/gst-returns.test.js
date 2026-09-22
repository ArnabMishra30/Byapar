import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// GSTR-1 and GSTR-3B preparation datasets, built from real posted documents over
// HTTP, plus the reconciliation that proves they agree with those documents and
// with the general ledger.
//
// The company is registered in Maharashtra (27). Counterparties:
//   registered local    GSTIN + state 27  -> B2B, intra-state (CGST + SGST)
//   registered remote   GSTIN + state 29  -> B2B, inter-state (IGST)
//   unregistered local  no GSTIN, state 27 -> B2C, intra-state
//
// Figures are small enough to check by hand:
//   sale 10 @ 200 + 18%  -> taxable 2000, tax 360, invoice 2360

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const HOME_STATE = '27';
const OTHER_STATE = '29';
const COMPANY_GSTIN = '27AAPFU0939F1ZV';
const B2B_LOCAL_GSTIN = '27AAACC1206D1ZM';
const B2B_REMOTE_GSTIN = '29AAGCB1286Q1ZP';

const PERIOD = '?fromDate=2026-09-01&toDate=2026-09-30';

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let ctx;
let ctxB;

async function prepare(token, suffix, { stateCode = HOME_STATE } = {}) {
  const post = (path, body) => request(app).post(path).set(auth(token)).send(body);

  await request(app)
    .patch('/api/v1/tax/profile')
    .set(auth(token))
    .send({
      stateCode,
      ...(suffix === 'A' ? { gstin: COMPANY_GSTIN, registrationType: 'REGULAR' } : {}),
    });

  const category = await post('/api/v1/categories', { name: `RetCat ${suffix}` });
  const unit = await post('/api/v1/units', { name: `RetUnit ${suffix}`, shortCode: `RU${suffix}` });

  const rates = {};
  for (const rate of [5, 12, 18, 28]) {
    const created = await post('/api/v1/taxes', { name: `RetTax${rate} ${suffix}`, rate: String(rate) });
    rates[rate] = created.body.data.tax.id;
  }

  const cess = await post('/api/v1/taxes', {
    name: `RetCess ${suffix}`,
    rate: '28',
    cessRate: '12',
  });
  const exempt = await post('/api/v1/taxes', {
    name: `RetExempt ${suffix}`,
    rate: '0',
    treatment: 'EXEMPT',
  });
  const nilRated = await post('/api/v1/taxes', {
    name: `RetNil ${suffix}`,
    rate: '0',
    treatment: 'NIL_RATED',
  });

  const hsnA = await post('/api/v1/tax/classifications', {
    code: suffix === 'A' ? '30049011' : '30049021',
    description: 'Medicaments',
  });
  const hsnB = await post('/api/v1/tax/classifications', {
    code: suffix === 'A' ? '30049012' : '30049022',
    description: 'Other medicaments',
  });

  const makeProduct = async (n, classificationId) => {
    const created = await post('/api/v1/products', {
      name: `RetProd${n} ${suffix}`,
      sku: `RET-${suffix}-${n}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
      taxClassificationId: classificationId,
    });
    expect(created.status).toBe(201);
    return created.body.data.product.id;
  };

  const warehouse = await post('/api/v1/warehouses', {
    name: `RetWH ${suffix}`,
    code: `RW${suffix}`,
    stateCode,
  });

  const supplier = await post('/api/v1/suppliers', {
    name: `RetSup ${suffix}`,
    stateCode,
    gstin: suffix === 'A' ? B2B_LOCAL_GSTIN : null,
    gstRegistrationType: 'REGULAR',
  });
  const remoteSupplier = await post('/api/v1/suppliers', {
    name: `RetSupRemote ${suffix}`,
    stateCode: stateCode === HOME_STATE ? OTHER_STATE : HOME_STATE,
    gstRegistrationType: 'REGULAR',
  });

  const b2bLocal = await post('/api/v1/customers', {
    name: `RetCustB2BLocal ${suffix}`,
    stateCode,
    gstin: B2B_LOCAL_GSTIN,
    gstRegistrationType: 'REGULAR',
  });
  const b2bRemote = await post('/api/v1/customers', {
    name: `RetCustB2BRemote ${suffix}`,
    stateCode: stateCode === HOME_STATE ? OTHER_STATE : HOME_STATE,
    gstin: B2B_REMOTE_GSTIN,
    gstRegistrationType: 'REGULAR',
  });
  const b2c = await post('/api/v1/customers', {
    name: `RetCustB2C ${suffix}`,
    stateCode,
  });

  return {
    productA: await makeProduct('A', hsnA.body.data.classification.id),
    productB: await makeProduct('B', hsnB.body.data.classification.id),
    productC: await makeProduct('C', hsnA.body.data.classification.id),
    rates,
    cessTaxId: cess.body.data.tax.id,
    exemptTaxId: exempt.body.data.tax.id,
    nilRatedTaxId: nilRated.body.data.tax.id,
    hsnA: hsnA.body.data.classification.code,
    hsnB: hsnB.body.data.classification.code,
    warehouseId: warehouse.body.data.warehouse.id,
    supplierId: supplier.body.data.supplier.id,
    remoteSupplierId: remoteSupplier.body.data.supplier.id,
    b2bLocalId: b2bLocal.body.data.customer.id,
    b2bRemoteId: b2bRemote.body.data.customer.id,
    b2cId: b2c.body.data.customer.id,
  };
}

// --- document helpers ------------------------------------------------------

let billCounter = 0;

const createPurchase = (token, body) =>
  request(app).post('/api/v1/purchases').set(auth(token)).send(body);

function purchaseBody(context, { supplierId, items, invoiceDate = '2026-09-05' } = {}) {
  return {
    supplierId: supplierId ?? context.supplierId,
    warehouseId: context.warehouseId,
    invoiceNumber: `RETB-${(billCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`,
    invoiceDate,
    items: items ?? [
      { productId: context.productA, quantity: '100', unitCost: '100', taxId: context.rates[18] },
    ],
  };
}

async function postedPurchase(token, context, options) {
  const draft = await createPurchase(token, purchaseBody(context, options));
  expect(draft.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

const createSale = (token, body) => request(app).post('/api/v1/sales').set(auth(token)).send(body);

function saleBody(context, { customerId, items, invoiceDate = '2026-09-10', ...rest } = {}) {
  return {
    customerId: customerId ?? context.b2bLocalId,
    warehouseId: context.warehouseId,
    invoiceDate,
    items: items ?? [
      { productId: context.productA, quantity: '10', unitPrice: '200', taxId: context.rates[18] },
    ],
    ...rest,
  };
}

async function postedSale(token, context, options) {
  const draft = await createSale(token, saleBody(context, options));
  expect(draft.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/sales/${draft.body.data.sale.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

async function postedSalesReturn(token, sale, items, returnDate = '2026-09-20') {
  const created = await request(app)
    .post('/api/v1/sales-returns')
    .set(auth(token))
    .send({ salesInvoiceId: sale.id, returnDate, items });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.salesReturn;
}

async function postedPurchaseReturn(token, purchase, items, returnDate = '2026-09-18') {
  const created = await request(app)
    .post('/api/v1/purchase-returns')
    .set(auth(token))
    .send({ purchaseId: purchase.id, returnDate, items });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchaseReturn;
}

// --- return helpers --------------------------------------------------------

const gstr1 = (token, query = PERIOD) =>
  request(app).get(`/api/v1/tax/returns/gstr-1${query}`).set(auth(token));
const gstr3b = (token, query = PERIOD) =>
  request(app).get(`/api/v1/tax/returns/gstr-3b${query}`).set(auth(token));
const reconciliation = (token, query = PERIOD) =>
  request(app).get(`/api/v1/tax/returns/reconciliation${query}`).set(auth(token));

async function resetTransactions() {
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
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
}

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('retalpha');
  companyB = await createCompanyWithUsers('retbeta');

  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  staffA = await login(app, companyA.staff.email, companyA.staffPassword);
  adminB = await login(app, companyB.admin.email, companyB.adminPassword);

  ctx = await prepare(adminA, 'A');
  ctxB = await prepare(adminB, 'B', { stateCode: OTHER_STATE });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('period handling', () => {
  beforeEach(resetTransactions);

  it('returns an empty but well-formed dataset for a period with nothing in it', async () => {
    const response = await gstr1(adminA);

    expect(response.status).toBe(200);
    const data = response.body.data.gstr1;
    expect(data.b2b.parties).toEqual([]);
    expect(data.b2c.documents).toEqual([]);
    expect(data.creditNotes.registered.parties).toEqual([]);
    expect(data.totals.net.totalTax).toBe('0.00');
    expect(data.totals.invoiceCount).toBe(0);
    expect(data.period.fromDate).toBe('2026-09-01');
    expect(data.period.toDate).toBe('2026-09-30');
    expect(data.period.boundsInclusive).toBe(true);
  });

  it('includes a document dated exactly on the first day of the period', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { invoiceDate: '2026-09-01' });

    const data = (await gstr1(adminA)).body.data.gstr1;
    expect(data.totals.invoiceCount).toBe(1);
    expect(data.totals.invoices.totalTax).toBe('360.00');
  });

  it('includes a document dated exactly on the last day of the period', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { invoiceDate: '2026-09-30' });

    const data = (await gstr1(adminA)).body.data.gstr1;
    expect(data.totals.invoiceCount).toBe(1);
  });

  it('excludes a document one day before the period', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { invoiceDate: '2026-08-31' });

    const data = (await gstr1(adminA)).body.data.gstr1;
    expect(data.totals.invoiceCount).toBe(0);
    expect(data.totals.net.totalTax).toBe('0.00');
  });

  it('excludes a document one day after the period', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { invoiceDate: '2026-10-01' });

    const data = (await gstr1(adminA)).body.data.gstr1;
    expect(data.totals.invoiceCount).toBe(0);
  });

  it('places a credit note by its OWN date, not the invoice date', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { invoiceDate: '2026-09-10' });
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ], '2026-10-05');

    const september = (await gstr1(adminA)).body.data.gstr1;
    const october = (
      await gstr1(adminA, '?fromDate=2026-10-01&toDate=2026-10-31')
    ).body.data.gstr1;

    expect(september.totals.creditNoteCount).toBe(0);
    expect(october.totals.creditNoteCount).toBe(1);
    // The credit note still names the invoice it reverses, from another period.
    expect(october.creditNotes.registered.parties[0].documents[0].originalInvoiceNumber).toBe(
      sale.invoiceNumber,
    );
  });

  it('requires both dates and rejects a reversed range', async () => {
    expect((await gstr1(adminA, '?fromDate=2026-09-01')).status).toBe(400);
    expect((await gstr1(adminA, '?toDate=2026-09-30')).status).toBe(400);
    expect((await gstr1(adminA, '')).status).toBe(400);
    expect(
      (await gstr1(adminA, '?fromDate=2026-09-30&toDate=2026-09-01')).status,
    ).toBe(400);
    expect((await gstr1(adminA, '?fromDate=01-09-2026&toDate=2026-09-30')).status).toBe(400);
  });

  it('is deterministic: the same period twice gives byte-identical data', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });

    const [first, second] = await Promise.all([gstr1(adminA), gstr1(adminA)]);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });

  it('is safe to read concurrently', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);

    const results = await Promise.all([
      gstr1(adminA),
      gstr3b(adminA),
      reconciliation(adminA),
      gstr1(adminA),
      gstr3b(adminA),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(JSON.stringify(results[3].body)).toBe(JSON.stringify(results[0].body));
    expect(JSON.stringify(results[4].body)).toBe(JSON.stringify(results[1].body));
  });
});

describe('document status', () => {
  beforeEach(resetTransactions);

  it('excludes a draft invoice', async () => {
    await postedPurchase(adminA, ctx);
    const draft = await createSale(adminA, saleBody(ctx));
    expect(draft.status).toBe(201);

    const data = (await gstr1(adminA)).body.data.gstr1;
    expect(data.totals.invoiceCount).toBe(0);
    expect(data.totals.net.totalTax).toBe('0.00');
  });

  it('excludes a cancelled invoice', async () => {
    await postedPurchase(adminA, ctx);
    const draft = await createSale(adminA, saleBody(ctx));
    const cancelled = await request(app)
      .post(`/api/v1/sales/${draft.body.data.sale.id}/cancel`)
      .set(auth(adminA));
    expect(cancelled.status).toBe(200);

    const data = (await gstr1(adminA)).body.data.gstr1;
    expect(data.totals.invoiceCount).toBe(0);
  });

  it('counts a cancelled number in the documents-issued table, and says so', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);
    const draft = await createSale(adminA, saleBody(ctx));
    await request(app)
      .post(`/api/v1/sales/${draft.body.data.sale.id}/cancel`)
      .set(auth(adminA));

    const data = (await gstr1(adminA)).body.data.gstr1;
    const invoices = data.documentsIssued.rows.find((row) => row.documentType === 'Tax invoice');

    // The series consumed two numbers; one was cancelled.
    expect(invoices.totalIssued).toBe(2);
    expect(invoices.cancelled).toBe(1);
    expect(invoices.net).toBe(1);
  });

  it('includes a posted document exactly once', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
      ],
    });
    const sale = await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '200', taxId: ctx.rates[18] },
        { productId: ctx.productB, quantity: '5', unitPrice: '100', taxId: ctx.rates[18] },
      ],
    });

    const data = (await gstr1(adminA)).body.data.gstr1;
    const documents = data.b2b.parties.flatMap((party) => party.documents);

    // Two lines, one document.
    expect(documents).toHaveLength(1);
    expect(documents[0].documentNumber).toBe(sale.invoiceNumber);
    expect(data.totals.invoiceCount).toBe(1);
    expect(data.totals.invoices.taxableAmount).toBe('2500.00');
  });

  it('never lets a credit note duplicate its original invoice', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await gstr1(adminA)).body.data.gstr1;

    // The invoice appears once, in b2b. The credit note appears once, in the
    // credit-note table. Neither appears in the other.
    const b2bNumbers = data.b2b.parties.flatMap((p) => p.documents.map((d) => d.documentNumber));
    const cnNumbers = data.creditNotes.registered.parties.flatMap((p) =>
      p.documents.map((d) => d.documentNumber),
    );

    expect(b2bNumbers).toEqual([sale.invoiceNumber]);
    expect(cnNumbers).toHaveLength(1);
    expect(cnNumbers).not.toContain(sale.invoiceNumber);
    expect(data.totals.invoiceCount).toBe(1);
    expect(data.totals.creditNoteCount).toBe(1);
  });
});

describe('GSTR-1 classification', () => {
  beforeEach(resetTransactions);

  it('puts a sale to a registered customer in B2B, under their GSTIN', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.b2b.parties).toHaveLength(1);
    const party = data.b2b.parties[0];
    expect(party.gstin).toBe(B2B_LOCAL_GSTIN);
    expect(party.documentCount).toBe(1);
    expect(party.totalTax).toBe('360.00');
    expect(party.documents[0].documentNumber).toBe(sale.invoiceNumber);
    expect(party.documents[0].placeOfSupply.stateCode).toBe(HOME_STATE);
    expect(party.documents[0].supplyType).toBe('INTRA_STATE');
    expect(data.b2c.documents).toEqual([]);
  });

  it('groups several registered customers separately', async () => {
    await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '200', unitCost: '100', taxId: ctx.rates[18] }],
    });
    await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });
    await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.b2b.parties).toHaveLength(2);
    const byGstin = Object.fromEntries(data.b2b.parties.map((p) => [p.gstin, p]));

    expect(byGstin[B2B_LOCAL_GSTIN].documentCount).toBe(2);
    expect(byGstin[B2B_LOCAL_GSTIN].totalTax).toBe('720.00');
    expect(byGstin[B2B_REMOTE_GSTIN].documentCount).toBe(1);
    expect(byGstin[B2B_REMOTE_GSTIN].igst).toBe('360.00');
  });

  it('puts a sale to an unregistered customer in B2C', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { customerId: ctx.b2cId });

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.b2b.parties).toEqual([]);
    expect(data.b2c.documents).toHaveLength(1);
    expect(data.b2c.documents[0].documentNumber).toBe(sale.invoiceNumber);
    expect(data.b2c.documents[0].counterpartyGstin).toBeNull();
    expect(data.b2c.totals.totalTax).toBe('360.00');
  });

  it('summarises B2C by place of supply and rate, without applying the statutory split', async () => {
    await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '200', unitCost: '100', taxId: ctx.rates[18] }],
    });
    await postedSale(adminA, ctx, { customerId: ctx.b2cId });
    await postedSale(adminA, ctx, { customerId: ctx.b2cId });

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.b2c.byPlaceOfSupplyAndRate).toHaveLength(1);
    expect(data.b2c.byPlaceOfSupplyAndRate[0].stateCode).toBe(HOME_STATE);
    expect(data.b2c.byPlaceOfSupplyAndRate[0].taxRate).toBe('18.00');
    expect(data.b2c.byPlaceOfSupplyAndRate[0].totalTax).toBe('720.00');
    // The B2CL / B2CS split is explicitly not applied, and the dataset says so.
    expect(data.b2c.note).toMatch(/not applied/i);
  });

  it('splits intra-state into CGST and SGST, and inter-state into IGST', async () => {
    await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '200', unitCost: '100', taxId: ctx.rates[18] }],
    });
    await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.b2b.totals.cgst).toBe('180.00');
    expect(data.b2b.totals.sgst).toBe('180.00');
    expect(data.b2b.totals.igst).toBe('360.00');
    expect(data.b2b.totals.totalTax).toBe('720.00');

    const byState = Object.fromEntries(
      data.placeOfSupplySummary.rows.map((row) => [row.stateCode, row]),
    );
    expect(byState[HOME_STATE].supplyType).toBe('INTRA_STATE');
    expect(byState[OTHER_STATE].supplyType).toBe('INTER_STATE');
  });
});

describe('GSTR-1 groupings', () => {
  beforeEach(resetTransactions);

  it('summarises rate-wise across several rates', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
        { productId: ctx.productC, quantity: '100', unitCost: '100' },
      ],
    });

    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '100', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '10', unitPrice: '100', taxId: ctx.rates[12] },
        { productId: ctx.productC, quantity: '10', unitPrice: '100', taxId: ctx.rates[18] },
      ],
    });

    const data = (await gstr1(adminA)).body.data.gstr1;
    const byRate = Object.fromEntries(data.rateSummary.rows.map((row) => [row.taxRate, row]));

    expect(byRate['5.00'].totalTax).toBe('50.00');
    expect(byRate['12.00'].totalTax).toBe('120.00');
    expect(byRate['18.00'].totalTax).toBe('180.00');
    expect(data.rateSummary.totals.totalTax).toBe('350.00');

    // The parts add up to the whole.
    const summed = data.rateSummary.rows.reduce((sum, row) => sum + Number(row.totalTax), 0);
    expect(summed).toBe(Number(data.rateSummary.totals.totalTax));
  });

  it('summarises HSN-wise, merging products that share a code', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
        { productId: ctx.productC, quantity: '100', unitCost: '100' },
      ],
    });

    // A and C share hsnA; B has hsnB.
    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '100', taxId: ctx.rates[18] },
        { productId: ctx.productB, quantity: '10', unitPrice: '100', taxId: ctx.rates[18] },
        { productId: ctx.productC, quantity: '10', unitPrice: '100', taxId: ctx.rates[18] },
      ],
    });

    const data = (await gstr1(adminA)).body.data.gstr1;
    const byHsn = Object.fromEntries(data.hsnSummary.rows.map((row) => [row.hsn, row]));

    expect(byHsn[ctx.hsnA].taxableAmount).toBe('2000.00');
    expect(byHsn[ctx.hsnB].taxableAmount).toBe('1000.00');
    expect(byHsn[ctx.hsnA].isClassified).toBe(true);
    expect(data.hsnSummary.totals.taxableAmount).toBe('3000.00');
  });

  it('shows an unclassified HSN as a gap rather than inventing a code', async () => {
    const noHsn = await request(app)
      .post('/api/v1/products')
      .set(auth(adminA))
      .send({
        name: `RetNoHsn ${Date.now()}`,
        sku: `RET-NOHSN-${Date.now()}`,
        categoryId: (
          await request(app).get('/api/v1/categories?limit=100').set(auth(adminA))
        ).body.data[0].id,
        unitId: (await request(app).get('/api/v1/units?limit=100').set(auth(adminA))).body.data[0]
          .id,
      });

    await postedPurchase(adminA, ctx, {
      items: [{ productId: noHsn.body.data.product.id, quantity: '100', unitCost: '100' }],
    });
    await postedSale(adminA, ctx, {
      items: [
        {
          productId: noHsn.body.data.product.id,
          quantity: '10',
          unitPrice: '200',
          taxId: ctx.rates[18],
        },
      ],
    });

    const data = (await gstr1(adminA)).body.data.gstr1;
    const row = data.hsnSummary.rows.find((entry) => entry.hsn === null);

    expect(row).toBeTruthy();
    expect(row.isClassified).toBe(false);
    expect(row.totalTax).toBe('360.00');
  });

  it('nets credit notes out of the HSN and rate summaries but not the invoice tables', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await gstr1(adminA)).body.data.gstr1;

    // The invoice table still shows the invoice in full.
    expect(data.b2b.totals.totalTax).toBe('360.00');
    // The credit-note table shows the credit note in full, positive.
    expect(data.creditNotes.totals.totalTax).toBe('144.00');
    // The summaries are net.
    expect(data.rateSummary.totals.totalTax).toBe('216.00');
    expect(data.hsnSummary.totals.totalTax).toBe('216.00');
    expect(data.totals.net.totalTax).toBe('216.00');
  });
});

describe('GSTR-1 credit notes', () => {
  beforeEach(resetTransactions);

  it('names the original invoice on a registered credit note', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { invoiceDate: '2026-09-10' });
    const credit = await postedSalesReturn(
      adminA,
      sale,
      [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }],
      '2026-09-20',
    );

    const data = (await gstr1(adminA)).body.data.gstr1;
    const note = data.creditNotes.registered.parties[0].documents[0];

    expect(note.documentNumber).toBe(credit.returnNumber);
    expect(note.documentDate).toBe('2026-09-20');
    expect(note.originalInvoiceNumber).toBe(sale.invoiceNumber);
    expect(note.originalInvoiceDate).toBe('2026-09-10');
    expect(note.originalInvoiceId).toBe(sale.id);
    expect(note.totalTax).toBe('144.00');
    expect(note.cgst).toBe('72.00');
  });

  it('keeps unregistered credit notes in their own table', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { customerId: ctx.b2cId });
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.creditNotes.registered.parties).toEqual([]);
    expect(data.creditNotes.unregistered.documents).toHaveLength(1);
    expect(data.creditNotes.unregistered.documents[0].originalInvoiceNumber).toBe(
      sale.invoiceNumber,
    );
  });

  it('reverses an inter-state credit note as IGST', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.creditNotes.totals.igst).toBe('144.00');
    expect(data.creditNotes.totals.cgst).toBe('0.00');
    expect(data.totals.net.igst).toBe('216.00');
  });
});

describe('exempt, nil-rated and zero-tax supplies', () => {
  beforeEach(resetTransactions);

  it('reports exempt and nil-rated lines under their treatment', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
      ],
    });

    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '100', taxId: ctx.exemptTaxId },
        { productId: ctx.productB, quantity: '10', unitPrice: '100', taxId: ctx.nilRatedTaxId },
      ],
    });

    const data = (await gstr1(adminA)).body.data.gstr1;
    const byTreatment = Object.fromEntries(
      data.nilRatedExemptZeroRated.byTreatment.map((row) => [row.taxTreatment, row]),
    );

    expect(byTreatment.EXEMPT.taxableAmount).toBe('1000.00');
    expect(byTreatment.NIL_RATED.taxableAmount).toBe('1000.00');
    expect(data.nilRatedExemptZeroRated.totals.totalTax).toBe('0.00');

    // The lines are still on their invoice: an invoice is a document, and
    // removing lines from it would misrepresent it.
    expect(data.b2b.parties[0].documents[0].taxableAmount).toBe('2000.00');
  });

  it('does not treat a 0% taxable supply as exempt', async () => {
    const zeroRate = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: `RetZero ${Date.now()}`, rate: '0' });

    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, {
      items: [
        {
          productId: ctx.productA,
          quantity: '10',
          unitPrice: '200',
          taxId: zeroRate.body.data.tax.id,
        },
      ],
    });

    const data = (await gstr1(adminA)).body.data.gstr1;

    // Zero tax, but TAXABLE - so it is not in the nil-rated/exempt table.
    expect(data.nilRatedExemptZeroRated.totals.taxableAmount).toBe('0.00');
    expect(data.rateSummary.rows.find((row) => row.taxRate === '0.00').taxableAmount).toBe(
      '2000.00',
    );
  });

  it('separates taxable from nil-rated in GSTR-3B', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
      ],
    });
    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '200', taxId: ctx.rates[18] },
        { productId: ctx.productB, quantity: '10', unitPrice: '100', taxId: ctx.exemptTaxId },
      ],
    });

    const data = (await gstr3b(adminA)).body.data.gstr3b;

    expect(data.outwardSupplies.taxableSupplies.taxableAmount).toBe('2000.00');
    expect(data.outwardSupplies.taxableSupplies.totalTax).toBe('360.00');
    expect(data.outwardSupplies.nilRatedExemptSupplies.taxableAmount).toBe('1000.00');
    expect(data.outwardSupplies.nilRatedExemptSupplies.totalTax).toBe('0.00');
  });
});

describe('cess', () => {
  beforeEach(resetTransactions);

  it('carries cess through GSTR-1 and GSTR-3B', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '200', taxId: ctx.cessTaxId },
      ],
    });

    const one = (await gstr1(adminA)).body.data.gstr1;
    const threeB = (await gstr3b(adminA)).body.data.gstr3b;

    // 2000 at 28% GST plus 12% cess.
    expect(one.totals.invoices.cgst).toBe('280.00');
    expect(one.totals.invoices.sgst).toBe('280.00');
    expect(one.totals.invoices.cess).toBe('240.00');
    expect(one.totals.invoices.totalTax).toBe('800.00');
    expect(threeB.outwardSupplies.taxableSupplies.cess).toBe('240.00');
  });
});

describe('GSTR-3B input tax credit', () => {
  beforeEach(resetTransactions);

  it('reports purchase tax as all-other ITC', async () => {
    await postedPurchase(adminA, ctx);

    const data = (await gstr3b(adminA)).body.data.gstr3b;

    expect(data.inputTaxCredit.allOtherItc.cgst).toBe('900.00');
    expect(data.inputTaxCredit.allOtherItc.sgst).toBe('900.00');
    expect(data.inputTaxCredit.allOtherItc.totalTax).toBe('1800.00');
    expect(data.inputTaxCredit.netItcAvailable.totalTax).toBe('1800.00');
  });

  it('reports an inter-state purchase as IGST credit', async () => {
    await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });

    const data = (await gstr3b(adminA)).body.data.gstr3b;
    expect(data.inputTaxCredit.allOtherItc.igst).toBe('1800.00');
    expect(data.inputTaxCredit.allOtherItc.cgst).toBe('0.00');
  });

  it('reverses ITC for a purchase return and shows the netting', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    const data = (await gstr3b(adminA)).body.data.gstr3b;

    expect(data.inputTaxCredit.allOtherItc.totalTax).toBe('1800.00');
    expect(data.inputTaxCredit.itcReversed.totalTax).toBe('180.00');
    expect(data.inputTaxCredit.netItcAvailable.totalTax).toBe('1620.00');
    expect(data.inputTaxCredit.netItcAvailable.cgst).toBe('810.00');
  });

  it('breaks ITC down by rate', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '10', unitCost: '100', taxId: ctx.rates[18] },
      ],
    });

    const data = (await gstr3b(adminA)).body.data.gstr3b;
    const byRate = Object.fromEntries(data.inputTaxCredit.byRate.map((row) => [row.taxRate, row]));

    expect(byRate['5.00'].totalTax).toBe('50.00');
    expect(byRate['18.00'].totalTax).toBe('180.00');
  });

  it('names every ITC bucket it cannot determine instead of assuming zero', async () => {
    await postedPurchase(adminA, ctx);

    const data = (await gstr3b(adminA)).body.data.gstr3b;
    const items = data.inputTaxCredit.notDetermined.items.map((entry) => entry.item);

    expect(items).toContain('Import of goods and services');
    expect(items).toContain('Inward supplies liable to reverse charge');
    expect(items).toContain('Ineligible credit under section 17(5)');
    expect(
      data.inputTaxCredit.notDetermined.items.every((entry) => typeof entry.reason === 'string'),
    ).toBe(true);

    // Reverse charge is reported as not determined, not as a zero liability.
    expect(data.outwardSupplies.reverseChargeSupplies.notDetermined).toMatch(/not modelled/i);
  });

  it('never claims the dataset is a filed return', async () => {
    const one = (await gstr1(adminA)).body.data.gstr1;
    const threeB = (await gstr3b(adminA)).body.data.gstr3b;

    expect(one.notFiled).toMatch(/not a filed return/i);
    expect(threeB.notFiled).toMatch(/not a filed return/i);
    expect(threeB.netPosition.notDetermined).toMatch(/interest/i);
  });
});

describe('GSTR-3B outward supplies', () => {
  beforeEach(resetTransactions);

  it('nets credit notes out of the outward liability, and shows both sides', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await gstr3b(adminA)).body.data.gstr3b;

    expect(data.outwardSupplies.taxableSupplies.gross.totalTax).toBe('360.00');
    expect(data.outwardSupplies.taxableSupplies.lessCreditNotes.totalTax).toBe('144.00');
    expect(data.outwardSupplies.taxableSupplies.totalTax).toBe('216.00');
  });

  it('reports inter-state supplies to unregistered persons by place of supply', async () => {
    const remoteB2c = await request(app)
      .post('/api/v1/customers')
      .set(auth(adminA))
      .send({ name: `RetB2CRemote ${Date.now()}`, stateCode: OTHER_STATE });

    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { customerId: remoteB2c.body.data.customer.id });

    const data = (await gstr3b(adminA)).body.data.gstr3b;

    expect(data.interStateSuppliesToUnregistered.rows).toHaveLength(1);
    expect(data.interStateSuppliesToUnregistered.rows[0].stateCode).toBe(OTHER_STATE);
    expect(data.interStateSuppliesToUnregistered.rows[0].igst).toBe('360.00');
  });

  it('excludes registered inter-state supplies from that table', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });

    const data = (await gstr3b(adminA)).body.data.gstr3b;
    expect(data.interStateSuppliesToUnregistered.rows).toEqual([]);
    expect(data.interStateSuppliesToUnregistered.totals.totalTax).toBe('0.00');
  });

  it('computes the net position from outward tax less net ITC', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);

    const data = (await gstr3b(adminA)).body.data.gstr3b;

    // Output 360, input 1800.
    expect(data.netPosition.totalTax).toBe('-1440.00');
    expect(data.netPosition.position).toBe('CREDIT');
  });
});

describe('reconciliation', () => {
  beforeEach(resetTransactions);

  it('reconciles an empty period', async () => {
    const response = await reconciliation(adminA);

    expect(response.status).toBe(200);
    expect(response.body.data.reconciliation.summary.isReconciled).toBe(true);
    expect(response.body.data.reconciliation.summary.failed).toBe(0);
    expect(response.body.data.reconciliation.failedChecks).toEqual([]);
  });

  it('reconciles a full period across every document type', async () => {
    const purchase = await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '200', unitCost: '100', taxId: ctx.rates[18] }],
    });
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);
    const b2bSale = await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });
    await postedSale(adminA, ctx, { customerId: ctx.b2cId });
    await postedSalesReturn(adminA, b2bSale, [
      { salesInvoiceItemId: b2bSale.items[0].id, quantity: '4' },
    ]);

    const data = (await reconciliation(adminA)).body.data.reconciliation;

    expect(data.summary.isReconciled).toBe(true);
    expect(data.summary.failed).toBe(0);
    expect(data.summary.totalChecks).toBeGreaterThan(20);
    expect(data.documentCounts.SALES_INVOICE).toBe(3);
    expect(data.documentCounts.SALES_RETURN).toBe(1);
    expect(data.documentCounts.PURCHASE).toBe(1);
    expect(data.documentCounts.PURCHASE_RETURN).toBe(1);
  });

  it('checks the datasets against the general ledger tax accounts', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);

    const data = (await reconciliation(adminA)).body.data.reconciliation;
    const byName = Object.fromEntries(data.checks.map((check) => [check.check, check]));

    expect(byName['ledger.outputTax'].ok).toBe(true);
    expect(byName['ledger.outputTax'].expected).toBe('360.00');
    expect(byName['ledger.inputTax'].ok).toBe(true);
    expect(byName['ledger.inputTax'].expected).toBe('1800.00');

    const ledgerRows = Object.fromEntries(
      data.ledgerComparison.rows.map((row) => [row.code, row.balance]),
    );
    expect(ledgerRows['1510']).toBe('900.00');
    expect(ledgerRows['2110']).toBe('180.00');
  });

  it('checks that every grouping still adds up', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
      ],
    });
    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '7', unitPrice: '333.33', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '3', unitPrice: '111.11', taxId: ctx.rates[18] },
      ],
    });

    const data = (await reconciliation(adminA)).body.data.reconciliation;
    const grouping = data.checks.filter((check) => check.check.startsWith('grouping.'));

    expect(grouping.length).toBeGreaterThan(0);
    expect(grouping.every((check) => check.ok)).toBe(true);
    expect(data.checks.find((c) => c.check === 'rounding.display').ok).toBe(true);
  });

  it('checks the component identity on every source', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });

    const data = (await reconciliation(adminA)).body.data.reconciliation;
    const components = data.checks.filter((check) => check.check.startsWith('components.'));

    // Two checks per document type: the split adds up to the tax where there is
    // a split, and no split exists where there should not be one.
    expect(components).toHaveLength(8);
    expect(components.every((check) => check.ok)).toBe(true);
    expect(components.filter((check) => check.check.startsWith('components.unsplit.'))).toHaveLength(4);
  });

  it('checks that every invoice line is in exactly one GSTR-1 table', async () => {
    await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '200', unitCost: '100', taxId: ctx.rates[18] }],
    });
    await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });
    await postedSale(adminA, ctx, { customerId: ctx.b2cId });

    const data = (await reconciliation(adminA)).body.data.reconciliation;
    const byName = Object.fromEntries(data.checks.map((check) => [check.check, check]));

    expect(byName['gstr1.classification.invoices.tax'].ok).toBe(true);
    expect(byName['gstr1.classification.invoices.taxable'].ok).toBe(true);
    expect(byName['gstr1.classification.creditNotes'].ok).toBe(true);
  });

  it('DETECTS a mismatch instead of hiding it', async () => {
    const sale = await (async () => {
      await postedPurchase(adminA, ctx);
      return postedSale(adminA, ctx);
    })();

    // Corrupt one line's tax split directly in the database, behind the API's
    // back. The document header still says 360; its lines now say 350.
    await prisma.salesInvoiceItem.updateMany({
      where: { salesInvoiceId: sale.id },
      data: { cgstAmount: '170' },
    });

    const data = (await reconciliation(adminA)).body.data.reconciliation;

    expect(data.summary.isReconciled).toBe(false);
    expect(data.summary.failed).toBeGreaterThan(0);

    const failed = data.failedChecks.map((check) => check.check);
    // The document header no longer agrees with its own lines...
    expect(failed).toContain('source.SALES_INVOICE.cgst');
    // ...and the split no longer adds up to the tax it claims.
    expect(failed).toContain('components.SALES_INVOICE');

    const componentCheck = data.checks.find((c) => c.check === 'components.SALES_INVOICE');
    expect(componentCheck.difference).not.toBe('0.00');

    // The endpoint still answers - a reconciliation that refuses to report when
    // something is wrong is useless exactly when it is needed.
    expect(data.checks.length).toBeGreaterThan(20);
  });

  it('reports the aggregate pre-GST accounts separately from the comparison', async () => {
    await postedPurchase(adminA, ctx);

    const data = (await reconciliation(adminA)).body.data.reconciliation;

    expect(data.ledgerComparison.aggregateAccounts.balance).toBe('0.00');
    expect(data.ledgerComparison.aggregateAccounts.isZero).toBe(true);
    expect(data.ledgerComparison.aggregateAccounts.description).toMatch(/before GST was enabled/i);
  });
});

describe('decimal and rounding behaviour', () => {
  beforeEach(resetTransactions);

  it('keeps awkward decimals exact through every grouping', async () => {
    await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '100', unitCost: '100' }],
    });

    // 3 @ 333.335 = 1000.005 taxable at 18%.
    await postedSale(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '3', unitPrice: '333.335', taxId: ctx.rates[18] },
      ],
    });

    const one = (await gstr1(adminA)).body.data.gstr1;
    const recon = (await reconciliation(adminA)).body.data.reconciliation;

    expect(recon.summary.isReconciled).toBe(true);
    // The rate summary and the invoice totals agree to the paisa.
    expect(one.rateSummary.totals.totalTax).toBe(one.totals.invoices.totalTax);
    expect(one.hsnSummary.totals.totalTax).toBe(one.totals.invoices.totalTax);
  });

  it('keeps two documents with identical amounts separate', async () => {
    await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '200', unitCost: '100', taxId: ctx.rates[18] }],
    });
    await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });
    await postedSale(adminA, ctx, { customerId: ctx.b2bLocalId });

    const data = (await gstr1(adminA)).body.data.gstr1;

    expect(data.totals.invoiceCount).toBe(2);
    expect(data.b2b.parties[0].documentCount).toBe(2);
    expect(data.b2b.parties[0].documents).toHaveLength(2);
    expect(data.b2b.totals.totalTax).toBe('720.00');
  });
});

describe('documents with no place of supply are explicit, never guessed', () => {
  let plainCompany;
  let plainToken;
  let plainCtx;

  beforeEach(resetTransactions);

  beforeAll(async () => {
    // A company that never enabled GST. Its documents carry tax but no supply
    // type, so there is no lawful GSTR-1 table for them.
    plainCompany = await createCompanyWithUsers('retplain');
    plainToken = await login(app, plainCompany.admin.email, plainCompany.adminPassword);

    const post = (path, body) => request(app).post(path).set(auth(plainToken)).send(body);
    const category = await post('/api/v1/categories', { name: 'PlainCat' });
    const unit = await post('/api/v1/units', { name: 'PlainUnit', shortCode: 'PU' });
    const tax = await post('/api/v1/taxes', { name: 'PlainGST18', rate: '18' });
    const warehouse = await post('/api/v1/warehouses', { name: 'PlainWH', code: 'PWH' });
    const supplier = await post('/api/v1/suppliers', { name: 'PlainSup' });
    const customer = await post('/api/v1/customers', { name: 'PlainCust' });
    const product = await post('/api/v1/products', {
      name: 'PlainProd',
      sku: 'PLAIN-1',
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });

    plainCtx = {
      rates: { 18: tax.body.data.tax.id },
      warehouseId: warehouse.body.data.warehouse.id,
      supplierId: supplier.body.data.supplier.id,
      b2bLocalId: customer.body.data.customer.id,
      productA: product.body.data.product.id,
    };
  });

  it('lists them under unclassified with a reason, not in B2B or B2C', async () => {
    await postedPurchase(plainToken, plainCtx);
    const sale = await postedSale(plainToken, plainCtx);

    const data = (await gstr1(plainToken)).body.data.gstr1;

    expect(data.b2b.parties).toEqual([]);
    expect(data.b2c.documents).toEqual([]);
    expect(data.unclassified.reason).toBe('NO_PLACE_OF_SUPPLY');
    expect(data.unclassified.invoices).toHaveLength(1);
    expect(data.unclassified.invoices[0].documentNumber).toBe(sale.invoiceNumber);
    expect(data.unclassified.invoiceTotals.totalTax).toBe('360.00');
    expect(data.unclassified.description).toMatch(/cannot be placed/i);
  });

  it('excludes them from the GSTR-3B tables and reports them separately', async () => {
    await postedPurchase(plainToken, plainCtx);
    await postedSale(plainToken, plainCtx);

    const data = (await gstr3b(plainToken)).body.data.gstr3b;

    expect(data.outwardSupplies.taxableSupplies.totalTax).toBe('360.00');
    expect(data.unclassified.documentCount).toBe(2);
    expect(data.unclassified.reason).toBe('NO_PLACE_OF_SUPPLY');
  });

  it('still reconciles, because nothing was dropped', async () => {
    await postedPurchase(plainToken, plainCtx);
    await postedSale(plainToken, plainCtx);

    const data = (await reconciliation(plainToken)).body.data.reconciliation;

    expect(data.summary.isReconciled).toBe(true);
    // Pre-GST tax went to the aggregate accounts, which is reported rather than
    // compared against the component accounts.
    expect(data.ledgerComparison.aggregateAccounts.isZero).toBe(false);
  });
});

describe('RBAC and tenant isolation', () => {
  beforeEach(resetTransactions);

  it('lets STAFF read every return dataset', async () => {
    for (const path of [
      `/api/v1/tax/returns/gstr-1${PERIOD}`,
      `/api/v1/tax/returns/gstr-3b${PERIOD}`,
      `/api/v1/tax/returns/reconciliation${PERIOD}`,
    ]) {
      const response = await request(app).get(path).set(auth(staffA));
      expect(`${path}:${response.status}`).toBe(`${path}:200`);
    }
  });

  it('requires authentication', async () => {
    for (const path of [
      `/api/v1/tax/returns/gstr-1${PERIOD}`,
      `/api/v1/tax/returns/gstr-3b${PERIOD}`,
      `/api/v1/tax/returns/reconciliation${PERIOD}`,
    ]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('exposes no way to mutate a return dataset', async () => {
    const post = await request(app)
      .post(`/api/v1/tax/returns/gstr-1`)
      .set(auth(adminA))
      .send({});
    const patch = await request(app)
      .patch(`/api/v1/tax/returns/gstr-1`)
      .set(auth(adminA))
      .send({});
    const remove = await request(app)
      .delete(`/api/v1/tax/returns/gstr-1`)
      .set(auth(adminA));

    expect(post.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  it("never includes another company's documents", async () => {
    await postedPurchase(adminA, ctx);
    const saleA = await postedSale(adminA, ctx);

    await postedPurchase(adminB, ctxB, { supplierId: ctxB.supplierId });
    await postedSale(adminB, ctxB, { customerId: ctxB.b2bLocalId });

    const dataA = (await gstr1(adminA)).body.data.gstr1;
    const dataB = (await gstr1(adminB)).body.data.gstr1;

    // Document numbers are unique per company, so both tenants have an
    // INV-2026-000001. Isolation is asserted on the id, which is global.
    const idsB = dataB.b2b.parties.flatMap((p) => p.documents.map((d) => d.documentId));
    expect(idsB).not.toContain(saleA.id);
    expect(idsB).toHaveLength(1);

    expect(dataA.totals.invoiceCount).toBe(1);
    expect(dataB.totals.invoiceCount).toBe(1);
  });

  it('keeps each company GSTR-3B and reconciliation independent', async () => {
    await postedPurchase(adminA, ctx);

    const a = (await gstr3b(adminA)).body.data.gstr3b;
    const b = (await gstr3b(adminB)).body.data.gstr3b;

    expect(a.inputTaxCredit.allOtherItc.totalTax).toBe('1800.00');
    expect(b.inputTaxCredit.allOtherItc.totalTax).toBe('0.00');

    expect((await reconciliation(adminA)).body.data.reconciliation.summary.isReconciled).toBe(true);
    expect((await reconciliation(adminB)).body.data.reconciliation.summary.isReconciled).toBe(true);
  });

  it('classifies the same counterparty differently for each company, correctly', async () => {
    // Company A is in 27 and company B in 29. A supply between the same two
    // states is intra-state for one and inter-state for the other.
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx, { customerId: ctx.b2bRemoteId });

    await postedPurchase(adminB, ctxB, { supplierId: ctxB.supplierId });
    await postedSale(adminB, ctxB, { customerId: ctxB.b2bLocalId });

    const a = (await gstr1(adminA)).body.data.gstr1;
    const b = (await gstr1(adminB)).body.data.gstr1;

    expect(a.totals.invoices.igst).toBe('360.00');
    expect(b.totals.invoices.cgst).toBe('180.00');
  });
});
