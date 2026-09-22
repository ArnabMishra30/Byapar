import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// Every operational document posting into the general ledger, end to end through
// HTTP, plus the reports derived from it and the reconciliation between the GL
// and the sub-ledgers it summarises.
//
// The scenario is deliberately arithmetic-friendly so every expected figure can
// be read off by hand:
//   purchase   100 @ 100 + 18% tax  -> inventory 10000, input tax 1800, AP 11800
//   sale        10 @ 200 + 18% tax  -> AR 2360, revenue 2000, tax 360, COGS 1000

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
    .send({ name: `GLCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `GLUnit ${suffix}`, shortCode: `GL${suffix}` });
  const tax = await request(app)
    .post('/api/v1/taxes')
    .set(auth(token))
    .send({ name: `GLGST ${suffix}`, rate: '18' });

  const makeProduct = async (n) => {
    const response = await request(app)
      .post('/api/v1/products')
      .set(auth(token))
      .send({
        name: `GLProd${n} ${suffix}`,
        sku: `GLSKU${n}-${suffix}`,
        categoryId: category.body.data.category.id,
        unitId: unit.body.data.unit.id,
      });
    return response.body.data.product.id;
  };

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `GLSup ${suffix}` });
  const customer = await request(app)
    .post('/api/v1/customers')
    .set(auth(token))
    .send({ name: `GLCust ${suffix}` });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `GLWH ${suffix}`, code: `GW${suffix}` });

  return {
    productId: await makeProduct('A'),
    productId2: await makeProduct('B'),
    taxId: tax.body.data.tax.id,
    supplierId: supplier.body.data.supplier.id,
    customerId: customer.body.data.customer.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

// --- document helpers ------------------------------------------------------

let billCounter = 0;

async function draftPurchase(token, ctx, { items, invoiceDate = '2026-08-01', ...rest } = {}) {
  const response = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `GLB-${(billCounter += 1)}-${Math.random().toString(36).slice(2, 8)}`,
      invoiceDate,
      items: items ?? [{ productId: ctx.productId, quantity: '100', unitCost: '100', taxId: ctx.taxId }],
      ...rest,
    });
  expect(response.status).toBe(201);
  return response.body.data.purchase;
}

async function postedPurchase(token, ctx, options) {
  const draft = await draftPurchase(token, ctx, options);
  const posted = await request(app).post(`/api/v1/purchases/${draft.id}/post`).set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

async function postedSale(token, ctx, { items, invoiceDate = '2026-09-01' } = {}) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId: ctx.customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate,
      items: items ?? [{ productId: ctx.productId, taxId: ctx.taxId, quantity: '10', unitPrice: '200' }],
    });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/sales/${created.body.data.sale.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
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

async function postedSupplierPayment(token, ctx, body) {
  const created = await request(app)
    .post('/api/v1/supplier-payments')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      paymentDate: '2026-08-20',
      paymentMethod: 'BANK_TRANSFER',
      ...body,
    });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

async function postedCustomerPayment(token, ctx, body) {
  const created = await request(app)
    .post('/api/v1/customer-payments')
    .set(auth(token))
    .send({
      customerId: ctx.customerId,
      paymentDate: '2026-09-20',
      paymentMethod: 'BANK',
      ...body,
    });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

// --- accounting read helpers -----------------------------------------------

async function accountsByCode(token) {
  const response = await request(app).get('/api/v1/accounts?limit=100').set(auth(token));
  return Object.fromEntries(response.body.data.map((account) => [account.code, account]));
}

/** The balance of one account, derived from the journal by the API itself. */
async function balanceOf(token, code) {
  const accounts = await accountsByCode(token);
  const response = await request(app)
    .get(`/api/v1/accounts/${accounts[code].id}`)
    .set(auth(token));
  return response.body.data.account.balance;
}

async function journalFor(token, sourceType, sourceId) {
  const response = await request(app)
    .get(`/api/v1/journal-entries/source/${sourceType}/${sourceId}`)
    .set(auth(token));
  return { status: response.status, entry: response.body.data?.journalEntry };
}

/** The amount a journal entry posted to one account code, on one side. */
function postedTo(entry, code, side) {
  const line = entry.lines.find((row) => row.account.code === code);
  return line ? line[side] : null;
}

const trialBalance = (token, query = '') =>
  request(app).get(`/api/v1/accounting/trial-balance${query}`).set(auth(token));
const profitAndLoss = (token, query = '') =>
  request(app).get(`/api/v1/accounting/profit-loss${query}`).set(auth(token));
const balanceSheet = (token, query = '') =>
  request(app).get(`/api/v1/accounting/balance-sheet${query}`).set(auth(token));

async function resetTransactions() {
  // The general ledger first: journal lines reference accounts.
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
  // System accounts survive: they belong to the company, not to a document.
  await prisma.account.updateMany({ data: { isActive: true } });
}

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('glalpha');
  companyB = await createCompanyWithUsers('glbeta');

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

// ---------------------------------------------------------------------------

describe('purchase posting writes a journal entry', () => {
  beforeEach(resetTransactions);

  it('debits inventory and input tax, credits accounts payable', async () => {
    const purchase = await postedPurchase(adminA, ctxA);

    const { status, entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    expect(status).toBe(200);
    expect(entry.status).toBe('POSTED');
    expect(entry.isBalanced).toBe(true);
    expect(entry.totalDebit).toBe('11800.00');
    expect(entry.totalCredit).toBe('11800.00');
    expect(postedTo(entry, '1300', 'debit')).toBe('10000.00');
    expect(postedTo(entry, '1500', 'debit')).toBe('1800.00');
    expect(postedTo(entry, '2000', 'credit')).toBe('11800.00');
  });

  it('matches the payable the sub-ledger raised, to the paisa', async () => {
    const purchase = await postedPurchase(adminA, ctxA);

    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    expect(postedTo(entry, '2000', 'credit')).toBe(payable.originalAmount);
    expect(payable.originalAmount).toBe(purchase.grandTotal);
  });

  it('values inventory at what the stock ledger actually recorded', async () => {
    const purchase = await postedPurchase(adminA, ctxA);

    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: 'PURCHASE', referenceId: purchase.id },
    });
    const moved = movements.reduce((sum, movement) => sum + Number(movement.totalCost), 0);

    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);
    expect(Number(postedTo(entry, '1300', 'debit'))).toBe(moved);
  });

  it('posts a purchase discount to the valuation adjustment account', async () => {
    // 100 @ 100 with a 10% line discount: stock is still capitalised at 10000,
    // but only 9000 is owed. The 1000 gap is a price variance, not a fudge.
    const purchase = await postedPurchase(adminA, ctxA, {
      items: [
        {
          productId: ctxA.productId,
          quantity: '100',
          unitCost: '100',
          discountType: 'PERCENTAGE',
          discountValue: '10',
        },
      ],
    });

    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1300', 'debit')).toBe('10000.00');
    expect(postedTo(entry, '2000', 'credit')).toBe('9000.00');
    expect(postedTo(entry, '5100', 'credit')).toBe('1000.00');
  });

  it('writes no journal entry for a draft', async () => {
    const draft = await draftPurchase(adminA, ctxA);

    const { status } = await journalFor(adminA, 'PURCHASE', draft.id);
    expect(status).toBe(404);
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('gives the entry a journal number and the document date', async () => {
    const purchase = await postedPurchase(adminA, ctxA, { invoiceDate: '2026-08-05' });

    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    expect(entry.journalNumber).toMatch(/^JV-2026-\d{6}$/);
    expect(entry.entryDate).toBe('2026-08-05');
    expect(entry.description).toContain(purchase.purchaseNumber);
  });
});

describe('purchase return posting writes a reversing journal entry', () => {
  beforeEach(resetTransactions);

  it('debits accounts payable and credits inventory', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const returned = await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    const { entry } = await journalFor(adminA, 'PURCHASE_RETURN', returned.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '2000', 'debit')).toBe('1000.00');
    expect(postedTo(entry, '1300', 'credit')).toBe('1000.00');
  });

  it('uses the same amount the operational return used', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const returned = await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '7' },
    ]);

    const { entry } = await journalFor(adminA, 'PURCHASE_RETURN', returned.id);
    expect(postedTo(entry, '2000', 'debit')).toBe(returned.grandTotal);
  });

  it('reduces the accounts payable balance by the credit', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    expect(await balanceOf(adminA, '2000')).toBe('11800.00');

    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    expect(await balanceOf(adminA, '2000')).toBe('10800.00');
  });
});

describe('supplier payment posting writes a journal entry', () => {
  beforeEach(resetTransactions);

  it('debits accounts payable and credits bank for an allocated payment', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);

    const payment = await postedSupplierPayment(adminA, ctxA, {
      amount: '5000',
      allocations: [{ payableId: payable.id, amount: '5000' }],
    });

    const { entry } = await journalFor(adminA, 'SUPPLIER_PAYMENT', payment.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '2000', 'debit')).toBe('5000.00');
    expect(postedTo(entry, '1010', 'credit')).toBe('5000.00');
    expect(await balanceOf(adminA, '2000')).toBe('6800.00');
  });

  it('books an unallocated payment as an advance to the supplier', async () => {
    await postedPurchase(adminA, ctxA);

    const payment = await postedSupplierPayment(adminA, ctxA, { amount: '2000' });

    const { entry } = await journalFor(adminA, 'SUPPLIER_PAYMENT', payment.id);

    expect(postedTo(entry, '1400', 'debit')).toBe('2000.00');
    expect(postedTo(entry, '1010', 'credit')).toBe('2000.00');
    expect(postedTo(entry, '2000', 'debit')).toBeNull();
  });

  it('sends a cash payment to cash, not to bank', async () => {
    await postedPurchase(adminA, ctxA);

    const payment = await postedSupplierPayment(adminA, ctxA, {
      amount: '1500',
      paymentMethod: 'CASH',
    });

    const { entry } = await journalFor(adminA, 'SUPPLIER_PAYMENT', payment.id);

    expect(postedTo(entry, '1000', 'credit')).toBe('1500.00');
    expect(postedTo(entry, '1010', 'credit')).toBeNull();
  });

  it('splits a part-allocated payment exactly as the sub-ledger did', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);

    const payment = await postedSupplierPayment(adminA, ctxA, {
      amount: '4000',
      allocations: [{ payableId: payable.id, amount: '2500' }],
    });

    const { entry } = await journalFor(adminA, 'SUPPLIER_PAYMENT', payment.id);

    expect(postedTo(entry, '2000', 'debit')).toBe(payment.allocatedAmount);
    expect(postedTo(entry, '1400', 'debit')).toBe(payment.unallocatedAmount);
    expect(postedTo(entry, '1010', 'credit')).toBe(payment.amount);
  });
});

describe('sales posting writes revenue and COGS in one entry', () => {
  beforeEach(resetTransactions);

  it('debits receivable, credits revenue and tax, debits COGS, credits inventory', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);

    const { entry } = await journalFor(adminA, 'SALES_INVOICE', sale.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1200', 'debit')).toBe('2360.00');
    expect(postedTo(entry, '4000', 'credit')).toBe('2000.00');
    expect(postedTo(entry, '2100', 'credit')).toBe('360.00');
    expect(postedTo(entry, '5000', 'debit')).toBe('1000.00');
    expect(postedTo(entry, '1300', 'credit')).toBe('1000.00');
  });

  it('uses the COGS frozen on the invoice, not a recalculated average', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);

    // A later purchase at a very different price moves the average to 150.
    await postedPurchase(adminA, ctxA, {
      items: [{ productId: ctxA.productId, quantity: '90', unitCost: '200' }],
    });

    const balance = await request(app)
      .get(`/api/v1/inventory/${ctxA.productId}/${ctxA.warehouseId}`)
      .set(auth(adminA));
    expect(balance.body.data.averageCost).not.toBe('100.0000');

    const { entry } = await journalFor(adminA, 'SALES_INVOICE', sale.id);

    // The historical COGS is untouched by what happened afterwards.
    expect(postedTo(entry, '5000', 'debit')).toBe('1000.00');
    expect(postedTo(entry, '5000', 'debit')).toBe(sale.cogsTotal);
  });

  it('matches the receivable the sub-ledger raised', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);

    const receivables = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const receivable = receivables.body.data.find((row) => row.salesInvoice.id === sale.id);

    const { entry } = await journalFor(adminA, 'SALES_INVOICE', sale.id);
    expect(postedTo(entry, '1200', 'debit')).toBe(receivable.originalAmount);
  });

  it('writes exactly one entry for both halves of the sale', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);

    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: 'SALES_INVOICE', sourceId: sale.id },
    });
    expect(entries).toHaveLength(1);
  });
});

describe('sales return posting reverses revenue and COGS', () => {
  beforeEach(resetTransactions);

  it('debits sales returns and tax, credits receivable, debits inventory', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    const returned = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const { entry } = await journalFor(adminA, 'SALES_RETURN', returned.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '4100', 'debit')).toBe('800.00');
    expect(postedTo(entry, '2100', 'debit')).toBe('144.00');
    expect(postedTo(entry, '1200', 'credit')).toBe('944.00');
    expect(postedTo(entry, '1300', 'debit')).toBe('400.00');
    expect(postedTo(entry, '5000', 'credit')).toBe('400.00');
  });

  it('reverses at the frozen cost even after the average has moved', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedPurchase(adminA, ctxA, {
      items: [{ productId: ctxA.productId, quantity: '90', unitCost: '200' }],
    });

    const returned = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const { entry } = await journalFor(adminA, 'SALES_RETURN', returned.id);

    // 4 * the frozen 100, not 4 * today's blended average.
    expect(postedTo(entry, '1300', 'debit')).toBe('400.00');
    expect(postedTo(entry, '5000', 'credit')).toBe('400.00');
    expect(postedTo(entry, '1300', 'debit')).toBe(returned.cogsTotal);
  });

  it('leaves the sales revenue account untouched, using contra-revenue instead', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    // Revenue still shows what was actually sold; the credit note is its own line.
    expect(await balanceOf(adminA, '4000')).toBe('2000.00');
    expect(await balanceOf(adminA, '4100')).toBe('-800.00');
  });
});

describe('customer payment posting writes a journal entry', () => {
  beforeEach(resetTransactions);

  it('debits bank and credits the receivable', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    const receivables = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const receivable = receivables.body.data.find((row) => row.salesInvoice.id === sale.id);

    const payment = await postedCustomerPayment(adminA, ctxA, {
      amount: '2360',
      allocations: [{ receivableId: receivable.id, amount: '2360' }],
    });

    const { entry } = await journalFor(adminA, 'CUSTOMER_PAYMENT', payment.id);

    expect(entry.isBalanced).toBe(true);
    expect(postedTo(entry, '1010', 'debit')).toBe('2360.00');
    expect(postedTo(entry, '1200', 'credit')).toBe('2360.00');
    expect(await balanceOf(adminA, '1200')).toBe('0.00');
  });

  it('books an unallocated receipt as a customer advance liability', async () => {
    const payment = await postedCustomerPayment(adminA, ctxA, { amount: '3000' });

    const { entry } = await journalFor(adminA, 'CUSTOMER_PAYMENT', payment.id);

    expect(postedTo(entry, '1010', 'debit')).toBe('3000.00');
    expect(postedTo(entry, '2200', 'credit')).toBe('3000.00');
    expect(await balanceOf(adminA, '2200')).toBe('3000.00');
  });

  it('agrees with the allocation the sub-ledger recorded', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    const receivables = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const receivable = receivables.body.data.find((row) => row.salesInvoice.id === sale.id);

    const payment = await postedCustomerPayment(adminA, ctxA, {
      amount: '2000',
      allocations: [{ receivableId: receivable.id, amount: '1500' }],
    });

    const { entry } = await journalFor(adminA, 'CUSTOMER_PAYMENT', payment.id);

    expect(postedTo(entry, '1200', 'credit')).toBe(payment.allocatedAmount);
    expect(postedTo(entry, '2200', 'credit')).toBe(payment.unallocatedAmount);
  });
});

describe('source traceability', () => {
  beforeEach(resetTransactions);

  it('links every posted document to the journal that explains it', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const purchaseReturn = await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '5' },
    ]);
    const sale = await postedSale(adminA, ctxA);
    const salesReturn = await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '2' },
    ]);
    const supplierPayment = await postedSupplierPayment(adminA, ctxA, { amount: '100' });
    const customerPayment = await postedCustomerPayment(adminA, ctxA, { amount: '100' });

    const expected = [
      ['PURCHASE', purchase.id],
      ['PURCHASE_RETURN', purchaseReturn.id],
      ['SALES_INVOICE', sale.id],
      ['SALES_RETURN', salesReturn.id],
      ['SUPPLIER_PAYMENT', supplierPayment.id],
      ['CUSTOMER_PAYMENT', customerPayment.id],
    ];

    for (const [sourceType, sourceId] of expected) {
      const { status, entry } = await journalFor(adminA, sourceType, sourceId);
      expect(`${sourceType}:${status}`).toBe(`${sourceType}:200`);
      expect(entry.sourceType).toBe(sourceType);
      expect(entry.sourceId).toBe(sourceId);
      expect(entry.isBalanced).toBe(true);
    }
  });

  it('finds a document journal by filtering the entry list', async () => {
    const purchase = await postedPurchase(adminA, ctxA);

    const response = await request(app)
      .get(`/api/v1/journal-entries?sourceType=PURCHASE&sourceId=${purchase.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].sourceId).toBe(purchase.id);
  });

  it('filters the general ledger by source document', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);

    const response = await request(app)
      .get(`/api/v1/general-ledger?sourceType=SALES_INVOICE&sourceId=${sale.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((line) => line.sourceId === sale.id)).toBe(true);
  });
});

describe('account ledgers', () => {
  beforeEach(resetTransactions);

  it('shows every movement of one account with a running balance', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);

    const accounts = await accountsByCode(adminA);
    const response = await request(app)
      .get(`/api/v1/accounts/${accounts['2000'].id}/ledger`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const { ledger } = response.body.data;
    expect(ledger.normalBalance).toBe('CREDIT');
    expect(ledger.entries).toHaveLength(2);
    // Credit-normal: the purchase raises the balance, the return reduces it.
    expect(ledger.entries[0].balance).toBe('11800.00');
    expect(ledger.entries[1].balance).toBe('10800.00');
    expect(ledger.closingBalance).toBe('10800.00');
  });

  it('keeps history before a date range as the opening balance', async () => {
    await postedPurchase(adminA, ctxA, { invoiceDate: '2026-08-01' });
    await postedPurchase(adminA, ctxA, { invoiceDate: '2026-09-01' });

    const accounts = await accountsByCode(adminA);
    const response = await request(app)
      .get(`/api/v1/accounts/${accounts['2000'].id}/ledger?dateFrom=2026-09-01`)
      .set(auth(adminA));

    const { ledger } = response.body.data;
    expect(ledger.openingBalance).toBe('11800.00');
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.closingBalance).toBe('23600.00');
  });
});

describe('trial balance', () => {
  beforeEach(resetTransactions);

  it('always balances, and says so', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '5' },
    ]);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '3' },
    ]);
    await postedSupplierPayment(adminA, ctxA, { amount: '1000' });
    await postedCustomerPayment(adminA, ctxA, { amount: '500' });

    const response = await trialBalance(adminA);

    expect(response.status).toBe(200);
    const { trialBalance: tb } = response.body.data;
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.difference).toBe('0.00');
    expect(tb.accounts.length).toBeGreaterThan(0);
  });

  it('is empty and balanced when nothing has been posted', async () => {
    const response = await trialBalance(adminA);

    expect(response.body.data.trialBalance.accounts).toHaveLength(0);
    expect(response.body.data.trialBalance.totalDebit).toBe('0.00');
    expect(response.body.data.trialBalance.isBalanced).toBe(true);
  });

  it('respects an as-of date', async () => {
    await postedPurchase(adminA, ctxA, { invoiceDate: '2026-08-01' });
    await postedSale(adminA, ctxA, { invoiceDate: '2026-09-01' });

    const august = await trialBalance(adminA, '?date=2026-08-31');
    const september = await trialBalance(adminA, '?date=2026-09-30');

    const augustCodes = august.body.data.trialBalance.accounts.map((row) => row.code);
    const septemberCodes = september.body.data.trialBalance.accounts.map((row) => row.code);

    expect(augustCodes).toContain('2000');
    // The sale had not happened yet on 31 August.
    expect(augustCodes).not.toContain('4000');
    expect(septemberCodes).toContain('4000');
    expect(august.body.data.trialBalance.isBalanced).toBe(true);
    expect(september.body.data.trialBalance.isBalanced).toBe(true);
  });

  it('reports each account in its natural direction', async () => {
    await postedPurchase(adminA, ctxA);

    const response = await trialBalance(adminA);
    const byCode = Object.fromEntries(
      response.body.data.trialBalance.accounts.map((row) => [row.code, row]),
    );

    expect(byCode['1300'].debit).toBe('10000.00');
    expect(byCode['1300'].balance).toBe('10000.00');
    expect(byCode['2000'].credit).toBe('11800.00');
    // Credit-normal, so a credit balance is reported positive.
    expect(byCode['2000'].balance).toBe('11800.00');
  });
});

describe('profit and loss', () => {
  beforeEach(resetTransactions);

  it('computes revenue less returns less cost of goods sold', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const response = await profitAndLoss(adminA);

    expect(response.status).toBe(200);
    const pl = response.body.data.profitAndLoss;
    expect(pl.revenue.total).toBe('2000.00');
    expect(pl.salesReturns.total).toBe('800.00');
    expect(pl.netRevenue).toBe('1200.00');
    expect(pl.costOfGoodsSold.total).toBe('600.00');
    expect(pl.grossProfit).toBe('600.00');
    expect(pl.netProfit).toBe('600.00');
  });

  it('excludes tax from revenue', async () => {
    await postedPurchase(adminA, ctxA);
    await postedSale(adminA, ctxA);

    const pl = (await profitAndLoss(adminA)).body.data.profitAndLoss;

    // The invoice was 2360; 360 of that is tax owed to the authority, not income.
    expect(pl.revenue.total).toBe('2000.00');
  });

  it('counts a purchase discount as a reduction of cost', async () => {
    await postedPurchase(adminA, ctxA, {
      items: [
        {
          productId: ctxA.productId,
          quantity: '100',
          unitCost: '100',
          discountType: 'PERCENTAGE',
          discountValue: '10',
        },
      ],
    });

    const pl = (await profitAndLoss(adminA)).body.data.profitAndLoss;

    // The variance account is an expense with a credit balance: negative cost.
    expect(pl.otherExpenses.total).toBe('-1000.00');
    expect(pl.netProfit).toBe('1000.00');
  });

  it('respects a date range', async () => {
    await postedPurchase(adminA, ctxA, { invoiceDate: '2026-08-01' });
    await postedSale(adminA, ctxA, { invoiceDate: '2026-09-01' });

    const august = await profitAndLoss(adminA, '?from=2026-08-01&to=2026-08-31');
    const september = await profitAndLoss(adminA, '?from=2026-09-01&to=2026-09-30');

    expect(august.body.data.profitAndLoss.revenue.total).toBe('0.00');
    expect(september.body.data.profitAndLoss.revenue.total).toBe('2000.00');
    expect(september.body.data.profitAndLoss.costOfGoodsSold.total).toBe('1000.00');
  });

  it('rejects a range that ends before it starts', async () => {
    const response = await profitAndLoss(adminA, '?from=2026-09-30&to=2026-09-01');
    expect(response.status).toBe(400);
  });
});

describe('balance sheet', () => {
  beforeEach(resetTransactions);

  it('balances assets against liabilities plus equity', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const response = await balanceSheet(adminA);

    expect(response.status).toBe(200);
    const bs = response.body.data.balanceSheet;

    // Inventory 9400 + input tax 1800 + receivable 1416.
    expect(bs.assets.total).toBe('12616.00');
    // Payable 11800 + tax payable 216.
    expect(bs.liabilities.total).toBe('12016.00');
    // No capital has been introduced; all equity is earnings so far.
    expect(bs.equity.capital).toBe('0.00');
    expect(bs.equity.retainedEarnings).toBe('600.00');
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
    expect(bs.isBalanced).toBe(true);
  });

  it('still balances after payments have moved money around', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);

    await postedSupplierPayment(adminA, ctxA, {
      amount: '6000',
      allocations: [{ payableId: payable.id, amount: '5000' }],
    });
    await postedSale(adminA, ctxA);
    await postedCustomerPayment(adminA, ctxA, { amount: '1000' });

    const bs = (await balanceSheet(adminA)).body.data.balanceSheet;

    expect(bs.isBalanced).toBe(true);
    expect(bs.difference).toBe('0.00');
  });

  it('respects an as-of date', async () => {
    await postedPurchase(adminA, ctxA, { invoiceDate: '2026-08-01' });
    await postedSale(adminA, ctxA, { invoiceDate: '2026-09-01' });

    const august = (await balanceSheet(adminA, '?date=2026-08-31')).body.data.balanceSheet;

    expect(august.equity.retainedEarnings).toBe('0.00');
    expect(august.assets.total).toBe('11800.00');
    expect(august.isBalanced).toBe(true);
  });

  it('balances when nothing has been posted', async () => {
    const bs = (await balanceSheet(adminA)).body.data.balanceSheet;

    expect(bs.totalAssets).toBe('0.00');
    expect(bs.totalLiabilitiesAndEquity).toBe('0.00');
    expect(bs.isBalanced).toBe(true);
  });
});

describe('sub-ledger to general ledger reconciliation', () => {
  beforeEach(resetTransactions);

  it('reconciles accounts payable with the supplier sub-ledger', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '10' },
    ]);
    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);
    await postedSupplierPayment(adminA, ctxA, {
      amount: '3000',
      allocations: [{ payableId: payable.id, amount: '3000' }],
    });

    const after = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const subLedgerOutstanding = after.body.data.reduce(
      (sum, row) => sum + Number(row.outstandingAmount),
      0,
    );

    expect(Number(await balanceOf(adminA, '2000'))).toBe(subLedgerOutstanding);
  });

  it('reconciles accounts receivable with the customer sub-ledger', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);
    const receivables = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const receivable = receivables.body.data.find((row) => row.salesInvoice.id === sale.id);
    await postedCustomerPayment(adminA, ctxA, {
      amount: '400',
      allocations: [{ receivableId: receivable.id, amount: '400' }],
    });

    const after = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const subLedgerOutstanding = after.body.data.reduce(
      (sum, row) => sum + Number(row.outstandingAmount),
      0,
    );

    expect(Number(await balanceOf(adminA, '1200'))).toBe(subLedgerOutstanding);
  });

  it('keeps a credit note applied when the invoice is later part-paid', async () => {
    // Regression: recomputing outstanding as (original - paid) after a payment
    // silently erased an earlier sales return credit, which put the receivable
    // sub-ledger permanently out of step with the AR control account.
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);

    const receivables = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const receivable = receivables.body.data.find((row) => row.salesInvoice.id === sale.id);
    expect(receivable.outstandingAmount).toBe('1416.00');

    await postedCustomerPayment(adminA, ctxA, {
      amount: '400',
      allocations: [{ receivableId: receivable.id, amount: '400' }],
    });

    const after = await request(app)
      .get('/api/v1/customer-receivables?limit=100')
      .set(auth(adminA));
    const updated = after.body.data.find((row) => row.salesInvoice.id === sale.id);

    // 2360 - 944 credited - 400 paid.
    expect(updated.creditAmount).toBe('944.00');
    expect(updated.paidAmount).toBe('400.00');
    expect(updated.outstandingAmount).toBe('1016.00');
    expect(await balanceOf(adminA, '1200')).toBe('1016.00');
  });

  it('reconciles inventory with the stock ledger when costs are uniform', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);
    await postedSalesReturn(adminA, sale, [
      { salesInvoiceItemId: sale.items[0].id, quantity: '4' },
    ]);
    await postedPurchaseReturn(adminA, purchase, [
      { purchaseItemId: purchase.items[0].id, quantity: '5' },
    ]);

    const balances = await request(app)
      .get('/api/v1/inventory?limit=100')
      .set(auth(adminA));
    const stockValue = balances.body.data.reduce(
      (sum, row) => sum + Number(row.inventoryValue),
      0,
    );

    expect(Number(await balanceOf(adminA, '1300'))).toBe(stockValue);
  });

  it('quantifies the Phase 5 residue instead of hiding it', async () => {
    // Two purchases at different prices blend the average to 150. Returning
    // goods from the FIRST purchase removes them at their original 100, which is
    // correct for the supplier but leaves the remaining stock valued at 150.
    // The gap is real, and this test measures it rather than pretending it is zero.
    const first = await postedPurchase(adminA, ctxA, {
      items: [{ productId: ctxA.productId, quantity: '100', unitCost: '100' }],
    });
    await postedPurchase(adminA, ctxA, {
      items: [{ productId: ctxA.productId, quantity: '100', unitCost: '200' }],
    });
    await postedPurchaseReturn(adminA, first, [
      { purchaseItemId: first.items[0].id, quantity: '5' },
    ]);

    const balances = await request(app)
      .get('/api/v1/inventory?limit=100')
      .set(auth(adminA));
    const stockValue = balances.body.data.reduce(
      (sum, row) => sum + Number(row.inventoryValue),
      0,
    );
    const controlAccount = Number(await balanceOf(adminA, '1300'));

    // 195 units at the blended 150 = 29250. The control account says
    // 10000 + 20000 - 500 = 29500. The 250 gap is 5 units * (150 - 100).
    expect(stockValue).toBe(29250);
    expect(controlAccount).toBe(29500);
    expect(controlAccount - stockValue).toBe(250);
  });

  it('keeps the ledger balanced despite that residue', async () => {
    const first = await postedPurchase(adminA, ctxA, {
      items: [{ productId: ctxA.productId, quantity: '100', unitCost: '100' }],
    });
    await postedPurchase(adminA, ctxA, {
      items: [{ productId: ctxA.productId, quantity: '100', unitCost: '200' }],
    });
    await postedPurchaseReturn(adminA, first, [
      { purchaseItemId: first.items[0].id, quantity: '5' },
    ]);

    const tb = (await trialBalance(adminA)).body.data.trialBalance;
    const bs = (await balanceSheet(adminA)).body.data.balanceSheet;

    expect(tb.isBalanced).toBe(true);
    expect(bs.isBalanced).toBe(true);
  });
});

describe('GL concurrency and idempotency', () => {
  beforeEach(resetTransactions);

  it('writes exactly one journal entry when a purchase is posted five times at once', async () => {
    const draft = await draftPurchase(adminA, ctxA);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/v1/purchases/${draft.id}/post`).set(auth(adminA)),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);

    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: 'PURCHASE', sourceId: draft.id },
    });
    expect(entries).toHaveLength(1);

    const lines = await prisma.journalLine.count({ where: { journalEntryId: entries[0].id } });
    expect(lines).toBe(3);
    expect(await balanceOf(adminA, '2000')).toBe('11800.00');
  });

  it('writes exactly one journal entry when a sale is posted concurrently', async () => {
    await postedPurchase(adminA, ctxA);

    const created = await request(app)
      .post('/api/v1/sales')
      .set(auth(adminA))
      .send({
        customerId: ctxA.customerId,
        warehouseId: ctxA.warehouseId,
        invoiceDate: '2026-09-01',
        items: [{ productId: ctxA.productId, taxId: ctxA.taxId, quantity: '10', unitPrice: '200' }],
      });

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post(`/api/v1/sales/${created.body.data.sale.id}/post`).set(auth(adminA)),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: 'SALES_INVOICE', sourceId: created.body.data.sale.id },
      }),
    ).toBe(1);
    expect(await balanceOf(adminA, '5000')).toBe('1000.00');
  });

  it('gives concurrent postings of different documents distinct journal numbers', async () => {
    const drafts = await Promise.all([
      draftPurchase(adminA, ctxA),
      draftPurchase(adminA, ctxA),
      draftPurchase(adminA, ctxA),
    ]);

    const results = await Promise.all(
      drafts.map((draft) =>
        request(app).post(`/api/v1/purchases/${draft.id}/post`).set(auth(adminA)),
      ),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);

    const entries = await prisma.journalEntry.findMany({
      where: { companyId: companyA.company.id },
      select: { journalNumber: true },
    });
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.journalNumber)).size).toBe(3);
  });

  it('keeps a concurrent payment to exactly one journal entry', async () => {
    await postedPurchase(adminA, ctxA);
    const created = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        paymentDate: '2026-08-20',
        paymentMethod: 'CASH',
        amount: '1000',
      });

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
          .set(auth(adminA)),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await prisma.journalEntry.count({ where: { sourceType: 'SUPPLIER_PAYMENT' } }),
    ).toBe(1);
    expect(await balanceOf(adminA, '1000')).toBe('-1000.00');
  });
});

