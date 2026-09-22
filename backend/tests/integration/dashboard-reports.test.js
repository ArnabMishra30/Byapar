import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// The universal business layer: dashboard, reports and the credit book.
//
// THE CENTRAL PRODUCT REQUIREMENT UNDER TEST
//   Everything here must work identically for a shop with no GST registration.
//   Two companies are set up side by side - one GST-registered, one not - and the
//   same assertions are run against both wherever the figures should match.
//
// Figures are chosen so they can be checked by hand:
//   purchase 100 @ 100      -> stock 10000
//   sale     10 @ 200       -> invoice 2000 (no GST) / 2360 (18% GST)

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const TODAY = '2026-09-16';
const YESTERDAY = '2026-09-15';
const LAST_MONTH = '2026-08-20';
const DASH = `?date=${TODAY}`;

let gstCompany;
let plainCompany;
let otherCompany;
let gstAdmin;
let plainAdmin;
let plainStaff;
let otherAdmin;
let gstCtx;
let plainCtx;
let otherCtx;

async function prepare(token, suffix, { gst = false } = {}) {
  const post = (path, body) => request(app).post(path).set(auth(token)).send(body);

  if (gst) {
    const profile = await request(app)
      .patch('/api/v1/tax/profile')
      .set(auth(token))
      .send({ stateCode: '27', gstin: '27AAPFU0939F1ZV', registrationType: 'REGULAR' });
    expect(profile.status).toBe(200);
  }

  const category = await post('/api/v1/categories', { name: `DashCat ${suffix}` });
  const unit = await post('/api/v1/units', { name: `DashUnit ${suffix}`, shortCode: `DU${suffix}` });
  const tax = await post('/api/v1/taxes', { name: `DashGST ${suffix}`, rate: '18' });

  const makeProduct = async (n, reorderLevel = '0') => {
    const created = await post('/api/v1/products', {
      name: `DashProd${n} ${suffix}`,
      sku: `DASH-${suffix}-${n}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
      reorderLevel,
    });
    expect(created.status).toBe(201);
    return created.body.data.product.id;
  };

  const warehouse = await post('/api/v1/warehouses', {
    name: `DashWH ${suffix}`,
    code: `DW${suffix}`,
    ...(gst ? { stateCode: '27' } : {}),
  });

  const supplierBody = (name) => ({ name, ...(gst ? { stateCode: '27' } : {}) });
  const supplierA = await post('/api/v1/suppliers', supplierBody(`DashSupA ${suffix}`));
  const supplierB = await post('/api/v1/suppliers', supplierBody(`DashSupB ${suffix}`));
  const customerA = await post('/api/v1/customers', supplierBody(`DashCustA ${suffix}`));
  const customerB = await post('/api/v1/customers', supplierBody(`DashCustB ${suffix}`));

  return {
    gst,
    taxId: tax.body.data.tax.id,
    productA: await makeProduct('A'),
    productB: await makeProduct('B', '20'),
    warehouseId: warehouse.body.data.warehouse.id,
    supplierA: supplierA.body.data.supplier.id,
    supplierB: supplierB.body.data.supplier.id,
    customerA: customerA.body.data.customer.id,
    customerB: customerB.body.data.customer.id,
  };
}

// --- document helpers ------------------------------------------------------

let billCounter = 0;

async function postedPurchase(token, ctx, { supplierId, items, invoiceDate = TODAY, dueDate } = {}) {
  const draft = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: supplierId ?? ctx.supplierA,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `DASHB-${(billCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`,
      invoiceDate,
      ...(dueDate ? { dueDate } : {}),
      items: items ?? [{ productId: ctx.productA, quantity: '100', unitCost: '100' }],
    });
  expect(draft.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/purchases/${draft.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

async function postedSale(token, ctx, { customerId, items, invoiceDate = TODAY, dueDate } = {}) {
  const draft = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId: customerId ?? ctx.customerA,
      warehouseId: ctx.warehouseId,
      invoiceDate,
      ...(dueDate ? { dueDate } : {}),
      items: items ?? [{ productId: ctx.productA, quantity: '10', unitPrice: '200' }],
    });
  expect(draft.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/sales/${draft.body.data.sale.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

async function postedReceipt(token, ctx, { customerId, amount, allocations, paymentDate = TODAY, paymentMethod = 'CASH' } = {}) {
  const created = await request(app)
    .post('/api/v1/customer-payments')
    .set(auth(token))
    .send({
      customerId: customerId ?? ctx.customerA,
      paymentDate,
      paymentMethod,
      amount,
      ...(allocations ? { allocations } : {}),
    });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

async function postedSupplierPayment(token, ctx, { supplierId, amount, allocations, paymentDate = TODAY, paymentMethod = 'BANK_TRANSFER' } = {}) {
  const created = await request(app)
    .post('/api/v1/supplier-payments')
    .set(auth(token))
    .send({
      supplierId: supplierId ?? ctx.supplierA,
      paymentDate,
      paymentMethod,
      amount,
      ...(allocations ? { allocations } : {}),
    });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

async function postedSalesReturn(token, sale, items, returnDate = TODAY) {
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

async function postedPurchaseReturn(token, purchase, items, returnDate = TODAY) {
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

// --- read helpers ----------------------------------------------------------

const dashboard = (token, query = DASH) =>
  request(app).get(`/api/v1/dashboard${query}`).set(auth(token));
const report = (token, name, query = '') =>
  request(app).get(`/api/v1/reports/${name}${query}`).set(auth(token));
const credit = (token, path = '', query = '') =>
  request(app).get(`/api/v1/credit${path}${query}`).set(auth(token));

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

  gstCompany = await createCompanyWithUsers('dashgst');
  plainCompany = await createCompanyWithUsers('dashplain');
  otherCompany = await createCompanyWithUsers('dashother');

  gstAdmin = await login(app, gstCompany.admin.email, gstCompany.adminPassword);
  plainAdmin = await login(app, plainCompany.admin.email, plainCompany.adminPassword);
  plainStaff = await login(app, plainCompany.staff.email, plainCompany.staffPassword);
  otherAdmin = await login(app, otherCompany.admin.email, otherCompany.adminPassword);

  gstCtx = await prepare(gstAdmin, 'G', { gst: true });
  plainCtx = await prepare(plainAdmin, 'P');
  otherCtx = await prepare(otherAdmin, 'O');
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('a shop with no GST registration', () => {
  beforeEach(resetTransactions);

  it('gets a complete dashboard, with GST reported as off', async () => {
    const response = await dashboard(plainAdmin);

    expect(response.status).toBe(200);
    const data = response.body.data.dashboard;

    // The one GST-related field: a flag, so a client knows not to show GST
    // screens. Nothing else on the dashboard depends on it.
    expect(data.gstEnabled).toBe(false);
    expect(data.asOf).toBe(TODAY);
    expect(data.currency).toBe('INR');

    // And every section is present and well formed.
    expect(data.today.sales.net).toBe('0.00');
    expect(data.balances.customerReceivables.total).toBe('0.00');
    expect(data.balances.inventory.totalValue).toBe('0.00');
    expect(data.profit.netProfit).toBe('0.00');
    expect(data.comparisons.salesTodayVsYesterday.direction).toBe('FLAT');
  });

  it('records a day of trading without any tax fields', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const data = (await dashboard(plainAdmin)).body.data.dashboard;

    // 10 @ 200, no tax at all.
    expect(data.today.sales.total).toBe('2000.00');
    expect(data.today.sales.net).toBe('2000.00');
    expect(data.today.sales.invoiceCount).toBe(1);
    expect(data.today.purchases.total).toBe('10000.00');
    expect(data.today.costOfGoodsSold).toBe('1000.00');
    expect(data.today.grossMargin).toBe('1000.00');
  });

  it('reports the same figures a GST company would, minus the tax', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);
    await postedPurchase(gstAdmin, gstCtx);
    await postedSale(gstAdmin, gstCtx, {
      items: [{ productId: gstCtx.productA, quantity: '10', unitPrice: '200', taxId: gstCtx.taxId }],
    });

    const plain = (await dashboard(plainAdmin)).body.data.dashboard;
    const gst = (await dashboard(gstAdmin)).body.data.dashboard;

    expect(plain.gstEnabled).toBe(false);
    expect(gst.gstEnabled).toBe(true);

    // The trade is identical; only the tax differs.
    expect(plain.today.sales.total).toBe('2000.00');
    expect(gst.today.sales.total).toBe('2360.00');
    // Cost, margin and stock are untouched by GST.
    expect(gst.today.costOfGoodsSold).toBe(plain.today.costOfGoodsSold);
    expect(gst.today.grossMargin).toBe(plain.today.grossMargin);
    expect(gst.balances.inventory.totalValue).toBe(plain.balances.inventory.totalValue);
  });

  it('runs every report without GST configured', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    await postedReceipt(plainAdmin, plainCtx, { amount: '500' });

    for (const name of [
      'sales',
      'purchases',
      'customer-outstanding',
      'supplier-outstanding',
      'payments-received',
      'supplier-payments',
      'inventory-valuation',
      'profit-loss',
      'general-ledger',
      'cash-bank',
    ]) {
      const response = await report(plainAdmin, name);
      expect(`${name}:${response.status}`).toBe(`${name}:200`);
    }

    const ledger = await report(plainAdmin, `customer-ledger/${plainCtx.customerA}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.ledger.closingBalance).toBe('1500.00');
    void sale;
  });
});

describe('dashboard periods and comparisons', () => {
  beforeEach(resetTransactions);

  it('separates today from yesterday', async () => {
    await postedPurchase(plainAdmin, plainCtx, { invoiceDate: YESTERDAY });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: YESTERDAY });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: TODAY });

    const data = (await dashboard(plainAdmin)).body.data.dashboard;

    expect(data.today.sales.total).toBe('2000.00');
    // Both days are inside the same week and month.
    expect(data.thisWeek.sales.total).toBe('4000.00');
    expect(data.thisMonth.sales.total).toBe('4000.00');
    expect(data.comparisons.salesTodayVsYesterday.direction).toBe('FLAT');
  });

  it('compares this month with the whole of last month', async () => {
    await postedPurchase(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedSale(plainAdmin, plainCtx, {
      invoiceDate: TODAY,
      items: [{ productId: plainCtx.productA, quantity: '20', unitPrice: '200' }],
    });

    const data = (await dashboard(plainAdmin)).body.data.dashboard;
    const comparison = data.comparisons.salesThisMonthVsLast;

    expect(comparison.current).toBe('4000.00');
    expect(comparison.previous).toBe('2000.00');
    expect(comparison.change).toBe('2000.00');
    expect(comparison.changePercent).toBe('100.00');
    expect(comparison.direction).toBe('UP');
  });

  it('gives no percentage when the previous period was empty', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const data = (await dashboard(plainAdmin)).body.data.dashboard;
    expect(data.comparisons.salesThisMonthVsLast.changePercent).toBeNull();
    expect(data.comparisons.salesThisMonthVsLast.direction).toBe('UP');
  });

  it('nets returns out of the day, and says so separately', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    await postedSalesReturn(plainAdmin, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await dashboard(plainAdmin)).body.data.dashboard;

    expect(data.today.sales.total).toBe('2000.00');
    expect(data.today.sales.returns).toBe('800.00');
    expect(data.today.sales.net).toBe('1200.00');
    expect(data.today.costOfGoodsSold).toBe('600.00');
  });

  it('nets purchase returns too', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    await postedPurchaseReturn(plainAdmin, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    const data = (await dashboard(plainAdmin)).body.data.dashboard;

    expect(data.today.purchases.total).toBe('10000.00');
    expect(data.today.purchases.returns).toBe('1000.00');
    expect(data.today.purchases.net).toBe('9000.00');
  });

  it('excludes drafts and cancelled documents from every figure', async () => {
    await postedPurchase(plainAdmin, plainCtx);

    const draft = await request(app)
      .post('/api/v1/sales')
      .set(auth(plainAdmin))
      .send({
        customerId: plainCtx.customerA,
        warehouseId: plainCtx.warehouseId,
        invoiceDate: TODAY,
        items: [{ productId: plainCtx.productA, quantity: '5', unitPrice: '200' }],
      });
    const toCancel = await request(app)
      .post('/api/v1/sales')
      .set(auth(plainAdmin))
      .send({
        customerId: plainCtx.customerA,
        warehouseId: plainCtx.warehouseId,
        invoiceDate: TODAY,
        items: [{ productId: plainCtx.productA, quantity: '5', unitPrice: '200' }],
      });
    await request(app)
      .post(`/api/v1/sales/${toCancel.body.data.sale.id}/cancel`)
      .set(auth(plainAdmin));

    const data = (await dashboard(plainAdmin)).body.data.dashboard;
    expect(data.today.sales.total).toBe('0.00');
    expect(data.today.sales.invoiceCount).toBe(0);

    const salesReport = await report(plainAdmin, 'sales');
    expect(salesReport.body.data.report.totals.invoiceCount).toBe(0);
    void draft;
  });
});

