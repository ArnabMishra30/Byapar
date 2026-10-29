import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { app } from '../../src/app.js';
import {
  resetDatabase,
  createCompanyWithUsers,
  createPlatformUser,
  login,
} from '../helpers/db.js';

// THE UNIFIED PARTY STATEMENT.
//
// What these tests hold the feature to:
//   - a party is created without choosing a type, and an owner's party is both a
//     customer and a supplier at once;
//   - the same party trades in both directions, and the statement shows one
//     merged ledger with TWO independent running balances;
//   - a receipt moves only the receivable, a supplier payment only the payable,
//     and nothing nets one against the other;
//   - returns, partial payments, drafts and date windows behave correctly;
//   - the PDF and Excel downloads carry the same authoritative figures;
//   - one company can never read another's statement.

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let companyA;
let adminA;
let adminB;
let platformToken;
let ctx;
let seq = 0;

async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `StmtCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `StmtUnit ${suffix}`, shortCode: `ST${suffix}` });
  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `Stmt Product ${suffix}`,
      sku: `STSKU-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
      sellingPrice: '120',
    });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Stmt WH ${suffix}`, code: `SW${suffix}` });

  return {
    productId: product.body.data.product.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

/** A fresh party (no type chosen) - an owner's party is created as BOTH. */
async function createParty(token, name) {
  const response = await request(app).post('/api/v1/parties').set(auth(token)).send({ name });
  expect(response.status).toBe(201);
  return response.body.data.party;
}

async function postPurchase(token, { supplierId, quantity, unitCost, invoiceDate }) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `SB-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`,
      invoiceDate,
      items: [{ productId: ctx.productId, quantity, unitCost }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

async function postSale(token, { customerId, quantity, unitPrice, invoiceDate }) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate,
      items: [{ productId: ctx.productId, quantity, unitPrice }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/sales/${created.body.data.sale.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

async function draftSale(token, { customerId, quantity, unitPrice, invoiceDate }) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate,
      items: [{ productId: ctx.productId, quantity, unitPrice }],
    });
  expect(created.status).toBe(201);
  return created.body.data.sale;
}

async function receivableIdFor(token, saleId) {
  const response = await request(app)
    .get('/api/v1/customer-receivables?limit=100')
    .set(auth(token));
  return response.body.data.find((r) => r.salesInvoice.id === saleId)?.id;
}

async function payableIdFor(token, purchaseId) {
  const response = await request(app)
    .get('/api/v1/supplier-payables?limit=100')
    .set(auth(token));
  return response.body.data.find((p) => p.purchase.id === purchaseId)?.id;
}

async function postReceipt(token, { customerId, amount, receivableId, paymentDate }) {
  const created = await request(app)
    .post('/api/v1/customer-payments')
    .set(auth(token))
    .send({
      customerId,
      paymentDate,
      amount,
      paymentMethod: 'CASH',
      allocations: [{ receivableId, amount }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

async function postSupplierPayment(token, { supplierId, amount, payableId, paymentDate }) {
  const created = await request(app)
    .post('/api/v1/supplier-payments')
    .set(auth(token))
    .send({
      supplierId,
      paymentDate,
      amount,
      paymentMethod: 'CASH',
      allocations: [{ payableId, amount }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.payment;
}

async function postSalesReturn(token, { sale, quantity, returnDate }) {
  const created = await request(app)
    .post('/api/v1/sales-returns')
    .set(auth(token))
    .send({
      salesInvoiceId: sale.id,
      returnDate,
      items: [{ salesInvoiceItemId: sale.items[0].id, quantity }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.salesReturn;
}

async function postPurchaseReturn(token, { purchase, quantity, returnDate }) {
  const created = await request(app)
    .post('/api/v1/purchase-returns')
    .set(auth(token))
    .send({
      purchaseId: purchase.id,
      returnDate,
      items: [{ purchaseItemId: purchase.items[0].id, quantity }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/purchase-returns/${created.body.data.purchaseReturn.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchaseReturn;
}

const getStatement = (token, partyId, qs = '') =>
  request(app).get(`/api/v1/parties/${partyId}/statement${qs}`).set(auth(token));

function downloadBinary(token, url) {
  return request(app)
    .get(url)
    .set(auth(token))
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

beforeAll(async () => {
  await resetDatabase();
  companyA = await createCompanyWithUsers('stmta');
  const companyBData = await createCompanyWithUsers('stmtb');
  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  adminB = await login(app, companyBData.admin.email, companyBData.adminPassword);
  const platform = await createPlatformUser({ email: 'stmt-platform@example.com' });
  platformToken = await login(app, 'stmt-platform@example.com', platform.password);
  ctx = await prepareCompany(adminA, 'A');
}, 30000);

describe('unified party creation', () => {
  it('creates a party with no type chosen as BOTH a customer and a supplier', async () => {
    const party = await createParty(adminA, 'Unified Abdulla');
    expect(party.relationship).toBe('BOTH');
    expect(party.isCustomer).toBe(true);
    expect(party.isSupplier).toBe(true);
    expect(party.customerId).toBeTruthy();
    expect(party.supplierId).toBeTruthy();
  });

  it('still honours an explicit relationship for the old callers', async () => {
    const response = await request(app)
      .post('/api/v1/parties')
      .set(auth(adminA))
      .send({ name: 'Customer Only Party', relationship: 'CUSTOMER' });
    expect(response.status).toBe(201);
    expect(response.body.data.party.relationship).toBe('CUSTOMER');
    expect(response.body.data.party.supplierId).toBeNull();
  });
});

describe('a party that trades in both directions', () => {
  let party;

  beforeAll(async () => {
    party = await createParty(adminA, 'Two Way Trader');
    const purchase = await postPurchase(adminA, {
      supplierId: party.supplierId,
      quantity: '100',
      unitCost: '50',
      invoiceDate: '2026-08-01',
    });
    const sale = await postSale(adminA, {
      customerId: party.customerId,
      quantity: '10',
      unitPrice: '120',
      invoiceDate: '2026-09-01',
    });
    const receivableId = await receivableIdFor(adminA, sale.id);
    await postReceipt(adminA, {
      customerId: party.customerId,
      amount: '500',
      receivableId,
      paymentDate: '2026-09-05',
    });
    const payableId = await payableIdFor(adminA, purchase.id);
    await postSupplierPayment(adminA, {
      supplierId: party.supplierId,
      amount: '2000',
      payableId,
      paymentDate: '2026-09-10',
    });
  }, 30000);

  it('merges both sub-ledgers into one chronological statement', async () => {
    const response = await getStatement(adminA, party.id);
    expect(response.status).toBe(200);
    const { lines, summary } = response.body.data;

    expect(lines.map((l) => l.kind)).toEqual(['PURCHASE', 'SALE', 'RECEIPT', 'PAYMENT']);
    expect(summary.entryCount).toBe(4);
  });

  it('keeps the receivable and the payable independent and never nets them', async () => {
    const { data } = (await getStatement(adminA, party.id)).body;

    // Sale 1200, receipt 500 -> they owe 700. Purchase 5000, payment 2000 -> we owe 3000.
    expect(data.summary.closingReceivable).toBe('700.00');
    expect(data.summary.closingPayable).toBe('3000.00');

    const receipt = data.lines.find((l) => l.kind === 'RECEIPT');
    // The receipt moved the receivable down to 700 but left the payable untouched
    // at the 5000 it was before any supplier payment - proof nothing is netted.
    expect(receipt.receivableBalance).toBe('700.00');
    expect(receipt.payableBalance).toBe('5000.00');

    const payment = data.lines.find((l) => l.kind === 'PAYMENT');
    expect(payment.receivableBalance).toBe('700.00');
    expect(payment.payableBalance).toBe('3000.00');
  });

  it('carries per-document item detail and payment status', async () => {
    const { data } = (await getStatement(adminA, party.id)).body;
    const sale = data.lines.find((l) => l.kind === 'SALE');

    expect(sale.paymentStatus).toBe('PARTIAL');
    // Txn Balance is the transaction's OWN amount at posting (1200), not the
    // live outstanding - that is reported distinctly as currentOutstanding (700).
    expect(sale.txnBalance).toBe('1200.00');
    expect(sale.currentOutstanding).toBe('700.00');
    expect(sale.document.items).toHaveLength(1);
    expect(sale.document.items[0].amount).toBe('1200.00');

    const receipt = data.lines.find((l) => l.kind === 'RECEIPT');
    expect(receipt.receivedPaid).toBe('500.00');
    expect(receipt.paymentStatus).toBe('SETTLED');
  });

  it("does not let a later payment change an earlier transaction's own balance", async () => {
    const { data } = (await getStatement(adminA, party.id)).body;
    const purchase = data.lines.find((l) => l.kind === 'PURCHASE');

    // The purchase posted at 5000. Its Txn Balance is its own amount, and the
    // running payable at that row is 5000 - neither is touched by the supplier
    // payment that comes 5 days later. The live outstanding (3000 after the 2000
    // payment) is reported separately so nothing time-travels.
    expect(purchase.txnBalance).toBe('5000.00');
    expect(purchase.payableBalance).toBe('5000.00');
    expect(purchase.currentOutstanding).toBe('3000.00');
  });

  it('filters by transaction type without disturbing the running balances', async () => {
    const { data } = (await getStatement(adminA, party.id, '?type=RECEIPTS')).body;
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].kind).toBe('RECEIPT');
    // Summary still reflects the whole window, not just the filtered rows.
    expect(data.summary.closingReceivable).toBe('700.00');
    expect(data.summary.closingPayable).toBe('3000.00');
  });

  it('searches by document number', async () => {
    const full = (await getStatement(adminA, party.id)).body.data;
    const saleNumber = full.lines.find((l) => l.kind === 'SALE').documentNumber;
    const searched = (await getStatement(adminA, party.id, `?search=${encodeURIComponent(saleNumber)}`)).body.data;
    expect(searched.lines).toHaveLength(1);
    expect(searched.lines[0].documentNumber).toBe(saleNumber);
  });

  it('omits item detail when includeItems is false', async () => {
    const { data } = (await getStatement(adminA, party.id, '?includeItems=false')).body;
    const sale = data.lines.find((l) => l.kind === 'SALE');
    expect(sale.document.items).toBeNull();
  });
});

describe('returns, drafts and windows', () => {
  it('reduces each side by its own return, never the other', async () => {
    const party = await createParty(adminA, 'Returning Trader');
    const purchase = await postPurchase(adminA, {
      supplierId: party.supplierId,
      quantity: '50',
      unitCost: '100',
      invoiceDate: '2026-08-01',
    });
    const sale = await postSale(adminA, {
      customerId: party.customerId,
      quantity: '20',
      unitPrice: '120',
      invoiceDate: '2026-09-01',
    });
    // Receivable 2400, payable 5000 before returns.
    await postSalesReturn(adminA, { sale, quantity: '5', returnDate: '2026-09-15' });
    await postPurchaseReturn(adminA, { purchase, quantity: '10', returnDate: '2026-09-20' });

    const { data } = (await getStatement(adminA, party.id)).body;
    expect(data.lines.map((l) => l.kind)).toEqual([
      'PURCHASE',
      'SALE',
      'SALES_RETURN',
      'PURCHASE_RETURN',
    ]);
    // Sales return 5 @ 120 = 600 off 2400 -> 1800. Purchase return 10 @ 100 = 1000 off 5000 -> 4000.
    expect(data.summary.closingReceivable).toBe('1800.00');
    expect(data.summary.closingPayable).toBe('4000.00');
  });

  it('never shows a draft document', async () => {
    const party = await createParty(adminA, 'Draft Holder');
    await postSale(adminA, {
      customerId: party.customerId,
      quantity: '2',
      unitPrice: '120',
      invoiceDate: '2026-09-01',
    });
    await draftSale(adminA, {
      customerId: party.customerId,
      quantity: '3',
      unitPrice: '120',
      invoiceDate: '2026-09-02',
    });

    const { data } = (await getStatement(adminA, party.id)).body;
    expect(data.lines).toHaveLength(1);
    expect(data.summary.closingReceivable).toBe('240.00');
  });

  it('folds earlier movement into the opening balance of a windowed statement', async () => {
    const party = await createParty(adminA, 'Windowed Party');
    await postSale(adminA, {
      customerId: party.customerId,
      quantity: '10',
      unitPrice: '120',
      invoiceDate: '2026-08-01',
    });
    const augInvoice = await postSale(adminA, {
      customerId: party.customerId,
      quantity: '5',
      unitPrice: '120',
      invoiceDate: '2026-09-15',
    });

    const windowed = (await getStatement(adminA, party.id, '?fromDate=2026-09-01&toDate=2026-09-30')).body.data;
    // The August sale (1200) is before the window, so it is the opening balance.
    expect(windowed.openingReceivable).toBe('1200.00');
    expect(windowed.lines).toHaveLength(1);
    expect(windowed.lines[0].documentNumber).toBe(augInvoice.invoiceNumber);
    // Opening 1200 + September sale 600 = 1800 closing.
    expect(windowed.summary.closingReceivable).toBe('1800.00');
  });

  it('includes a transaction on the toDate boundary', async () => {
    const party = await createParty(adminA, 'Boundary Party');
    await postSale(adminA, {
      customerId: party.customerId,
      quantity: '1',
      unitPrice: '120',
      invoiceDate: '2026-09-30',
    });
    const onBoundary = (await getStatement(adminA, party.id, '?fromDate=2026-09-01&toDate=2026-09-30')).body.data;
    expect(onBoundary.lines).toHaveLength(1);
  });
});

describe('PDF and Excel downloads', () => {
  let party;

  beforeAll(async () => {
    party = await createParty(adminA, 'Export Party');
    const purchase = await postPurchase(adminA, {
      supplierId: party.supplierId,
      quantity: '30',
      unitCost: '80',
      invoiceDate: '2026-08-01',
    });
    await postSale(adminA, {
      customerId: party.customerId,
      quantity: '4',
      unitPrice: '150',
      invoiceDate: '2026-09-01',
    });
    const payableId = await payableIdFor(adminA, purchase.id);
    await postSupplierPayment(adminA, {
      supplierId: party.supplierId,
      amount: '1000',
      payableId,
      paymentDate: '2026-09-05',
    });
  }, 30000);

  it('serves a real PDF with the download headers', async () => {
    const response = await downloadBinary(adminA, `/api/v1/parties/${party.id}/statement.pdf`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('.pdf');
    expect(response.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(response.body.length).toBeGreaterThan(1000);
  });

  it('serves a real .xlsx whose figures reconcile to the statement', async () => {
    const response = await downloadBinary(adminA, `/api/v1/parties/${party.id}/statement.xlsx`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(response.body.slice(0, 2).toString()).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(response.body);
    const stmtSheet = wb.getWorksheet('Party Statement');
    expect(stmtSheet).toBeTruthy();
    expect(wb.getWorksheet('Line Items')).toBeTruthy();
    expect(wb.getWorksheet('Summary')).toBeTruthy();

    // The live outstanding is a distinct column, never merged with Txn Balance
    // or the running balances.
    let hasOutstandingHeader = false;
    stmtSheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value === 'Outstanding (now)') hasOutstandingHeader = true;
      });
    });
    expect(hasOutstandingHeader).toBe(true);

    const statement = (await getStatement(adminA, party.id)).body.data;
    // The Line Items sheet has one data row per item across every document.
    const itemRowCount = statement.lines.reduce(
      (sum, line) => sum + (line.document?.items?.length ?? 0),
      0,
    );
    const itemsSheet = wb.getWorksheet('Line Items');
    expect(itemsSheet.rowCount - 1).toBe(itemRowCount);
  });

  it('respects a type filter in the Excel download', async () => {
    const response = await downloadBinary(
      adminA,
      `/api/v1/parties/${party.id}/statement.xlsx?type=PURCHASES`,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(response.body);
    const statement = (await getStatement(adminA, party.id, '?type=PURCHASES')).body.data;
    // Line Items only carries rows for the kept (purchase) documents.
    const itemRows = statement.lines.reduce((s, l) => s + (l.document?.items?.length ?? 0), 0);
    expect(wb.getWorksheet('Line Items').rowCount - 1).toBe(itemRows);
  });
});

describe('payment details in the chronological ledger', () => {
  const createReceipt = (token, body) =>
    request(app).post('/api/v1/customer-payments').set(auth(token)).send(body);
  const createSupplierPayment = (token, body) =>
    request(app).post('/api/v1/supplier-payments').set(auth(token)).send(body);
  const post = (token, kind, id) =>
    request(app).post(`/api/v1/${kind}/${id}/post`).set(auth(token));

  it("shows a cash receipt's mode, allocation and notes beneath its row", async () => {
    const party = await createParty(adminA, 'Cash Receipt Party');
    const sale = await postSale(adminA, {
      customerId: party.customerId,
      quantity: '10',
      unitPrice: '120',
      invoiceDate: '2026-09-01',
    });
    const receivableId = await receivableIdFor(adminA, sale.id);
    const created = await createReceipt(adminA, {
      customerId: party.customerId,
      paymentDate: '2026-09-05',
      amount: '500',
      paymentMethod: 'CASH',
      referenceNumber: 'RCP-REF-9',
      notes: 'Paid at the shop',
      allocations: [{ receivableId, amount: '500' }],
    });
    expect(created.status).toBe(201);
    expect((await post(adminA, 'customer-payments', created.body.data.payment.id)).status).toBe(200);

    const receipt = (await getStatement(adminA, party.id)).body.data.lines.find((l) => l.kind === 'RECEIPT');
    expect(receipt.payment).toBeTruthy();
    expect(receipt.payment.mode).toBe('CASH');
    expect(receipt.payment.modeLabel).toBe('Cash');
    expect(receipt.payment.reference).toBe('RCP-REF-9');
    expect(receipt.payment.notes).toBe('Paid at the shop');
    expect(receipt.payment.allocated).toBe('500.00');
    expect(receipt.payment.allocations[0].documentNumber).toBe(sale.invoiceNumber);
  });

  it('shows a supplier payment made by bank transfer', async () => {
    const party = await createParty(adminA, 'Bank Payment Party');
    const purchase = await postPurchase(adminA, {
      supplierId: party.supplierId,
      quantity: '50',
      unitCost: '100',
      invoiceDate: '2026-08-01',
    });
    const payableId = await payableIdFor(adminA, purchase.id);
    const created = await createSupplierPayment(adminA, {
      supplierId: party.supplierId,
      paymentDate: '2026-08-10',
      amount: '2000',
      paymentMethod: 'BANK_TRANSFER',
      referenceNumber: 'UTR-123456',
      allocations: [{ payableId, amount: '2000' }],
    });
    expect(created.status).toBe(201);
    expect((await post(adminA, 'supplier-payments', created.body.data.payment.id)).status).toBe(200);

    const payment = (await getStatement(adminA, party.id)).body.data.lines.find((l) => l.kind === 'PAYMENT');
    expect(payment.payment.mode).toBe('BANK_TRANSFER');
    expect(payment.payment.modeLabel).toBe('Bank transfer');
    expect(payment.payment.reference).toBe('UTR-123456');
    expect(payment.payment.notes).toBeNull();
  });

  it('reports an unallocated advance distinctly, as the payment\'s own balance', async () => {
    const party = await createParty(adminA, 'Advance Party');
    const sale = await postSale(adminA, {
      customerId: party.customerId,
      quantity: '10',
      unitPrice: '120',
      invoiceDate: '2026-09-01',
    });
    const receivableId = await receivableIdFor(adminA, sale.id);
    const created = await createReceipt(adminA, {
      customerId: party.customerId,
      paymentDate: '2026-09-05',
      amount: '1500',
      paymentMethod: 'UPI',
      allocations: [{ receivableId, amount: '1000' }],
    });
    expect(created.status).toBe(201);
    expect((await post(adminA, 'customer-payments', created.body.data.payment.id)).status).toBe(200);

    const receipt = (await getStatement(adminA, party.id)).body.data.lines.find((l) => l.kind === 'RECEIPT');
    expect(receipt.payment.allocated).toBe('1000.00');
    expect(receipt.payment.unallocated).toBe('500.00');
    expect(receipt.paymentStatus).toBe('UNUSED');
    // The unused advance is the payment's own balance; it never affects an invoice's figures.
    expect(receipt.txnBalance).toBe('500.00');
  });

  it('carries payment mode into the Excel export', async () => {
    const party = await createParty(adminA, 'Excel Payment Party');
    const sale = await postSale(adminA, {
      customerId: party.customerId,
      quantity: '5',
      unitPrice: '100',
      invoiceDate: '2026-09-01',
    });
    const receivableId = await receivableIdFor(adminA, sale.id);
    const created = await createReceipt(adminA, {
      customerId: party.customerId,
      paymentDate: '2026-09-05',
      amount: '300',
      paymentMethod: 'CASH',
      allocations: [{ receivableId, amount: '300' }],
    });
    expect((await post(adminA, 'customer-payments', created.body.data.payment.id)).status).toBe(200);

    const response = await downloadBinary(adminA, `/api/v1/parties/${party.id}/statement.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(response.body);
    const sheet = wb.getWorksheet('Party Statement');
    let hasModeHeader = false;
    let hasCash = false;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value === 'Payment Mode') hasModeHeader = true;
        if (cell.value === 'Cash') hasCash = true;
      });
    });
    expect(hasModeHeader).toBe(true);
    expect(hasCash).toBe(true);
  });
});

describe('tenant isolation and authorization', () => {
  let party;

  beforeAll(async () => {
    party = await createParty(adminA, 'Private Party');
  });

  it("refuses another company's statement, PDF and Excel with a 404", async () => {
    expect((await getStatement(adminB, party.id)).status).toBe(404);
    expect((await downloadBinary(adminB, `/api/v1/parties/${party.id}/statement.pdf`)).status).toBe(404);
    expect((await downloadBinary(adminB, `/api/v1/parties/${party.id}/statement.xlsx`)).status).toBe(404);
  });

  it('keeps a platform user out of a shop statement entirely', async () => {
    const response = await getStatement(platformToken, party.id);
    expect([401, 403, 404]).toContain(response.status);
    expect(response.status).not.toBe(200);
  });
});