describe('a failing journal rolls the whole posting back', () => {
  beforeEach(resetTransactions);

  /** Breaks the GL for one account, without going through the protected API. */
  const breakAccount = (code) =>
    prisma.account.updateMany({
      where: { companyId: companyA.company.id, code },
      data: { isActive: false },
    });

  it('leaves a purchase as a draft, with no stock and no payable', async () => {
    const draft = await draftPurchase(adminA, ctxA);
    await breakAccount('1500');

    const response = await request(app)
      .post(`/api/v1/purchases/${draft.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_INACTIVE');

    const purchase = await prisma.purchase.findUnique({ where: { id: draft.id } });
    expect(purchase.status).toBe('DRAFT');
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.inventoryBalance.count()).toBe(0);
    expect(await prisma.supplierPayable.count()).toBe(0);
    expect(await prisma.supplierLedgerEntry.count()).toBe(0);
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('leaves a sale as a draft, with stock and the receivable untouched', async () => {
    await postedPurchase(adminA, ctxA);
    const stockBefore = await prisma.inventoryBalance.findFirst({
      where: { productId: ctxA.productId },
    });

    const created = await request(app)
      .post('/api/v1/sales')
      .set(auth(adminA))
      .send({
        customerId: ctxA.customerId,
        warehouseId: ctxA.warehouseId,
        invoiceDate: '2026-09-01',
        items: [{ productId: ctxA.productId, taxId: ctxA.taxId, quantity: '10', unitPrice: '200' }],
      });

    await breakAccount('2100');

    const response = await request(app)
      .post(`/api/v1/sales/${created.body.data.sale.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_INACTIVE');

    const sale = await prisma.salesInvoice.findUnique({
      where: { id: created.body.data.sale.id },
    });
    expect(sale.status).toBe('DRAFT');
    expect(sale.cogsTotal.toString()).toBe('0');

    const stockAfter = await prisma.inventoryBalance.findFirst({
      where: { productId: ctxA.productId },
    });
    expect(stockAfter.quantity.toString()).toBe(stockBefore.quantity.toString());
    expect(await prisma.customerReceivable.count()).toBe(0);
    expect(await prisma.customerLedgerEntry.count()).toBe(0);
    expect(
      await prisma.journalEntry.count({ where: { sourceType: 'SALES_INVOICE' } }),
    ).toBe(0);
  });

  it('leaves a sales return unposted, with no credit and no stock back', async () => {
    await postedPurchase(adminA, ctxA);
    const sale = await postedSale(adminA, ctxA);

    const created = await request(app)
      .post('/api/v1/sales-returns')
      .set(auth(adminA))
      .send({
        salesInvoiceId: sale.id,
        returnDate: '2026-09-10',
        items: [{ salesInvoiceItemId: sale.items[0].id, quantity: '4' }],
      });

    const stockBefore = await prisma.inventoryBalance.findFirst({
      where: { productId: ctxA.productId },
    });
    await breakAccount('4100');

    const response = await request(app)
      .post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);

    const salesReturn = await prisma.salesReturn.findUnique({
      where: { id: created.body.data.salesReturn.id },
    });
    expect(salesReturn.status).toBe('DRAFT');

    const stockAfter = await prisma.inventoryBalance.findFirst({
      where: { productId: ctxA.productId },
    });
    expect(stockAfter.quantity.toString()).toBe(stockBefore.quantity.toString());

    const receivable = await prisma.customerReceivable.findFirst({
      where: { salesInvoiceId: sale.id },
    });
    expect(receivable.creditAmount.toString()).toBe('0');
    expect(await prisma.journalEntry.count({ where: { sourceType: 'SALES_RETURN' } })).toBe(0);
  });

  it('leaves a supplier payment unposted, with the payable untouched', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const payables = await request(app)
      .get('/api/v1/supplier-payables?limit=100')
      .set(auth(adminA));
    const payable = payables.body.data.find((row) => row.purchase.id === purchase.id);

    const created = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: ctxA.supplierId,
        paymentDate: '2026-08-20',
        paymentMethod: 'CASH',
        amount: '5000',
        allocations: [{ payableId: payable.id, amount: '5000' }],
      });

    await breakAccount('1000');

    const response = await request(app)
      .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);

    const payment = await prisma.supplierPayment.findUnique({
      where: { id: created.body.data.payment.id },
    });
    expect(payment.status).toBe('DRAFT');

    const after = await prisma.supplierPayable.findUnique({ where: { id: payable.id } });
    expect(after.paidAmount.toString()).toBe('0');
    expect(after.outstandingAmount.toString()).toBe('11800');
    expect(
      await prisma.journalEntry.count({ where: { sourceType: 'SUPPLIER_PAYMENT' } }),
    ).toBe(0);
  });

  it('posts normally again once the account is active', async () => {
    const draft = await draftPurchase(adminA, ctxA);
    await breakAccount('1500');

    const failed = await request(app)
      .post(`/api/v1/purchases/${draft.id}/post`)
      .set(auth(adminA));
    expect(failed.status).toBe(422);

    await prisma.account.updateMany({
      where: { companyId: companyA.company.id, code: '1500' },
      data: { isActive: true },
    });

    const retried = await request(app)
      .post(`/api/v1/purchases/${draft.id}/post`)
      .set(auth(adminA));

    expect(retried.status).toBe(200);
    expect((await journalFor(adminA, 'PURCHASE', draft.id)).status).toBe(200);
  });
});