describe('money in and out', () => {
  beforeEach(resetTransactions);

  it('reports money received and paid, and the net movement', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);
    const payable = await payableFor(plainAdmin, purchase.id);

    await postedReceipt(plainAdmin, plainCtx, {
      amount: '1200',
      allocations: [{ receivableId: receivable.id, amount: '1200' }],
    });
    await postedSupplierPayment(plainAdmin, plainCtx, {
      amount: '4000',
      allocations: [{ payableId: payable.id, amount: '4000' }],
    });

    const data = (await dashboard(plainAdmin)).body.data.dashboard;

    expect(data.today.moneyReceived.total).toBe('1200.00');
    expect(data.today.moneyReceived.againstInvoices).toBe('1200.00');
    expect(data.today.moneyPaid.total).toBe('4000.00');
    expect(data.today.netCashMovement).toBe('-2800.00');
  });

  it('reports cash and bank separately, from the ledger', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);
    await postedReceipt(plainAdmin, plainCtx, { amount: '900', paymentMethod: 'CASH' });
    await postedReceipt(plainAdmin, plainCtx, { amount: '600', paymentMethod: 'BANK' });

    const data = (await dashboard(plainAdmin)).body.data.dashboard;
    const byCode = Object.fromEntries(
      data.balances.cashAndBank.accounts.map((row) => [row.code, row]),
    );

    expect(byCode['1000'].moneyIn).toBe('900.00');
    expect(byCode['1010'].moneyIn).toBe('600.00');
    expect(data.balances.cashAndBank.totalBalance).toBe('1500.00');
  });

  it('separates an advance from a payment against an invoice', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);

    await postedReceipt(plainAdmin, plainCtx, {
      amount: '2500',
      allocations: [{ receivableId: receivable.id, amount: '2000' }],
    });

    const data = (await dashboard(plainAdmin)).body.data.dashboard;

    expect(data.today.moneyReceived.total).toBe('2500.00');
    expect(data.today.moneyReceived.againstInvoices).toBe('2000.00');
    expect(data.today.moneyReceived.advance).toBe('500.00');
  });
});

