import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// GST on real documents, end to end through HTTP: purchases, sales, both kinds
// of return, the journal entries they produce, and the summaries derived from
// them.
//
// The company is registered in Maharashtra (27). Its counterparties are one in
// the same state (intra-state -> CGST + SGST) and one in Karnataka (29)
// (inter-state -> IGST). Every expected figure is small enough to check by hand:
//
//   purchase 100 @ 100 + 18%  -> taxable 10000, tax 1800, payable 11800
//   sale      10 @ 200 + 18%  -> taxable  2000, tax  360, receivable 2360

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const HOME_STATE = '27';
const OTHER_STATE = '29';
const COMPANY_GSTIN = '27AAPFU0939F1ZV';

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let ctx;
let ctxB;

async function configureGst(token, { stateCode = HOME_STATE, gstin = null } = {}) {
  const response = await request(app)
    .patch('/api/v1/tax/profile')
    .set(auth(token))
    .send({ stateCode, ...(gstin ? { gstin, registrationType: 'REGULAR' } : {}) });
  expect(response.status).toBe(200);
  return response.body.data.gstProfile;
}

async function prepare(token, suffix, { warehouseState = HOME_STATE } = {}) {
  const post = (path, body) => request(app).post(path).set(auth(token)).send(body);

  const category = await post('/api/v1/categories', { name: `GstCat ${suffix}` });
  const unit = await post('/api/v1/units', { name: `GstUnit ${suffix}`, shortCode: `GU${suffix}` });

  const rates = {};
  for (const rate of [5, 12, 18, 28]) {
    const created = await post('/api/v1/taxes', { name: `GstTax${rate} ${suffix}`, rate: String(rate) });
    expect(created.status).toBe(201);
    rates[rate] = created.body.data.tax.id;
  }

  const exempt = await post('/api/v1/taxes', {
    name: `GstExempt ${suffix}`,
    rate: '0',
    treatment: 'EXEMPT',
  });
  const nilRated = await post('/api/v1/taxes', {
    name: `GstNil ${suffix}`,
    rate: '0',
    treatment: 'NIL_RATED',
  });

  const hsn = await post('/api/v1/tax/classifications', {
    code: `3004${suffix === 'A' ? '9011' : '9012'}`,
    kind: 'HSN',
    description: 'Medicaments',
  });
  expect(hsn.status).toBe(201);

  const makeProduct = async (n) => {
    const response = await post('/api/v1/products', {
      name: `GstProd${n} ${suffix}`,
      sku: `GST-${suffix}-${n}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
      taxClassificationId: hsn.body.data.classification.id,
    });
    expect(response.status).toBe(201);
    return response.body.data.product.id;
  };

  const warehouse = await post('/api/v1/warehouses', {
    name: `GstWH ${suffix}`,
    code: `GW${suffix}`,
    stateCode: warehouseState,
  });

  const localSupplier = await post('/api/v1/suppliers', {
    name: `GstSupLocal ${suffix}`,
    stateCode: HOME_STATE,
    gstRegistrationType: 'REGULAR',
  });
  const remoteSupplier = await post('/api/v1/suppliers', {
    name: `GstSupRemote ${suffix}`,
    stateCode: OTHER_STATE,
    gstRegistrationType: 'REGULAR',
  });
  const statelessSupplier = await post('/api/v1/suppliers', { name: `GstSupNoState ${suffix}` });

  const localCustomer = await post('/api/v1/customers', {
    name: `GstCustLocal ${suffix}`,
    stateCode: HOME_STATE,
    gstRegistrationType: 'REGULAR',
  });
  const remoteCustomer = await post('/api/v1/customers', {
    name: `GstCustRemote ${suffix}`,
    stateCode: OTHER_STATE,
    gstRegistrationType: 'REGULAR',
  });
  const statelessCustomer = await post('/api/v1/customers', { name: `GstCustNoState ${suffix}` });

  return {
    productA: await makeProduct('A'),
    productB: await makeProduct('B'),
    productC: await makeProduct('C'),
    rates,
    exemptTaxId: exempt.body.data.tax.id,
    nilRatedTaxId: nilRated.body.data.tax.id,
    hsnCode: hsn.body.data.classification.code,
    hsnId: hsn.body.data.classification.id,
    warehouseId: warehouse.body.data.warehouse.id,
    localSupplierId: localSupplier.body.data.supplier.id,
    remoteSupplierId: remoteSupplier.body.data.supplier.id,
    statelessSupplierId: statelessSupplier.body.data.supplier.id,
    localCustomerId: localCustomer.body.data.customer.id,
    remoteCustomerId: remoteCustomer.body.data.customer.id,
    statelessCustomerId: statelessCustomer.body.data.customer.id,
  };
}

// --- document helpers ------------------------------------------------------

let billCounter = 0;

function draftPurchaseBody(context, { supplierId, items, invoiceDate = '2026-08-01' } = {}) {
  return {
    supplierId: supplierId ?? context.localSupplierId,
    warehouseId: context.warehouseId,
    invoiceNumber: `GSTB-${(billCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`,
    invoiceDate,
    items: items ?? [
      { productId: context.productA, quantity: '100', unitCost: '100', taxId: context.rates[18] },
    ],
  };
}

const createPurchase = (token, body) =>
  request(app).post('/api/v1/purchases').set(auth(token)).send(body);

async function postedPurchase(token, context, options) {
  const draft = await createPurchase(token, draftPurchaseBody(context, options));
  expect(draft.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

function draftSaleBody(context, { customerId, items, invoiceDate = '2026-09-01', ...rest } = {}) {
  return {
    customerId: customerId ?? context.localCustomerId,
    warehouseId: context.warehouseId,
    invoiceDate,
    items: items ?? [
      { productId: context.productA, quantity: '10', unitPrice: '200', taxId: context.rates[18] },
    ],
    ...rest,
  };
}

const createSale = (token, body) => request(app).post('/api/v1/sales').set(auth(token)).send(body);

async function postedSale(token, context, options) {
  const draft = await createSale(token, draftSaleBody(context, options));
  expect(draft.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/sales/${draft.body.data.sale.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

async function postedSalesReturn(token, sale, items, returnDate = '2026-09-10') {
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

async function postedPurchaseReturn(token, purchase, items, returnDate = '2026-08-15') {
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

// --- accounting helpers ----------------------------------------------------

async function journalFor(token, sourceType, sourceId) {
  const response = await request(app)
    .get(`/api/v1/journal-entries/source/${sourceType}/${sourceId}`)
    .set(auth(token));
  return { status: response.status, entry: response.body.data?.journalEntry };
}

function postedTo(entry, code, side) {
  const line = entry.lines.find((row) => row.account.code === code);
  return line ? line[side] : null;
}

async function balanceOf(token, code) {
  const accounts = await request(app).get('/api/v1/accounts?limit=100').set(auth(token));
  const account = accounts.body.data.find((row) => row.code === code);
  const detail = await request(app).get(`/api/v1/accounts/${account.id}`).set(auth(token));
  return detail.body.data.account.balance;
}

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
  await prisma.account.updateMany({ data: { isActive: true } });
}

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('gstdocalpha');
  companyB = await createCompanyWithUsers('gstdocbeta');

  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  staffA = await login(app, companyA.staff.email, companyA.staffPassword);
  adminB = await login(app, companyB.admin.email, companyB.adminPassword);

  await configureGst(adminA, { gstin: COMPANY_GSTIN });
  await configureGst(adminB, { stateCode: OTHER_STATE });

  ctx = await prepare(adminA, 'A');
  ctxB = await prepare(adminB, 'B', { warehouseState: OTHER_STATE });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('intra-state purchase', () => {
  beforeEach(resetTransactions);

  it('splits the tax into CGST and SGST', async () => {
    const purchase = await postedPurchase(adminA, ctx);

    expect(purchase.gst.supplyType).toBe('INTRA_STATE');
    expect(purchase.gst.sellerStateCode).toBe(HOME_STATE);
    expect(purchase.gst.buyerStateCode).toBe(HOME_STATE);
    expect(purchase.gst.placeOfSupplyStateCode).toBe(HOME_STATE);
    expect(purchase.taxBreakup.cgst).toBe('900.00');
    expect(purchase.taxBreakup.sgst).toBe('900.00');
    expect(purchase.taxBreakup.igst).toBe('0.00');
    expect(purchase.taxTotal).toBe('1800.00');
    expect(purchase.grandTotal).toBe('11800.00');
  });

  it('freezes the split and the HSN onto the line', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    const line = purchase.items[0];

    expect(line.hsn).toBe(ctx.hsnCode);
    expect(line.cgstRate).toBe('9.00');
    expect(line.sgstRate).toBe('9.00');
    expect(line.igstRate).toBe('0.00');
    expect(line.cgstAmount).toBe('900.00');
    expect(line.sgstAmount).toBe('900.00');
    expect(line.taxTreatment).toBe('TAXABLE');
  });

  it('debits Input CGST and Input SGST in the journal', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1300', 'debit')).toBe('10000.00');
    expect(postedTo(entry, '1510', 'debit')).toBe('900.00');
    expect(postedTo(entry, '1520', 'debit')).toBe('900.00');
    expect(postedTo(entry, '1530', 'debit')).toBeNull();
    expect(postedTo(entry, '2000', 'credit')).toBe('11800.00');
  });

  it('does not capitalise recoverable input tax into inventory', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    // Inventory carries the goods only. The tax is a separate, recoverable asset.
    expect(postedTo(entry, '1300', 'debit')).toBe('10000.00');
    expect(Number(await balanceOf(adminA, '1300'))).toBe(10000);
  });
});

describe('inter-state purchase', () => {
  beforeEach(resetTransactions);

  it('charges IGST only', async () => {
    const purchase = await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });

    expect(purchase.gst.supplyType).toBe('INTER_STATE');
    expect(purchase.gst.sellerStateCode).toBe(OTHER_STATE);
    expect(purchase.taxBreakup.igst).toBe('1800.00');
    expect(purchase.taxBreakup.cgst).toBe('0.00');
    expect(purchase.taxBreakup.sgst).toBe('0.00');
    expect(purchase.grandTotal).toBe('11800.00');
  });

  it('debits Input IGST in the journal', async () => {
    const purchase = await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1530', 'debit')).toBe('1800.00');
    expect(postedTo(entry, '1510', 'debit')).toBeNull();
    expect(postedTo(entry, '1520', 'debit')).toBeNull();
  });

  it('costs the same either way - only the split differs', async () => {
    const intra = await postedPurchase(adminA, ctx);
    const inter = await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });

    expect(intra.grandTotal).toBe(inter.grandTotal);
    expect(intra.taxTotal).toBe(inter.taxTotal);
  });
});

describe('intra-state sale', () => {
  beforeEach(resetTransactions);

  it('charges CGST and SGST and credits the output accounts', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);

    expect(sale.gst.supplyType).toBe('INTRA_STATE');
    expect(sale.gst.sellerGstin).toBe(COMPANY_GSTIN);
    expect(sale.taxBreakup.cgst).toBe('180.00');
    expect(sale.taxBreakup.sgst).toBe('180.00');
    expect(sale.grandTotal).toBe('2360.00');

    const { entry } = await journalFor(adminA, 'SALES_INVOICE', sale.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1200', 'debit')).toBe('2360.00');
    expect(postedTo(entry, '4000', 'credit')).toBe('2000.00');
    expect(postedTo(entry, '2110', 'credit')).toBe('180.00');
    expect(postedTo(entry, '2120', 'credit')).toBe('180.00');
    expect(postedTo(entry, '2130', 'credit')).toBeNull();
  });

  it('leaves COGS and inventory exactly as they were before GST', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    const { entry } = await journalFor(adminA, 'SALES_INVOICE', sale.id);

    // Stock cost 100 each; 10 sold.
    expect(sale.cogsTotal).toBe('1000.00');
    expect(postedTo(entry, '5000', 'debit')).toBe('1000.00');
    expect(postedTo(entry, '1300', 'credit')).toBe('1000.00');
  });
});

describe('inter-state sale', () => {
  beforeEach(resetTransactions);

  it('charges IGST and credits Output IGST', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { customerId: ctx.remoteCustomerId });

    expect(sale.gst.supplyType).toBe('INTER_STATE');
    expect(sale.gst.placeOfSupplyStateCode).toBe(OTHER_STATE);
    expect(sale.taxBreakup.igst).toBe('360.00');

    const { entry } = await journalFor(adminA, 'SALES_INVOICE', sale.id);
    expect(postedTo(entry, '2130', 'credit')).toBe('360.00');
    expect(postedTo(entry, '2110', 'credit')).toBeNull();
  });

  it('honours an explicit place of supply over the customer state', async () => {
    await postedPurchase(adminA, ctx);

    // Billed to a local customer, but supplied into another state.
    const sale = await postedSale(adminA, ctx, {
      customerId: ctx.localCustomerId,
      placeOfSupplyStateCode: OTHER_STATE,
    });

    expect(sale.gst.supplyType).toBe('INTER_STATE');
    expect(sale.gst.placeOfSupplyStateCode).toBe(OTHER_STATE);
    expect(sale.taxBreakup.igst).toBe('360.00');
  });
});

describe('missing state information is refused, never guessed', () => {
  beforeEach(resetTransactions);

  it('refuses a purchase from a supplier with no state', async () => {
    const response = await createPurchase(
      adminA,
      draftPurchaseBody(ctx, { supplierId: ctx.statelessSupplierId }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('GST_STATE_REQUIRED');
  });

  it('refuses a sale to a customer with no state', async () => {
    const response = await createSale(
      adminA,
      draftSaleBody(ctx, { customerId: ctx.statelessCustomerId }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('GST_STATE_REQUIRED');
  });

  it('accepts a stateless customer once a place of supply is given', async () => {
    await postedPurchase(adminA, ctx);

    const sale = await postedSale(adminA, ctx, {
      customerId: ctx.statelessCustomerId,
      placeOfSupplyStateCode: HOME_STATE,
    });

    expect(sale.gst.supplyType).toBe('INTRA_STATE');
  });

  it('writes nothing when it refuses', async () => {
    await createPurchase(adminA, draftPurchaseBody(ctx, { supplierId: ctx.statelessSupplierId }));
    expect(await prisma.purchase.count()).toBe(0);
  });
});

describe('multi-rate documents', () => {
  beforeEach(resetTransactions);

  it('taxes each line at its own rate and totals them exactly', async () => {
    // 5% on 1000, 12% on 1000, 18% on 1000.
    const purchase = await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '10', unitCost: '100', taxId: ctx.rates[12] },
        { productId: ctx.productC, quantity: '10', unitCost: '100', taxId: ctx.rates[18] },
      ],
    });

    expect(purchase.items[0].taxAmount).toBe('50.00');
    expect(purchase.items[1].taxAmount).toBe('120.00');
    expect(purchase.items[2].taxAmount).toBe('180.00');

    expect(purchase.taxTotal).toBe('350.00');
    expect(purchase.taxBreakup.cgst).toBe('175.00');
    expect(purchase.taxBreakup.sgst).toBe('175.00');
    expect(purchase.grandTotal).toBe('3350.00');

    // The document total is exactly the sum of the posted line values.
    const lineTax = purchase.items.reduce((sum, item) => sum + Number(item.taxAmount), 0);
    expect(lineTax).toBe(Number(purchase.taxTotal));

    const lineCgst = purchase.items.reduce((sum, item) => sum + Number(item.cgstAmount), 0);
    expect(lineCgst).toBe(Number(purchase.taxBreakup.cgst));
  });

  it('posts one journal covering every rate on the document', async () => {
    const purchase = await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '10', unitCost: '100', taxId: ctx.rates[28] },
      ],
    });

    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);
    expect(entry.isBalanced).toBe(true);
    // (50 + 280) / 2 on each half.
    expect(postedTo(entry, '1510', 'debit')).toBe('165.00');
    expect(postedTo(entry, '1520', 'debit')).toBe('165.00');
  });

  it('handles a mixed-rate inter-state sale', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '100', unitCost: '100' },
        { productId: ctx.productB, quantity: '100', unitCost: '100' },
      ],
    });

    const sale = await postedSale(adminA, ctx, {
      customerId: ctx.remoteCustomerId,
      items: [
        { productId: ctx.productA, quantity: '10', unitPrice: '200', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '10', unitPrice: '200', taxId: ctx.rates[18] },
      ],
    });

    expect(sale.taxBreakup.igst).toBe('460.00');
    expect(sale.taxBreakup.cgst).toBe('0.00');
    expect(sale.taxTotal).toBe('460.00');
  });
});

describe('exempt, nil-rated and zero-rated supplies', () => {
  beforeEach(resetTransactions);

  it('charges nothing on an exempt line and records why', async () => {
    const purchase = await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.exemptTaxId },
      ],
    });

    expect(purchase.taxTotal).toBe('0.00');
    expect(purchase.grandTotal).toBe('1000.00');
    // The treatment is recorded, not inferred from the zero.
    expect(purchase.items[0].taxTreatment).toBe('EXEMPT');
  });

  it('distinguishes nil-rated from exempt on the line', async () => {
    const purchase = await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.exemptTaxId },
        { productId: ctx.productB, quantity: '10', unitCost: '100', taxId: ctx.nilRatedTaxId },
      ],
    });

    expect(purchase.items[0].taxTreatment).toBe('EXEMPT');
    expect(purchase.items[1].taxTreatment).toBe('NIL_RATED');
    expect(purchase.taxTotal).toBe('0.00');
  });

  it('does not treat an untaxed line as exempt', async () => {
    // No tax was chosen at all. That is not the same as an exempt supply, and
    // the line says so by recording no treatment rather than guessing one.
    const purchase = await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '10', unitCost: '100' }],
    });

    expect(purchase.items[0].taxTreatment).toBeNull();
    expect(purchase.taxTotal).toBe('0.00');
  });

  it('posts no tax lines to the journal for an exempt purchase', async () => {
    const purchase = await postedPurchase(adminA, ctx, {
      items: [{ productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.exemptTaxId }],
    });

    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1510', 'debit')).toBeNull();
    expect(postedTo(entry, '1530', 'debit')).toBeNull();
    expect(entry.lines).toHaveLength(2);
  });
});

describe('purchase return reverses the input tax', () => {
  beforeEach(resetTransactions);

  it('gives back CGST and SGST at the original rates', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    const returned = await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    // 10 of 100 units: 1000 of cost, 180 of tax.
    expect(returned.taxableTotal).toBe('1000.00');
    expect(returned.taxBreakup.cgst).toBe('90.00');
    expect(returned.taxBreakup.sgst).toBe('90.00');
    expect(returned.taxTotal).toBe('180.00');
    expect(returned.grandTotal).toBe('1180.00');

    const { entry } = await journalFor(adminA, 'PURCHASE_RETURN', returned.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '2000', 'debit')).toBe('1180.00');
    expect(postedTo(entry, '1300', 'credit')).toBe('1000.00');
    expect(postedTo(entry, '1510', 'credit')).toBe('90.00');
    expect(postedTo(entry, '1520', 'credit')).toBe('90.00');
  });

  it('gives back IGST on an inter-state bill', async () => {
    const purchase = await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });
    const returned = await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    expect(returned.taxBreakup.igst).toBe('180.00');
    expect(returned.taxBreakup.cgst).toBe('0.00');

    const { entry } = await journalFor(adminA, 'PURCHASE_RETURN', returned.id);
    expect(postedTo(entry, '1530', 'credit')).toBe('180.00');
    expect(postedTo(entry, '1510', 'credit')).toBeNull();
  });

  it('credits the supplier for the tax as well as the goods', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);

    // 11800 owed, 1180 credited back.
    expect(payable.creditAmount).toBe('1180.00');
    expect(payable.outstandingAmount).toBe('10620.00');
  });

  it('uses the ORIGINAL rate even after the tax master changes', async () => {
    const purchase = await postedPurchase(adminA, ctx);

    // The rate is revised after the bill was entered.
    const updated = await request(app)
      .patch(`/api/v1/taxes/${ctx.rates[18]}`)
      .set(auth(adminA))
      .send({ rate: '28' });
    expect(updated.status).toBe(200);

    const returned = await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    // Still 18%, from the frozen snapshot - not today's 28%.
    expect(returned.taxTotal).toBe('180.00');
    expect(returned.items[0].taxRate).toBe('18.00');

    // Put it back for the tests that follow.
    await request(app)
      .patch(`/api/v1/taxes/${ctx.rates[18]}`)
      .set(auth(adminA))
      .send({ rate: '18' });
  });
});

describe('sales return reverses the output tax', () => {
  beforeEach(resetTransactions);

  it('debits Output CGST and SGST back', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    const returned = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    // 4 of 10 at 200 = 800 taxable, 144 tax.
    expect(returned.taxBreakup.cgst).toBe('72.00');
    expect(returned.taxBreakup.sgst).toBe('72.00');
    expect(returned.taxTotal).toBe('144.00');
    expect(returned.grandTotal).toBe('944.00');

    const { entry } = await journalFor(adminA, 'SALES_RETURN', returned.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '4100', 'debit')).toBe('800.00');
    expect(postedTo(entry, '2110', 'debit')).toBe('72.00');
    expect(postedTo(entry, '2120', 'debit')).toBe('72.00');
    expect(postedTo(entry, '1200', 'credit')).toBe('944.00');
  });

  it('debits Output IGST back on an inter-state credit note', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { customerId: ctx.remoteCustomerId });
    const returned = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    expect(returned.gst.supplyType).toBe('INTER_STATE');
    expect(returned.taxBreakup.igst).toBe('144.00');

    const { entry } = await journalFor(adminA, 'SALES_RETURN', returned.id);
    expect(postedTo(entry, '2130', 'debit')).toBe('144.00');
    expect(postedTo(entry, '2110', 'debit')).toBeNull();
  });

  it('leaves the COGS reversal exactly as it was before GST', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    const returned = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const { entry } = await journalFor(adminA, 'SALES_RETURN', returned.id);
    expect(returned.cogsTotal).toBe('400.00');
    expect(postedTo(entry, '1300', 'debit')).toBe('400.00');
    expect(postedTo(entry, '5000', 'credit')).toBe('400.00');
  });

  it('carries the invoice GST context onto the credit note', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx, { customerId: ctx.remoteCustomerId });
    const returned = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '2' },
    ]);

    expect(returned.gst.sellerGstin).toBe(sale.gst.sellerGstin);
    expect(returned.gst.placeOfSupplyStateCode).toBe(sale.gst.placeOfSupplyStateCode);
    expect(returned.items[0].hsn).toBe(sale.items[0].hsn);
  });
});

describe('historical tax survives master-data changes', () => {
  beforeEach(resetTransactions);

  it('does not change a posted invoice when the rate changes', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);

    await request(app).patch(`/api/v1/taxes/${ctx.rates[18]}`).set(auth(adminA)).send({ rate: '28' });

    const after = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(adminA));

    expect(after.body.data.sale.taxTotal).toBe('360.00');
    expect(after.body.data.sale.taxBreakup.cgst).toBe('180.00');
    expect(after.body.data.sale.items[0].cgstRate).toBe('9.00');

    await request(app).patch(`/api/v1/taxes/${ctx.rates[18]}`).set(auth(adminA)).send({ rate: '18' });
  });

  it('does not change a posted invoice when the customer moves state', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);
    expect(sale.gst.supplyType).toBe('INTRA_STATE');

    await request(app)
      .patch(`/api/v1/customers/${ctx.localCustomerId}`)
      .set(auth(adminA))
      .send({ stateCode: OTHER_STATE });

    const after = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(adminA));
    expect(after.body.data.sale.gst.supplyType).toBe('INTRA_STATE');
    expect(after.body.data.sale.taxBreakup.cgst).toBe('180.00');
    expect(after.body.data.sale.taxBreakup.igst).toBe('0.00');

    await request(app)
      .patch(`/api/v1/customers/${ctx.localCustomerId}`)
      .set(auth(adminA))
      .send({ stateCode: HOME_STATE });
  });

  it('does not change a posted invoice when the HSN is retired', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);

    await request(app)
      .patch(`/api/v1/tax/classifications/${ctx.hsnId}`)
      .set(auth(adminA))
      .send({ isActive: false });

    const after = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(adminA));
    expect(after.body.data.sale.items[0].hsn).toBe(ctx.hsnCode);

    // But a NEW document may not use it.
    const blocked = await createSale(adminA, draftSaleBody(ctx));
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('TAX_CLASSIFICATION_INACTIVE');

    await request(app)
      .patch(`/api/v1/tax/classifications/${ctx.hsnId}`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('posted tax is immutable', () => {
  beforeEach(resetTransactions);

  it('refuses to edit a posted purchase at all', async () => {
    const purchase = await postedPurchase(adminA, ctx);

    const response = await request(app)
      .patch(`/api/v1/purchases/${purchase.id}`)
      .set(auth(adminA))
      .send(draftPurchaseBody(ctx));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PURCHASE_ALREADY_POSTED');
  });

  it('refuses to edit a posted sale, including its place of supply', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);

    const response = await request(app)
      .patch(`/api/v1/sales/${sale.id}`)
      .set(auth(adminA))
      .send(draftSaleBody(ctx, { placeOfSupplyStateCode: OTHER_STATE }));

    expect(response.status).toBe(409);

    const after = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(adminA));
    expect(after.body.data.sale.gst.placeOfSupplyStateCode).toBe(HOME_STATE);
  });

  it('ignores a client-supplied tax amount entirely', async () => {
    // The server computes tax from the rates and the two states. Anything the
    // client sends about tax is dropped by validation before a service sees it.
    const draft = await createPurchase(adminA, {
      ...draftPurchaseBody(ctx),
      taxTotal: '99999',
      cgstTotal: '99999',
      grandTotal: '1',
      supplyType: 'INTER_STATE',
    });

    expect(draft.status).toBe(201);
    expect(draft.body.data.purchase.taxTotal).toBe('1800.00');
    expect(draft.body.data.purchase.grandTotal).toBe('11800.00');
    expect(draft.body.data.purchase.gst.supplyType).toBe('INTRA_STATE');
  });

  it('ignores a client-supplied line tax split', async () => {
    const draft = await createPurchase(adminA, {
      ...draftPurchaseBody(ctx, {
        items: [
          {
            productId: ctx.productA,
            quantity: '100',
            unitCost: '100',
            taxId: ctx.rates[18],
            cgstAmount: '5',
            igstAmount: '5',
          },
        ],
      }),
    });

    expect(draft.status).toBe(201);
    expect(draft.body.data.purchase.items[0].cgstAmount).toBe('900.00');
    expect(draft.body.data.purchase.items[0].igstAmount).toBe('0.00');
  });
});

describe('GST accounting reconciliation', () => {
  beforeEach(resetTransactions);

  it('matches the input tax summary to the input GL accounts', async () => {
    await postedPurchase(adminA, ctx);
    await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });

    const summary = await request(app).get('/api/v1/tax/gst-summary').set(auth(adminA));
    const input = summary.body.data.gstSummary.inputTax;

    expect(input.cgst).toBe('900.00');
    expect(input.sgst).toBe('900.00');
    expect(input.igst).toBe('1800.00');

    expect(await balanceOf(adminA, '1510')).toBe('900.00');
    expect(await balanceOf(adminA, '1520')).toBe('900.00');
    expect(await balanceOf(adminA, '1530')).toBe('1800.00');
  });

  it('matches the output tax summary to the output GL accounts', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);
    await postedSale(adminA, ctx, { customerId: ctx.remoteCustomerId });

    const summary = await request(app).get('/api/v1/tax/gst-summary').set(auth(adminA));
    const output = summary.body.data.gstSummary.outputTax;

    expect(output.cgst).toBe('180.00');
    expect(output.sgst).toBe('180.00');
    expect(output.igst).toBe('360.00');

    expect(await balanceOf(adminA, '2110')).toBe('180.00');
    expect(await balanceOf(adminA, '2120')).toBe('180.00');
    expect(await balanceOf(adminA, '2130')).toBe('360.00');
  });

  it('nets output against input and says which way it points', async () => {
    await postedPurchase(adminA, ctx);
    await postedSale(adminA, ctx);

    const summary = (await request(app).get('/api/v1/tax/gst-summary').set(auth(adminA))).body.data
      .gstSummary;

    // Output 360, input 1800: more credit than liability.
    expect(summary.net.netTax).toBe('-1440.00');
    expect(summary.net.position).toBe('CREDIT');
    expect(summary.note).toMatch(/not a filed GST return/i);
  });

  it('subtracts returns from both sides', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);
    const sale = await postedSale(adminA, ctx);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const summary = (await request(app).get('/api/v1/tax/gst-summary').set(auth(adminA))).body.data
      .gstSummary;

    // Input 1800 - 180. Output 360 - 144.
    expect(summary.inputTax.totalTax).toBe('1620.00');
    expect(summary.outputTax.totalTax).toBe('216.00');

    // And the ledger agrees, because the same transaction wrote both.
    expect(Number(await balanceOf(adminA, '1510'))).toBe(Number(summary.inputTax.cgst));
    expect(Number(await balanceOf(adminA, '2110'))).toBe(Number(summary.outputTax.cgst));
  });

  it('reports the GST control accounts alongside the summary', async () => {
    await postedPurchase(adminA, ctx);

    const summary = (await request(app).get('/api/v1/tax/gst-summary').set(auth(adminA))).body.data
      .gstSummary;
    const byCode = Object.fromEntries(
      summary.ledgerReconciliation.map((row) => [row.code, row]),
    );

    expect(byCode['1510'].balance).toBe('900.00');
    expect(byCode['2130'].balance).toBe('0.00');
  });

  it('keeps the trial balance and balance sheet balanced', async () => {
    await postedPurchase(adminA, ctx, { supplierId: ctx.remoteSupplierId });
    const sale = await postedSale(adminA, ctx);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '3' },
    ]);

    const tb = await request(app).get('/api/v1/accounting/trial-balance').set(auth(adminA));
    const bs = await request(app).get('/api/v1/accounting/balance-sheet').set(auth(adminA));

    expect(tb.body.data.trialBalance.isBalanced).toBe(true);
    expect(bs.body.data.balanceSheet.isBalanced).toBe(true);
  });
});

describe('GST summaries and traceability', () => {
  beforeEach(resetTransactions);

  it('breaks the input tax down by rate', async () => {
    await postedPurchase(adminA, ctx, {
      items: [
        { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctx.rates[5] },
        { productId: ctx.productB, quantity: '10', unitCost: '100', taxId: ctx.rates[18] },
      ],
    });

    const response = await request(app).get('/api/v1/tax/input-tax').set(auth(adminA));
    const byRate = Object.fromEntries(
      response.body.data.inputTax.byRate.map((row) => [row.taxRate, row]),
    );

    expect(byRate['5.00'].taxableAmount).toBe('1000.00');
    expect(byRate['5.00'].totalTax).toBe('50.00');
    expect(byRate['18.00'].totalTax).toBe('180.00');
  });

  it('lists the purchase lines behind the figures', async () => {
    const purchase = await postedPurchase(adminA, ctx);

    const response = await request(app)
      .get('/api/v1/tax/gst-purchases?limit=100')
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const line = response.body.data.gstPurchases.lines[0];
    expect(line.documentNumber).toBe(purchase.purchaseNumber);
    expect(line.hsn).toBe(ctx.hsnCode);
    expect(line.supplyType).toBe('INTRA_STATE');
    expect(line.cgst).toBe('900.00');
    expect(line.taxableAmount).toBe('10000.00');
  });

  it('lists the sales lines with both GSTINs', async () => {
    await postedPurchase(adminA, ctx);
    const sale = await postedSale(adminA, ctx);

    const response = await request(app).get('/api/v1/tax/gst-sales?limit=100').set(auth(adminA));
    const line = response.body.data.gstSales.lines[0];

    expect(line.documentNumber).toBe(sale.invoiceNumber);
    expect(line.sellerGstin).toBe(COMPANY_GSTIN);
    expect(line.placeOfSupply).toBe(HOME_STATE);
    expect(line.placeOfSupplyName).toBe('Maharashtra');
  });

  it('summarises by HSN', async () => {
    await postedPurchase(adminA, ctx);

    const response = await request(app)
      .get('/api/v1/tax/hsn-summary/PURCHASE')
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const row = response.body.data.hsnSummary.rows.find((entry) => entry.hsn === ctx.hsnCode);
    expect(row.taxableAmount).toBe('10000.00');
    expect(row.totalTax).toBe('1800.00');
  });

  it('filters by date, rate, supply type and HSN', async () => {
    await postedPurchase(adminA, ctx, { invoiceDate: '2026-08-01' });
    await postedPurchase(adminA, ctx, {
      supplierId: ctx.remoteSupplierId,
      invoiceDate: '2026-09-01',
    });

    const august = await request(app)
      .get('/api/v1/tax/input-tax?dateFrom=2026-08-01&dateTo=2026-08-31')
      .set(auth(adminA));
    expect(august.body.data.inputTax.cgst).toBe('900.00');
    expect(august.body.data.inputTax.igst).toBe('0.00');

    const interState = await request(app)
      .get('/api/v1/tax/gst-purchases?supplyType=INTER_STATE&limit=100')
      .set(auth(adminA));
    expect(
      interState.body.data.gstPurchases.lines.every((line) => line.supplyType === 'INTER_STATE'),
    ).toBe(true);

    const byRate = await request(app)
      .get('/api/v1/tax/gst-purchases?rate=18&limit=100')
      .set(auth(adminA));
    expect(byRate.body.data.gstPurchases.lines.every((line) => line.taxRate === '18.00')).toBe(true);

    const byHsn = await request(app)
      .get(`/api/v1/tax/gst-purchases?hsn=${ctx.hsnCode}&limit=100`)
      .set(auth(adminA));
    expect(byHsn.body.data.gstPurchases.lines.length).toBeGreaterThan(0);

    const noMatch = await request(app)
      .get('/api/v1/tax/gst-purchases?hsn=99999999&limit=100')
      .set(auth(adminA));
    expect(noMatch.body.data.gstPurchases.lines).toHaveLength(0);
  });

  it('covers both return types through the generic lines endpoint', async () => {
    const purchase = await postedPurchase(adminA, ctx);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    const response = await request(app)
      .get('/api/v1/tax/lines/PURCHASE_RETURN?limit=100')
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.gstLines.direction).toBe('INPUT');
    expect(response.body.data.gstLines.lines[0].cgst).toBe('90.00');
  });

  it('rejects an unknown document type', async () => {
    const response = await request(app).get('/api/v1/tax/lines/NONSENSE').set(auth(adminA));
    expect(response.status).toBe(400);
  });

  it('counts only posted documents', async () => {
    await createPurchase(adminA, draftPurchaseBody(ctx));

    const response = await request(app).get('/api/v1/tax/input-tax').set(auth(adminA));
    expect(response.body.data.inputTax.totalTax).toBe('0.00');
  });
});

describe('GST rollback', () => {
  beforeEach(resetTransactions);

  const breakAccount = (code) =>
    prisma.account.updateMany({
      where: { companyId: companyA.company.id, code },
      data: { isActive: false },
    });

  it('rolls back everything when the input tax account is unusable', async () => {
    const draft = await createPurchase(adminA, draftPurchaseBody(ctx));
    await breakAccount('1510');

    const response = await request(app)
      .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_INACTIVE');

    const purchase = await prisma.purchase.findUnique({
      where: { id: draft.body.data.purchase.id },
    });
    expect(purchase.status).toBe('DRAFT');
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.inventoryBalance.count()).toBe(0);
    expect(await prisma.supplierPayable.count()).toBe(0);
    expect(await prisma.journalEntry.count()).toBe(0);

    const summary = await request(app).get('/api/v1/tax/input-tax').set(auth(adminA));
    expect(summary.body.data.inputTax.totalTax).toBe('0.00');
  });

  it('rolls back a sale when the output tax account is unusable', async () => {
    await postedPurchase(adminA, ctx);
    const stockBefore = await prisma.inventoryBalance.findFirst({
      where: { productId: ctx.productA },
    });

    const draft = await createSale(adminA, draftSaleBody(ctx));
    await breakAccount('2110');

    const response = await request(app)
      .post(`/api/v1/sales/${draft.body.data.sale.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);

    const sale = await prisma.salesInvoice.findUnique({ where: { id: draft.body.data.sale.id } });
    expect(sale.status).toBe('DRAFT');

    const stockAfter = await prisma.inventoryBalance.findFirst({
      where: { productId: ctx.productA },
    });
    expect(stockAfter.quantity.toString()).toBe(stockBefore.quantity.toString());
    expect(await prisma.customerReceivable.count()).toBe(0);
    expect(
      await prisma.journalEntry.count({ where: { sourceType: 'SALES_INVOICE' } }),
    ).toBe(0);

    const summary = await request(app).get('/api/v1/tax/output-tax').set(auth(adminA));
    expect(summary.body.data.outputTax.totalTax).toBe('0.00');
  });

  it('posts normally once the account is usable again', async () => {
    const draft = await createPurchase(adminA, draftPurchaseBody(ctx));
    await breakAccount('1520');

    const failed = await request(app)
      .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
      .set(auth(adminA));
    expect(failed.status).toBe(422);

    await prisma.account.updateMany({
      where: { companyId: companyA.company.id, code: '1520' },
      data: { isActive: true },
    });

    const retried = await request(app)
      .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
      .set(auth(adminA));

    expect(retried.status).toBe(200);
    expect(retried.body.data.purchase.taxBreakup.sgst).toBe('900.00');
  });
});

describe('GST concurrency', () => {
  beforeEach(resetTransactions);

  it('taxes a purchase exactly once under simultaneous posts', async () => {
    const draft = await createPurchase(adminA, draftPurchaseBody(ctx));

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
          .set(auth(adminA)),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(adminA, '1510')).toBe('900.00');
    expect(await balanceOf(adminA, '1520')).toBe('900.00');

    const summary = await request(app).get('/api/v1/tax/input-tax').set(auth(adminA));
    expect(summary.body.data.inputTax.totalTax).toBe('1800.00');
  });

  it('taxes a sale exactly once under simultaneous posts', async () => {
    await postedPurchase(adminA, ctx);
    const draft = await createSale(adminA, draftSaleBody(ctx));

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post(`/api/v1/sales/${draft.body.data.sale.id}/post`).set(auth(adminA)),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(adminA, '2110')).toBe('180.00');
    expect(
      await prisma.journalEntry.count({ where: { sourceType: 'SALES_INVOICE' } }),
    ).toBe(1);
  });

  it('keeps three parallel purchases correct and distinct', async () => {
    const drafts = await Promise.all([
      createPurchase(adminA, draftPurchaseBody(ctx)),
      createPurchase(adminA, draftPurchaseBody(ctx)),
      createPurchase(adminA, draftPurchaseBody(ctx)),
    ]);

    const results = await Promise.all(
      drafts.map((draft) =>
        request(app)
          .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
          .set(auth(adminA)),
      ),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await balanceOf(adminA, '1510')).toBe('2700.00');
  });
});

