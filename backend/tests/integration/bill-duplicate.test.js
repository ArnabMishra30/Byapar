import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { env } from '../../src/config/env.js';

// Regression coverage for QA findings M3 (duplicate bill uploads) and M4
// (the same invoice posted twice through separate bill records).
//
// Extraction is stubbed so an upload reaches REVIEW without a vendor key - the
// same approach bill-ai-hardening uses. The point here is the duplicate logic
// around it, not the model.

vi.mock('../../src/modules/bills/bill-extraction.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isExtractionConfigured: vi.fn(() => true), extractBill: vi.fn() };
});
import * as extraction from '../../src/modules/bills/bill-extraction.service.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

/** One real PNG, reused so every upload of it shares a checksum. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
    '05fe02fea7b5c4a40000000049454e44ae426082',
  'hex',
);
/** A DIFFERENT file (a PDF), so a distinct checksum. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let companyA;
let tokenA;
let tokenB;
let ctx;
let invoiceSeq = 0;
const nextInvoice = (tag) => `${tag}-${(invoiceSeq += 1)}`;

function mockExtract() {
  vi.mocked(extraction.extractBill).mockResolvedValue({
    data: { partyName: 'ABC', invoiceDate: '2026-06-15', grandTotal: '450.00', lines: [] },
    model: 'test-model',
    raw: {},
  });
}

function uploadBill(token, { direction = 'IN', buffer = PNG, filename = 'bill.png', type = 'image/png', allowDuplicate } = {}) {
  const req = request(app).post('/api/v1/bills').set(auth(token)).field('direction', direction);
  if (allowDuplicate !== undefined) req.field('allowDuplicate', String(allowDuplicate));
  return req.attach('file', buffer, { filename, contentType: type });
}

const confirm = (token, id, body) =>
  request(app).post(`/api/v1/bills/${id}/confirm`).set(auth(token)).send(body);

async function prepare(token, suffix) {
  const post = (path, body) => request(app).post(path).set(auth(token)).send(body);
  const category = await post('/api/v1/categories', { name: `Dup Cat ${suffix}` });
  const unit = await post('/api/v1/units', { name: `Dup Unit ${suffix}`, shortCode: `DU${suffix}` });
  const product = await post('/api/v1/products', {
    name: `Dup Prod ${suffix}`,
    sku: `DUP-${suffix}`,
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    purchasePrice: '45',
  });
  const supplier = await post('/api/v1/suppliers', { name: `Dup Sup ${suffix}` });
  const customer = await post('/api/v1/customers', { name: `Dup Cust ${suffix}` });
  const warehouse = await post('/api/v1/warehouses', { name: `Dup WH ${suffix}`, code: `DW${suffix}` });
  const c = {
    productId: product.body.data.product.id,
    supplierId: supplier.body.data.supplier.id,
    customerId: customer.body.data.customer.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };

  // Stock the product so the OUT (sales) cases have something to sell.
  const stockIn = await post('/api/v1/purchases', {
    supplierId: c.supplierId,
    warehouseId: c.warehouseId,
    invoiceNumber: nextInvoice('STOCK'),
    invoiceDate: '2026-01-01',
    items: [{ productId: c.productId, quantity: '500', unitCost: '45' }],
  });
  await post(`/api/v1/purchases/${stockIn.body.data.purchase.id}/post`, {});

  return c;
}

beforeAll(async () => {
  await resetDatabase();
  const a = await createCompanyWithUsers('dupa');
  const b = await createCompanyWithUsers('dupb');
  companyA = a.company;
  tokenA = await login(app, a.admin.email, PASSWORD);
  tokenB = await login(app, b.admin.email, PASSWORD);
  ctx = await prepare(tokenA, 'A');
});

beforeEach(async () => {
  await prisma.bill.deleteMany();
  vi.mocked(extraction.extractBill).mockReset();
  vi.mocked(extraction.isExtractionConfigured).mockReset().mockReturnValue(true);
  mockExtract();
});

afterAll(async () => {
  await resetDatabase();
  await rm(path.resolve(env.BILL_STORAGE_DIR), { recursive: true, force: true }).catch(() => {});
  await prisma.$disconnect();
});

describe('M3 — duplicate bill uploads', () => {
  it('refuses a second upload of the same file, with a reference to the existing bill', async () => {
    const first = await uploadBill(tokenA);
    expect(first.status).toBe(201);
    const firstId = first.body.data.bill.id;

    const second = await uploadBill(tokenA);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BILL_DUPLICATE_UPLOAD');
    expect(second.body.errors[0].existingBillId).toBe(firstId);

    // Only one bill, and no second extraction job was started.
    expect(await prisma.bill.count({ where: { companyId: companyA.id } })).toBe(1);
  });

  it('lets the same file through when the uploader asks to keep both', async () => {
    const first = await uploadBill(tokenA);
    const second = await uploadBill(tokenA, { allowDuplicate: true });
    expect(second.status).toBe(201);
    expect(second.body.data.bill.id).not.toBe(first.body.data.bill.id);
    expect(await prisma.bill.count({ where: { companyId: companyA.id } })).toBe(2);
  });

  it('does not treat a different file as a duplicate', async () => {
    await uploadBill(tokenA);
    const other = await uploadBill(tokenA, { buffer: PDF, filename: 'bill.pdf', type: 'application/pdf' });
    expect(other.status).toBe(201);
  });

  it('allows re-uploading a file whose first bill was cancelled', async () => {
    const first = await uploadBill(tokenA);
    await request(app).post(`/api/v1/bills/${first.body.data.bill.id}/cancel`).set(auth(tokenA)).send({});

    const again = await uploadBill(tokenA);
    expect(again.status).toBe(201);
  });

  it('isolates tenants: another company uploading the same bytes is not blocked', async () => {
    await uploadBill(tokenA);
    const otherCompany = await uploadBill(tokenB);
    expect(otherCompany.status).toBe(201);
  });

  it('creates exactly one bill under concurrent identical uploads', async () => {
    const results = await Promise.all([
      uploadBill(tokenA),
      uploadBill(tokenA),
      uploadBill(tokenA),
      uploadBill(tokenA),
    ]);
    const codes = results.map((r) => r.status);
    // The advisory lock serialises them: exactly one wins, the rest are refused.
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(3);
    // And the database holds exactly one bill (beforeEach cleared bills first).
    expect(await prisma.bill.count({ where: { companyId: companyA.id } })).toBe(1);
  });
});

describe('M4 — concurrent confirmation of the same invoice', () => {
  async function uploadedInReview(token, opts) {
    const res = await uploadBill(token, opts);
    expect(res.status).toBe(201);
    return res.body.data.bill.id;
  }

  it('posts only one document under concurrent confirmations of the same IN invoice', async () => {
    // Two bill records from the same file, different (so the document layer does
    // not catch them) invoice numbers, same supplier + total + date.
    const bill1 = await uploadedInReview(tokenA);
    const bill2 = await uploadedInReview(tokenA, { allowDuplicate: true });
    const base = {
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceDate: '2026-07-01',
      items: [{ productId: ctx.productId, quantity: '10', unitCost: '47' }], // 470, distinctive
    };

    const [r1, r2] = await Promise.all([
      confirm(tokenA, bill1, { document: { ...base, invoiceNumber: nextInvoice('CC-IN') } }),
      confirm(tokenA, bill2, { document: { ...base, invoiceNumber: nextInvoice('CC-IN') } }),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const blocked = [r1, r2].find((r) => r.status === 409);
    expect(blocked.body.code).toBe('BILL_DUPLICATE_POSTING');
    // Exactly one purchase actually posted.
    const posted = await prisma.purchase.count({
      where: { companyId: companyA.id, supplierId: ctx.supplierId, status: 'POSTED', grandTotal: '470' },
    });
    expect(posted).toBe(1);
  });

  it('posts only one sale under concurrent confirmations of the same OUT invoice', async () => {
    // Sales invoice numbers are auto-generated, so ONLY the fingerprint stops a
    // concurrent double-post here.
    const bill1 = await uploadedInReview(tokenA, { direction: 'OUT' });
    const bill2 = await uploadedInReview(tokenA, { direction: 'OUT', allowDuplicate: true });
    const saleDoc = {
      customerId: ctx.customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate: '2026-07-02',
      items: [{ productId: ctx.productId, quantity: '3', unitPrice: '49' }], // 147, distinctive
    };

    const [r1, r2] = await Promise.all([
      confirm(tokenA, bill1, { document: saleDoc }),
      confirm(tokenA, bill2, { document: saleDoc }),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const posted = await prisma.salesInvoice.count({
      where: { companyId: companyA.id, customerId: ctx.customerId, status: 'POSTED', grandTotal: '147' },
    });
    expect(posted).toBe(1);
  });
});

describe('M4 — the same invoice posted twice through separate bills', () => {
  async function uploadedInReview(token, opts) {
    const res = await uploadBill(token, opts);
    expect(res.status).toBe(201);
    return res.body.data.bill.id;
  }

  it('refuses to post a second IN bill from the same file as the same invoice (different number)', async () => {
    const date = '2026-06-15';
    const bill1 = await uploadedInReview(tokenA);
    const first = await confirm(tokenA, bill1, {
      document: {
        supplierId: ctx.supplierId,
        warehouseId: ctx.warehouseId,
        invoiceNumber: nextInvoice('IN-A'),
        invoiceDate: date,
        items: [{ productId: ctx.productId, quantity: '10', unitCost: '45' }],
      },
    });
    expect(first.status).toBe(201);

    // Same file (kept deliberately), different invoice number, same money/date.
    const bill2 = await uploadedInReview(tokenA, { allowDuplicate: true });
    const blocked = await confirm(tokenA, bill2, {
      document: {
        supplierId: ctx.supplierId,
        warehouseId: ctx.warehouseId,
        invoiceNumber: nextInvoice('IN-A'),
        invoiceDate: date,
        items: [{ productId: ctx.productId, quantity: '10', unitCost: '45' }],
      },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('BILL_DUPLICATE_POSTING');
    expect(blocked.body.errors[0].existingBillId).toBe(bill1);

    // ...and the human can still override to record it anyway.
    const forced = await confirm(tokenA, bill2, {
      allowDuplicate: true,
      document: {
        supplierId: ctx.supplierId,
        warehouseId: ctx.warehouseId,
        invoiceNumber: nextInvoice('IN-A'),
        invoiceDate: date,
        items: [{ productId: ctx.productId, quantity: '10', unitCost: '45' }],
      },
    });
    expect(forced.status).toBe(201);
  });

  it('does not flag a genuinely different invoice on the same file (multi-invoice case)', async () => {
    const bill1 = await uploadedInReview(tokenA);
    await confirm(tokenA, bill1, {
      document: {
        supplierId: ctx.supplierId,
        warehouseId: ctx.warehouseId,
        invoiceNumber: nextInvoice('IN-B'),
        invoiceDate: '2026-06-15',
        items: [{ productId: ctx.productId, quantity: '10', unitCost: '45' }],
      },
    });

    const bill2 = await uploadedInReview(tokenA, { allowDuplicate: true });
    // Different total (qty 5) -> a different invoice -> must post without a fuss.
    const ok = await confirm(tokenA, bill2, {
      document: {
        supplierId: ctx.supplierId,
        warehouseId: ctx.warehouseId,
        invoiceNumber: nextInvoice('IN-B'),
        invoiceDate: '2026-06-15',
        items: [{ productId: ctx.productId, quantity: '5', unitCost: '45' }],
      },
    });
    expect(ok.status).toBe(201);
  });

  it('refuses to post a second OUT bill from the same file as the same sale', async () => {
    const date = '2026-06-16';
    const saleDoc = {
      customerId: ctx.customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate: date,
      items: [{ productId: ctx.productId, quantity: '10', unitPrice: '45' }],
    };

    const bill1 = await uploadedInReview(tokenA, { direction: 'OUT' });
    const first = await confirm(tokenA, bill1, { document: saleDoc });
    expect(first.status).toBe(201);

    // Sales invoice numbers are auto-generated, so the document layer alone
    // would never catch this - M4 does, via same file + party + total + date.
    const bill2 = await uploadedInReview(tokenA, { direction: 'OUT', allowDuplicate: true });
    const blocked = await confirm(tokenA, bill2, { document: saleDoc });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('BILL_DUPLICATE_POSTING');
  });
});