describe('the credit book', () => {
  beforeEach(resetTransactions);

  it('answers "who owes me money?" with a name and an amount', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx, { customerId: plainCtx.customerA });
    await postedSale(plainAdmin, plainCtx, {
      customerId: plainCtx.customerB,
      items: [{ productId: plainCtx.productA, quantity: '5', unitPrice: '200' }],
    });

    const response = await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`);

    expect(response.status).toBe(200);
    const data = response.body.data.receivables;

    expect(data.question).toBe('Who owes me money?');
    expect(data.summary.partyCount).toBe(2);
    expect(data.summary.total).toBe('3000.00');
    // Biggest debt first: that is the order a shopkeeper chases in.
    expect(data.customers[0].outstanding).toBe('2000.00');
    expect(data.customers[1].outstanding).toBe('1000.00');
    expect(data.customers[0].name).toContain('DashCustA');
  });

  it('answers "since when?" with the oldest unpaid invoice and its age', async () => {
    await postedPurchase(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    const old = await postedSale(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: TODAY });

    const data = (await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`)).body.data
      .receivables;
    const customer = data.customers[0];

    expect(customer.oldestDocumentDate).toBe(LAST_MONTH);
    expect(customer.oldestDocumentNumber).toBe(old.invoiceNumber);
    // 2026-08-20 to 2026-09-16.
    expect(customer.ageInDays).toBe(27);
    expect(customer.ageingBucket).toBe('0-30');
  });

  it('answers "what payments were made?"', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);
    const receipt = await postedReceipt(plainAdmin, plainCtx, {
      amount: '500',
      allocations: [{ receivableId: receivable.id, amount: '500' }],
      paymentDate: YESTERDAY,
    });

    const data = (await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`)).body.data
      .receivables;
    const customer = data.customers[0];

    expect(customer.lastPayment.number).toBe(receipt.paymentNumber);
    expect(customer.lastPayment.date).toBe(YESTERDAY);
    expect(customer.lastPayment.amount).toBe('500.00');
    expect(customer.paid).toBe('500.00');
    expect(customer.outstanding).toBe('1500.00');
  });

  it('answers "what is overdue?"', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    // Due yesterday: overdue. Due next month: not yet.
    await postedSale(plainAdmin, plainCtx, {
      customerId: plainCtx.customerA,
      invoiceDate: LAST_MONTH,
      dueDate: YESTERDAY,
    });
    await postedSale(plainAdmin, plainCtx, {
      customerId: plainCtx.customerB,
      invoiceDate: TODAY,
      dueDate: '2026-10-31',
      items: [{ productId: plainCtx.productA, quantity: '5', unitPrice: '200' }],
    });

    const data = (await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`)).body.data
      .receivables;

    expect(data.summary.overdue).toBe('2000.00');
    expect(data.summary.notYetDue).toBe('1000.00');
    expect(data.summary.overduePartyCount).toBe(1);

    const overdueOnly = (
      await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}&overdueOnly=true`)
    ).body.data.receivables;
    expect(overdueOnly.customers).toHaveLength(1);
    expect(overdueOnly.customers[0].isOverdue).toBe(true);
  });

  it('answers "whom do I owe?"', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx, { supplierId: plainCtx.supplierA });
    await postedPurchase(plainAdmin, plainCtx, {
      supplierId: plainCtx.supplierB,
      items: [{ productId: plainCtx.productB, quantity: '10', unitCost: '100' }],
    });
    const payable = await payableFor(plainAdmin, purchase.id);
    await postedSupplierPayment(plainAdmin, plainCtx, {
      amount: '3000',
      allocations: [{ payableId: payable.id, amount: '3000' }],
    });

    const data = (await credit(plainAdmin, '/payables', `?asOfDate=${TODAY}`)).body.data.payables;

    expect(data.question).toBe('Whom do I owe?');
    expect(data.summary.partyCount).toBe(2);
    expect(data.summary.total).toBe('8000.00');
    expect(data.suppliers[0].outstanding).toBe('7000.00');
    expect(data.suppliers[0].paid).toBe('3000.00');
    expect(data.suppliers[0].lastPayment.amount).toBe('3000.00');
  });

  it('shows both sides and the net position on one screen', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const data = (await credit(plainAdmin, '', `?asOfDate=${TODAY}`)).body.data.credit;

    expect(data.owedToMe.total).toBe('2000.00');
    expect(data.owedByMe.total).toBe('10000.00');
    expect(data.netPosition).toBe('-8000.00');
    expect(data.netDirection).toBe('OWED_BY_ME');
    expect(data.owedToMe.topCustomers).toHaveLength(1);
  });

  it('drops a customer who has paid in full', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);
    await postedReceipt(plainAdmin, plainCtx, {
      amount: '2000',
      allocations: [{ receivableId: receivable.id, amount: '2000' }],
    });

    const data = (await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`)).body.data
      .receivables;

    expect(data.customers).toHaveLength(0);
    expect(data.summary.total).toBe('0.00');
  });

  it('reduces what is owed when goods come back', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    await postedSalesReturn(plainAdmin, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const data = (await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`)).body.data
      .receivables;

    expect(data.customers[0].billed).toBe('2000.00');
    expect(data.customers[0].credited).toBe('800.00');
    expect(data.customers[0].outstanding).toBe('1200.00');
  });

  it('filters out small balances', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx, { customerId: plainCtx.customerA });
    await postedSale(plainAdmin, plainCtx, {
      customerId: plainCtx.customerB,
      items: [{ productId: plainCtx.productA, quantity: '1', unitPrice: '100' }],
    });

    const data = (
      await credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}&minimumAmount=500`)
    ).body.data.receivables;

    expect(data.customers).toHaveLength(1);
    expect(data.customers[0].outstanding).toBe('2000.00');
  });

  it('gives one customer their whole history', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);
    await postedReceipt(plainAdmin, plainCtx, {
      amount: '500',
      allocations: [{ receivableId: receivable.id, amount: '500' }],
    });

    const response = await credit(plainAdmin, `/customers/${plainCtx.customerA}`);

    expect(response.status).toBe(200);
    const data = response.body.data.credit;
    expect(data.position.outstandingAmount).toBe('1500.00');
    expect(data.openInvoices).toHaveLength(1);
    expect(data.ledger.entries).toHaveLength(2);
    expect(data.ledger.closingBalance).toBe('1500.00');
  });

  it('gives one supplier theirs', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    const payable = await payableFor(plainAdmin, purchase.id);
    await postedSupplierPayment(plainAdmin, plainCtx, {
      amount: '2000',
      allocations: [{ payableId: payable.id, amount: '2000' }],
    });

    const data = (await credit(plainAdmin, `/suppliers/${plainCtx.supplierA}`)).body.data.credit;

    expect(data.position.outstandingAmount).toBe('8000.00');
    expect(data.openBills).toHaveLength(1);
    expect(data.ledger.closingBalance).toBe('8000.00');
  });

  it('is empty and well formed for a company with nothing on credit', async () => {
    const data = (await credit(otherAdmin, '', `?asOfDate=${TODAY}`)).body.data.credit;

    expect(data.owedToMe.total).toBe('0.00');
    expect(data.owedByMe.total).toBe('0.00');
    expect(data.netPosition).toBe('0.00');
    expect(data.owedToMe.topCustomers).toEqual([]);
  });
});