describe('GST tenant isolation on documents', () => {
  beforeEach(resetTransactions);

  it('keeps each company GST summary separate', async () => {
    await postedPurchase(adminA, ctx);
    await postedPurchase(adminB, ctxB, { supplierId: ctxB.localSupplierId });

    const a = await request(app).get('/api/v1/tax/input-tax').set(auth(adminA));
    const b = await request(app).get('/api/v1/tax/input-tax').set(auth(adminB));

    // A is in Maharashtra buying locally; B is in Karnataka buying from a
    // Maharashtra supplier, so B's purchase is inter-state.
    expect(a.body.data.inputTax.cgst).toBe('900.00');
    expect(b.body.data.inputTax.cgst).toBe('0.00');
    expect(b.body.data.inputTax.igst).toBe('1800.00');
  });

  it("never lists another company's tax lines", async () => {
    const purchase = await postedPurchase(adminA, ctx);
    await postedPurchase(adminB, ctxB, { supplierId: ctxB.localSupplierId });

    const response = await request(app)
      .get('/api/v1/tax/gst-purchases?limit=100')
      .set(auth(adminB));

    expect(
      response.body.data.gstPurchases.lines.every((line) => line.documentId !== purchase.id),
    ).toBe(true);
  });

  it("cannot use another company's tax rate on a document", async () => {
    const response = await createPurchase(adminA, {
      ...draftPurchaseBody(ctx, {
        items: [
          { productId: ctx.productA, quantity: '10', unitCost: '100', taxId: ctxB.rates[18] },
        ],
      }),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('TAX_NOT_FOUND');
  });

  it("cannot use another company's supplier, even with a valid state", async () => {
    const response = await createPurchase(
      adminA,
      draftPurchaseBody(ctx, { supplierId: ctxB.localSupplierId }),
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SUPPLIER_NOT_FOUND');
  });
});

describe('a company that has not enabled GST is unaffected', () => {
  let plainCompany;
  let plainToken;
  let plainCtx;

  beforeAll(async () => {
    plainCompany = await createCompanyWithUsers('gstplain');
    plainToken = await login(app, plainCompany.admin.email, plainCompany.adminPassword);
    plainCtx = await prepare(plainToken, 'P', { warehouseState: HOME_STATE });
  });

  it('posts a taxed purchase with no split and no state', async () => {
    const purchase = await postedPurchase(plainToken, plainCtx, {
      supplierId: plainCtx.statelessSupplierId,
    });

    expect(purchase.gst).toBeNull();
    expect(purchase.taxTotal).toBe('1800.00');
    expect(purchase.taxBreakup.cgst).toBe('0.00');
    expect(purchase.grandTotal).toBe('11800.00');
  });

  it('posts its tax to the aggregate account, exactly as before', async () => {
    const purchase = await postedPurchase(plainToken, plainCtx, {
      supplierId: plainCtx.statelessSupplierId,
    });

    const { entry } = await journalFor(plainToken, 'PURCHASE', purchase.id);
    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1500', 'debit')).toBe('1800.00');
    expect(postedTo(entry, '1510', 'debit')).toBeNull();
  });

  it('returns cost only, with no tax, on a purchase return', async () => {
    const purchase = await postedPurchase(plainToken, plainCtx, {
      supplierId: plainCtx.statelessSupplierId,
    });
    const returned = await postedPurchaseReturn(plainToken, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    expect(returned.taxTotal).toBe('0.00');
    expect(returned.grandTotal).toBe('1000.00');
    expect(returned.taxableTotal).toBe('1000.00');
  });
});