describe('journal reversal', () => {
  beforeEach(resetTransactions);

  it('creates a new entry with every side swapped, and never touches the original', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const { entry: original } = await journalFor(adminA, 'PURCHASE', purchase.id);

    const response = await request(app)
      .post(`/api/v1/journal-entries/${original.id}/reverse`)
      .set(auth(adminA))
      .send({});

    expect(response.status).toBe(201);
    const reversal = response.body.data.journalEntry;

    expect(reversal.sourceType).toBe('REVERSAL');
    expect(reversal.sourceId).toBe(original.id);
    expect(reversal.reversalOf.id).toBe(original.id);
    expect(reversal.isBalanced).toBe(true);
    expect(postedTo(reversal, '1300', 'credit')).toBe('10000.00');
    expect(postedTo(reversal, '2000', 'debit')).toBe('11800.00');

    // The original is byte-for-byte what it was.
    const { entry: after } = await journalFor(adminA, 'PURCHASE', purchase.id);
    expect(after.totalDebit).toBe(original.totalDebit);
    expect(after.lines).toEqual(original.lines);
    expect(after.reversedBy.id).toBe(reversal.id);
  });

  it('nets the account back to zero', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    await request(app)
      .post(`/api/v1/journal-entries/${entry.id}/reverse`)
      .set(auth(adminA))
      .send({});

    expect(await balanceOf(adminA, '2000')).toBe('0.00');
    expect(await balanceOf(adminA, '1300')).toBe('0.00');
    expect((await trialBalance(adminA)).body.data.trialBalance.isBalanced).toBe(true);
  });

  it('is idempotent: a second reversal is refused', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    const first = await request(app)
      .post(`/api/v1/journal-entries/${entry.id}/reverse`)
      .set(auth(adminA))
      .send({});
    const second = await request(app)
      .post(`/api/v1/journal-entries/${entry.id}/reverse`)
      .set(auth(adminA))
      .send({});

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('JOURNAL_ENTRY_ALREADY_REVERSED');
    expect(await prisma.journalEntry.count({ where: { sourceType: 'REVERSAL' } })).toBe(1);
  });

  it('produces exactly one reversal under concurrent requests', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/v1/journal-entries/${entry.id}/reverse`)
          .set(auth(adminA))
          .send({}),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'REVERSAL' } })).toBe(1);
  });

  it('refuses to reverse a reversal', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    const reversal = await request(app)
      .post(`/api/v1/journal-entries/${entry.id}/reverse`)
      .set(auth(adminA))
      .send({});

    const again = await request(app)
      .post(`/api/v1/journal-entries/${reversal.body.data.journalEntry.id}/reverse`)
      .set(auth(adminA))
      .send({});

    expect(again.status).toBe(422);
    expect(again.body.code).toBe('JOURNAL_ENTRY_IS_REVERSAL');
  });

  it('is refused to STAFF and to another company', async () => {
    const purchase = await postedPurchase(adminA, ctxA);
    const { entry } = await journalFor(adminA, 'PURCHASE', purchase.id);

    const byStaff = await request(app)
      .post(`/api/v1/journal-entries/${entry.id}/reverse`)
      .set(auth(staffA))
      .send({});
    const byOtherCompany = await request(app)
      .post(`/api/v1/journal-entries/${entry.id}/reverse`)
      .set(auth(adminB))
      .send({});

    expect(byStaff.status).toBe(403);
    expect(byOtherCompany.status).toBe(404);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'REVERSAL' } })).toBe(0);
  });
});

describe('general ledger tenant isolation', () => {
  beforeEach(resetTransactions);

  it("never shows another company's journal entries or balances", async () => {
    const purchaseA = await postedPurchase(adminA, ctxA);
    await postedPurchase(adminB, ctxB);

    const listedByB = await request(app)
      .get('/api/v1/journal-entries?limit=100')
      .set(auth(adminB));
    expect(listedByB.body.data.map((e) => e.sourceId)).not.toContain(purchaseA.id);

    const { entry } = await journalFor(adminA, 'PURCHASE', purchaseA.id);
    const readByB = await request(app)
      .get(`/api/v1/journal-entries/${entry.id}`)
      .set(auth(adminB));
    expect(readByB.status).toBe(404);

    const sourceByB = await journalFor(adminB, 'PURCHASE', purchaseA.id);
    expect(sourceByB.status).toBe(404);
  });

  it('keeps each company trial balance and statements independent', async () => {
    await postedPurchase(adminA, ctxA);

    const tbA = (await trialBalance(adminA)).body.data.trialBalance;
    const tbB = (await trialBalance(adminB)).body.data.trialBalance;

    expect(tbA.totalDebit).toBe('11800.00');
    expect(tbB.totalDebit).toBe('0.00');
    expect(tbA.isBalanced).toBe(true);
    expect(tbB.isBalanced).toBe(true);
  });

  it('scopes the general ledger listing to the caller company', async () => {
    await postedPurchase(adminA, ctxA);
    await postedPurchase(adminB, ctxB);

    const linesA = await request(app)
      .get('/api/v1/general-ledger?limit=100')
      .set(auth(adminA));

    const accountsB = await accountsByCode(adminB);
    const bAccountIds = new Set(Object.values(accountsB).map((account) => account.id));

    expect(linesA.body.data.length).toBeGreaterThan(0);
    expect(linesA.body.data.every((line) => !bAccountIds.has(line.account.id))).toBe(true);
  });

  it('refuses to read a ledger for an account of another company', async () => {
    const accountsB = await accountsByCode(adminB);

    const response = await request(app)
      .get(`/api/v1/accounts/${accountsB['1300'].id}/ledger`)
      .set(auth(adminA));

    expect(response.status).toBe(404);
  });
});

describe('general ledger summary', () => {
  beforeEach(resetTransactions);

  it('totals every account and balances overall', async () => {
    await postedPurchase(adminA, ctxA);
    await postedSale(adminA, ctxA);

    const response = await request(app)
      .get('/api/v1/general-ledger/summary')
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const { summary } = response.body.data;
    expect(summary.isBalanced).toBe(true);
    expect(summary.totalDebit).toBe(summary.totalCredit);

    const byCode = Object.fromEntries(summary.accounts.map((row) => [row.code, row]));
    expect(byCode['1300'].debit).toBe('10000.00');
    expect(byCode['1300'].credit).toBe('1000.00');
    expect(byCode['1300'].balance).toBe('9000.00');
  });

  it('narrows to a single account without claiming that slice balances', async () => {
    await postedPurchase(adminA, ctxA);
    const accounts = await accountsByCode(adminA);

    const response = await request(app)
      .get(`/api/v1/general-ledger/summary?accountId=${accounts['2000'].id}`)
      .set(auth(adminA));

    expect(response.body.data.summary.accounts).toHaveLength(1);
    expect(response.body.data.summary.accounts[0].code).toBe('2000');
    expect(response.body.data.summary.isBalanced).toBeNull();
  });
});