describe('reports', () => {
  beforeEach(resetTransactions);

  it('lists sales with what is still unpaid on each', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);
    await postedReceipt(plainAdmin, plainCtx, {
      amount: '500',
      allocations: [{ receivableId: receivable.id, amount: '500' }],
    });

    const data = (await report(plainAdmin, 'sales')).body.data.report;

    expect(data.invoices).toHaveLength(1);
    expect(data.invoices[0].total).toBe('2000.00');
    expect(data.invoices[0].paid).toBe('500.00');
    expect(data.invoices[0].outstanding).toBe('1500.00');
    expect(data.invoices[0].costOfGoodsSold).toBe('1000.00');
    expect(data.invoices[0].grossMargin).toBe('1000.00');
    expect(data.totals.invoiceCount).toBe(1);
    expect(data.totals.netSales).toBe('2000.00');
  });

  it('filters a report by date range', async () => {
    await postedPurchase(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: TODAY });

    const august = (
      await report(plainAdmin, 'sales', '?fromDate=2026-08-01&toDate=2026-08-31')
    ).body.data.report;
    const september = (
      await report(plainAdmin, 'sales', '?fromDate=2026-09-01&toDate=2026-09-30')
    ).body.data.report;
    const everything = (await report(plainAdmin, 'sales')).body.data.report;

    expect(august.totals.invoiceCount).toBe(1);
    expect(september.totals.invoiceCount).toBe(1);
    expect(everything.totals.invoiceCount).toBe(2);
  });

  it('includes a document dated exactly on each boundary', async () => {
    await postedPurchase(plainAdmin, plainCtx, { invoiceDate: '2026-09-01' });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: '2026-09-01' });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: '2026-09-30' });

    const data = (
      await report(plainAdmin, 'sales', '?fromDate=2026-09-01&toDate=2026-09-30')
    ).body.data.report;

    expect(data.totals.invoiceCount).toBe(2);
  });

  it('rejects a reversed date range', async () => {
    const response = await report(plainAdmin, 'sales', '?fromDate=2026-09-30&toDate=2026-09-01');
    expect(response.status).toBe(400);
  });

  it('filters sales by customer', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx, { customerId: plainCtx.customerA });
    await postedSale(plainAdmin, plainCtx, { customerId: plainCtx.customerB });

    const data = (await report(plainAdmin, 'sales', `?customerId=${plainCtx.customerA}`)).body.data
      .report;

    expect(data.invoices).toHaveLength(1);
    // The totals describe the SAME rows as the list, not every customer.
    expect(data.totals.invoiceCount).toBe(1);
    expect(data.totals.total).toBe('2000.00');
  });

  it('filters purchases by supplier, totals included', async () => {
    await postedPurchase(plainAdmin, plainCtx, { supplierId: plainCtx.supplierA });
    await postedPurchase(plainAdmin, plainCtx, {
      supplierId: plainCtx.supplierB,
      items: [{ productId: plainCtx.productB, quantity: '10', unitCost: '50' }],
    });

    const data = (await report(plainAdmin, 'purchases', `?supplierId=${plainCtx.supplierB}`)).body
      .data.report;

    expect(data.bills).toHaveLength(1);
    expect(data.totals.billCount).toBe(1);
    expect(data.totals.total).toBe('500.00');
  });

  it('filters receipts by customer, totals included', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);
    await postedReceipt(plainAdmin, plainCtx, { customerId: plainCtx.customerA, amount: '300' });
    await postedReceipt(plainAdmin, plainCtx, { customerId: plainCtx.customerB, amount: '700' });

    const data = (
      await report(plainAdmin, 'payments-received', `?customerId=${plainCtx.customerB}`)
    ).body.data.report;

    expect(data.receipts).toHaveLength(1);
    expect(data.totals.receiptCount).toBe(1);
    expect(data.totals.amount).toBe('700.00');
    // The method breakdown is filtered too, not just the list.
    expect(data.byMethod.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(700);
  });

  it('lists purchases with what is still owed on each', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    const payable = await payableFor(plainAdmin, purchase.id);
    await postedSupplierPayment(plainAdmin, plainCtx, {
      amount: '2500',
      allocations: [{ payableId: payable.id, amount: '2500' }],
    });

    const data = (await report(plainAdmin, 'purchases')).body.data.report;

    expect(data.bills[0].total).toBe('10000.00');
    expect(data.bills[0].paid).toBe('2500.00');
    expect(data.bills[0].outstanding).toBe('7500.00');
    expect(data.totals.billCount).toBe(1);
  });

  it('reports receipts by payment method', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);
    await postedReceipt(plainAdmin, plainCtx, { amount: '400', paymentMethod: 'CASH' });
    await postedReceipt(plainAdmin, plainCtx, { amount: '600', paymentMethod: 'UPI' });

    const data = (await report(plainAdmin, 'payments-received')).body.data.report;
    const byMethod = Object.fromEntries(data.byMethod.map((row) => [row.method, row]));

    expect(data.totals.amount).toBe('1000.00');
    expect(byMethod.CASH.amount).toBe('400.00');
    expect(byMethod.UPI.amount).toBe('600.00');
    expect(data.receipts).toHaveLength(2);
  });

  it('reports supplier payments by method', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSupplierPayment(plainAdmin, plainCtx, { amount: '1000', paymentMethod: 'CASH' });

    const data = (await report(plainAdmin, 'supplier-payments')).body.data.report;

    expect(data.totals.amount).toBe('1000.00');
    expect(data.byMethod[0].method).toBe('CASH');
  });

  it('values inventory and flags low stock', async () => {
    await postedPurchase(plainAdmin, plainCtx, {
      items: [
        { productId: plainCtx.productA, quantity: '100', unitCost: '100' },
        // productB has a reorder level of 20; 10 in stock is below it.
        { productId: plainCtx.productB, quantity: '10', unitCost: '50' },
      ],
    });

    const data = (await report(plainAdmin, 'inventory-valuation')).body.data.report;

    expect(data.totals.totalValue).toBe('10500.00');
    expect(data.totals.itemCount).toBe(2);
    expect(data.totals.lowStockCount).toBe(1);

    const low = (await report(plainAdmin, 'inventory-valuation', '?lowStockOnly=true')).body.data
      .report;
    expect(low.items).toHaveLength(1);
    expect(low.items[0].isLowStock).toBe(true);
  });

  it('reports profit and loss from the general ledger', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const data = (await report(plainAdmin, 'profit-loss', '?fromDate=2026-09-01&toDate=2026-09-30'))
      .body.data.report;

    expect(data.revenue.total).toBe('2000.00');
    expect(data.costOfGoodsSold.total).toBe('1000.00');
    expect(data.grossProfit).toBe('1000.00');
    expect(data.netProfit).toBe('1000.00');
  });

  it('reports the general ledger with its source references', async () => {
    await postedPurchase(plainAdmin, plainCtx);

    const response = await report(plainAdmin, 'general-ledger', '?limit=100');

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((line) => Boolean(line.sourceType && line.sourceId))).toBe(true);
  });

  it('reports cash and bank movement with an opening balance', async () => {
    await postedPurchase(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedSale(plainAdmin, plainCtx, { invoiceDate: LAST_MONTH });
    await postedReceipt(plainAdmin, plainCtx, { amount: '700', paymentDate: LAST_MONTH });
    await postedReceipt(plainAdmin, plainCtx, { amount: '300', paymentDate: TODAY });

    const data = (
      await report(plainAdmin, 'cash-bank', '?fromDate=2026-09-01&toDate=2026-09-30&limit=100')
    ).body.data.report;

    // Last month's 700 is the opening balance; this month's 300 is the movement.
    expect(data.totals.openingBalance).toBe('700.00');
    expect(data.totals.moneyIn).toBe('300.00');
    expect(data.totals.closingBalance).toBe('1000.00');
    expect(data.movements).toHaveLength(1);
    expect(data.movements[0].sourceType).toBe('CUSTOMER_PAYMENT');
  });

  it('is empty and well formed for a company with no documents', async () => {
    for (const name of ['sales', 'purchases', 'payments-received', 'supplier-payments']) {
      const data = (await report(otherAdmin, name)).body.data.report;
      expect(`${name}:${data.totals.description}`).toContain('whole period');
    }

    const inventory = (await report(otherAdmin, 'inventory-valuation')).body.data.report;
    expect(inventory.totals.totalValue).toBe('0.00');
    expect(inventory.items).toEqual([]);
  });
});

describe('reports reconcile with the sub-ledgers and the general ledger', () => {
  beforeEach(resetTransactions);

  it('matches the sales report to the ledger and the receivables', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    const receivable = await receivableFor(plainAdmin, sale.id);
    await postedReceipt(plainAdmin, plainCtx, {
      amount: '800',
      allocations: [{ receivableId: receivable.id, amount: '800' }],
    });

    const [salesReport, outstanding, profitLoss, dash] = await Promise.all([
      report(plainAdmin, 'sales'),
      report(plainAdmin, 'customer-outstanding', `?asOfDate=${TODAY}`),
      report(plainAdmin, 'profit-loss'),
      dashboard(plainAdmin),
    ]);

    const invoiced = Number(salesReport.body.data.report.totals.total);
    const outstandingTotal = Number(outstanding.body.data.report.summary.total);

    // Sales report agrees with the ledger's revenue (no tax here, so equal).
    expect(Number(profitLoss.body.data.report.revenue.total)).toBe(invoiced);
    // Outstanding is what was invoiced less what was received.
    expect(outstandingTotal).toBe(invoiced - 800);
    // The dashboard agrees with the report.
    expect(dash.body.data.dashboard.balances.customerReceivables.total).toBe(
      outstanding.body.data.report.summary.total,
    );
    void purchase;
  });

  it('matches inventory valuation to the Inventory control account', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    await postedSalesReturn(plainAdmin, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const valuation = (await report(plainAdmin, 'inventory-valuation')).body.data.report;

    const accounts = await request(app).get('/api/v1/accounts?limit=100').set(auth(plainAdmin));
    const inventoryAccount = accounts.body.data.find((row) => row.code === '1300');
    const detail = await request(app)
      .get(`/api/v1/accounts/${inventoryAccount.id}`)
      .set(auth(plainAdmin));

    // The report and the ledger are computed from different places and agree.
    expect(valuation.totals.totalValue).toBe(detail.body.data.account.balance);
  });

  it('matches the cash report to the Cash and Bank accounts', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);
    await postedReceipt(plainAdmin, plainCtx, { amount: '900', paymentMethod: 'CASH' });
    await postedSupplierPayment(plainAdmin, plainCtx, { amount: '400', paymentMethod: 'CASH' });

    const cashReport = (await report(plainAdmin, 'cash-bank', '?limit=100')).body.data.report;

    const accounts = await request(app).get('/api/v1/accounts?limit=100').set(auth(plainAdmin));
    const cashAccount = accounts.body.data.find((row) => row.code === '1000');
    const detail = await request(app)
      .get(`/api/v1/accounts/${cashAccount.id}`)
      .set(auth(plainAdmin));

    const cashRow = cashReport.accounts.find((row) => row.code === '1000');
    expect(cashRow.closingBalance).toBe(detail.body.data.account.balance);
    expect(cashRow.moneyIn).toBe('900.00');
    expect(cashRow.moneyOut).toBe('400.00');
  });

  it('matches supplier outstanding to the payables sub-ledger', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    await postedPurchaseReturn(plainAdmin, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);
    const payable = await payableFor(plainAdmin, purchase.id);
    await postedSupplierPayment(plainAdmin, plainCtx, {
      amount: '2000',
      allocations: [{ payableId: payable.id, amount: '2000' }],
    });

    const [outstanding, payables] = await Promise.all([
      report(plainAdmin, 'supplier-outstanding', `?asOfDate=${TODAY}`),
      request(app).get('/api/v1/supplier-payables?limit=100').set(auth(plainAdmin)),
    ]);

    const subLedgerTotal = payables.body.data.reduce(
      (sum, row) => sum + Number(row.outstandingAmount),
      0,
    );

    // 10000 billed, 1000 returned, 2000 paid.
    expect(Number(outstanding.body.data.report.summary.total)).toBe(7000);
    expect(Number(outstanding.body.data.report.summary.total)).toBe(subLedgerTotal);
  });

  it('matches the dashboard profit to the P&L report', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const [dash, profitLoss] = await Promise.all([
      dashboard(plainAdmin),
      report(plainAdmin, 'profit-loss', '?fromDate=2026-09-01&toDate=2026-09-30'),
    ]);

    // The dashboard does not compute profit: it asks the same service.
    expect(dash.body.data.dashboard.profit.netProfit).toBe(
      profitLoss.body.data.report.netProfit,
    );
    expect(dash.body.data.dashboard.profit.grossProfit).toBe(
      profitLoss.body.data.report.grossProfit,
    );
  });

  it('keeps the trial balance balanced through all of it', async () => {
    const purchase = await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);
    await postedSalesReturn(plainAdmin, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '3' },
    ]);
    await postedPurchaseReturn(plainAdmin, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '5' },
    ]);
    await postedReceipt(plainAdmin, plainCtx, { amount: '500' });
    await postedSupplierPayment(plainAdmin, plainCtx, { amount: '700' });

    const trialBalance = await request(app)
      .get('/api/v1/accounting/trial-balance')
      .set(auth(plainAdmin));

    expect(trialBalance.body.data.trialBalance.isBalanced).toBe(true);
  });
});

describe('a GST-registered company keeps its GST reporting', () => {
  beforeEach(resetTransactions);

  it('still has the GST summaries alongside the business reports', async () => {
    await postedPurchase(gstAdmin, gstCtx, {
      items: [{ productId: gstCtx.productA, quantity: '100', unitCost: '100', taxId: gstCtx.taxId }],
    });
    await postedSale(gstAdmin, gstCtx, {
      items: [{ productId: gstCtx.productA, quantity: '10', unitPrice: '200', taxId: gstCtx.taxId }],
    });

    const [dash, gstSummary, salesReport] = await Promise.all([
      dashboard(gstAdmin),
      request(app).get('/api/v1/tax/gst-summary').set(auth(gstAdmin)),
      report(gstAdmin, 'sales'),
    ]);

    expect(dash.body.data.dashboard.gstEnabled).toBe(true);
    expect(gstSummary.status).toBe(200);
    expect(gstSummary.body.data.gstSummary.outputTax.totalTax).toBe('360.00');

    // The business report shows tax as a column; it does not become a GST report.
    expect(salesReport.body.data.report.totals.tax).toBe('360.00');
    expect(salesReport.body.data.report.totals.total).toBe('2360.00');
  });

  it('excludes tax from revenue but includes it in what the customer owes', async () => {
    await postedPurchase(gstAdmin, gstCtx, {
      items: [{ productId: gstCtx.productA, quantity: '100', unitCost: '100', taxId: gstCtx.taxId }],
    });
    await postedSale(gstAdmin, gstCtx, {
      items: [{ productId: gstCtx.productA, quantity: '10', unitPrice: '200', taxId: gstCtx.taxId }],
    });

    const [profitLoss, outstanding] = await Promise.all([
      report(gstAdmin, 'profit-loss'),
      report(gstAdmin, 'customer-outstanding', `?asOfDate=${TODAY}`),
    ]);

    // Revenue is net of tax; the debt is the full invoice.
    expect(profitLoss.body.data.report.revenue.total).toBe('2000.00');
    expect(outstanding.body.data.report.summary.total).toBe('2360.00');
  });
});

describe('tenant isolation, RBAC and read safety', () => {
  beforeEach(resetTransactions);

  it("never shows another company's figures", async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const [mine, theirs] = await Promise.all([dashboard(plainAdmin), dashboard(otherAdmin)]);

    expect(mine.body.data.dashboard.today.sales.total).toBe('2000.00');
    expect(theirs.body.data.dashboard.today.sales.total).toBe('0.00');
    expect(theirs.body.data.dashboard.balances.customerReceivables.total).toBe('0.00');
    expect(theirs.body.data.dashboard.balances.inventory.totalValue).toBe('0.00');
  });

  it("never lists another company's documents in a report", async () => {
    await postedPurchase(plainAdmin, plainCtx);
    const sale = await postedSale(plainAdmin, plainCtx);

    const theirs = await report(otherAdmin, 'sales');
    const ids = theirs.body.data.report.invoices.map((invoice) => invoice.id);

    expect(ids).not.toContain(sale.id);
    expect(theirs.body.data.report.totals.invoiceCount).toBe(0);
  });

  it("never shows another company's credit book", async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const theirs = (await credit(otherAdmin, '/receivables', `?asOfDate=${TODAY}`)).body.data
      .receivables;

    expect(theirs.customers).toEqual([]);
    expect(theirs.summary.total).toBe('0.00');
  });

  it("returns 404 for another company's customer ledger", async () => {
    const response = await report(otherAdmin, `customer-ledger/${plainCtx.customerA}`);
    expect(response.status).toBe(404);

    const creditResponse = await credit(otherAdmin, `/customers/${plainCtx.customerA}`);
    expect(creditResponse.status).toBe(404);
  });

  it('lets STAFF read everything in this module', async () => {
    for (const path of [
      `/api/v1/dashboard${DASH}`,
      '/api/v1/reports/sales',
      '/api/v1/reports/customer-outstanding',
      '/api/v1/reports/inventory-valuation',
      '/api/v1/reports/profit-loss',
      '/api/v1/reports/cash-bank',
      '/api/v1/credit',
      '/api/v1/credit/receivables',
      '/api/v1/credit/payables',
    ]) {
      const response = await request(app).get(path).set(auth(plainStaff));
      expect(`${path}:${response.status}`).toBe(`${path}:200`);
    }
  });

  it('requires authentication', async () => {
    for (const path of ['/api/v1/dashboard', '/api/v1/reports/sales', '/api/v1/credit']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('exposes no way to write through this module', async () => {
    for (const [method, path] of [
      ['post', '/api/v1/dashboard'],
      ['patch', '/api/v1/dashboard'],
      ['delete', '/api/v1/dashboard'],
      ['post', '/api/v1/reports/sales'],
      ['post', '/api/v1/credit/receivables'],
    ]) {
      const response = await request(app)[method](path).set(auth(plainAdmin)).send({});
      expect(`${method} ${path}:${response.status}`).toBe(`${method} ${path}:404`);
    }
  });

  it('is safe and consistent under concurrent reads', async () => {
    await postedPurchase(plainAdmin, plainCtx);
    await postedSale(plainAdmin, plainCtx);

    const results = await Promise.all([
      dashboard(plainAdmin),
      report(plainAdmin, 'sales'),
      credit(plainAdmin, '/receivables', `?asOfDate=${TODAY}`),
      dashboard(plainAdmin),
      report(plainAdmin, 'sales'),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    // The same request twice against unchanged data gives the same answer.
    expect(JSON.stringify(results[3].body)).toBe(JSON.stringify(results[0].body));
    expect(JSON.stringify(results[4].body)).toBe(JSON.stringify(results[1].body));
  });

  it('stays correct while documents are posted concurrently', async () => {
    await postedPurchase(plainAdmin, plainCtx, {
      items: [{ productId: plainCtx.productA, quantity: '500', unitCost: '100' }],
    });

    // Three sales posted at once, with reads interleaved.
    const drafts = await Promise.all(
      [1, 2, 3].map(() =>
        request(app)
          .post('/api/v1/sales')
          .set(auth(plainAdmin))
          .send({
            customerId: plainCtx.customerA,
            warehouseId: plainCtx.warehouseId,
            invoiceDate: TODAY,
            items: [{ productId: plainCtx.productA, quantity: '10', unitPrice: '200' }],
          }),
      ),
    );

    const [posts] = await Promise.all([
      Promise.all(
        drafts.map((draft) =>
          request(app).post(`/api/v1/sales/${draft.body.data.sale.id}/post`).set(auth(plainAdmin)),
        ),
      ),
      dashboard(plainAdmin),
      report(plainAdmin, 'sales'),
    ]);

    expect(posts.every((r) => r.status === 200)).toBe(true);

    const after = (await dashboard(plainAdmin)).body.data.dashboard;
    expect(after.today.sales.total).toBe('6000.00');
    expect(after.today.sales.invoiceCount).toBe(3);
    expect(after.balances.customerReceivables.total).toBe('6000.00');
  });
});
