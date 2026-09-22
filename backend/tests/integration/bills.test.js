import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { env } from '../../src/config/env.js';

// AI BILL IMPORT, end to end.
//
// The extraction itself needs a vendor API key, which a test run does not have -
// and MUST not need. So these tests cover everything around the model:
//
//   the file gate      what may be uploaded, and what a lie about a file type does
//   the honest failure what happens with no key configured (it must not pretend)
//   tenant isolation   one shop's bills are invisible and unreadable to another
//   THE BRIDGE         a confirmed bill becomes a real purchase, through the
//                      existing purchase service, with real accounting
//   double-posting     a bill cannot become two documents
//
// The extraction logic itself - the part that would be mocked here - is covered
// properly in tests/unit/bill-extraction.test.js against the real parser.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

/** A real, minimal PNG. Magic bytes matter: the server checks them. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
    '05fe02fea7b5c4a40000000049454e44ae426082',
  'hex',
);

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let companyA;
let adminA;
let staffA;
let tokenA;
let staffTokenA;
let tokenB;
let ctxA;

/** Master data a shop needs to record a purchase. */
async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `General ${suffix}` });

  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `Piece ${suffix}`, shortCode: `PC${suffix}` });

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `Sugar 1kg ${suffix}`,
      sku: `SKU-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
      purchasePrice: '45',
    });

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({ name: `ABC Traders ${suffix}` });

  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Main ${suffix}`, code: `MN${suffix}` });

  return {
    productId: product.body.data.product.id,
    supplierId: supplier.body.data.supplier.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

/** Uploads a bill and returns the response. */
function uploadBill(token, { direction = 'IN', buffer = PNG, filename = 'bill.png', type = 'image/png' } = {}) {
  return request(app)
    .post('/api/v1/bills')
    .set(auth(token))
    .field('direction', direction)
    .attach('file', buffer, { filename, contentType: type });
}

beforeAll(async () => {
  await resetDatabase();

  const a = await createCompanyWithUsers('billa');
  const b = await createCompanyWithUsers('billb');

  companyA = a.company;
  adminA = a.admin;
  staffA = a.staff;

  tokenA = await login(app, a.admin.email, PASSWORD);
  staffTokenA = await login(app, a.staff.email, PASSWORD);
  tokenB = await login(app, b.admin.email, PASSWORD);

  ctxA = await prepareCompany(tokenA, 'A');
});

beforeEach(async () => {
  await prisma.bill.deleteMany();
});

afterAll(async () => {
  // Uploaded fixtures live under the configured storage root.
  await rm(path.resolve(env.BILL_STORAGE_DIR), { recursive: true, force: true }).catch(() => {});
});

describe('uploading a bill', () => {
  it('accepts a PNG and records it', async () => {
    const response = await uploadBill(tokenA);

    expect(response.status).toBe(201);
    expect(response.body.data.bill.direction).toBe('IN');
    expect(response.body.data.bill.file.name).toBe('bill.png');
  });

  it('accepts a PDF', async () => {
    const response = await uploadBill(tokenA, {
      buffer: PDF,
      filename: 'bill.pdf',
      type: 'application/pdf',
    });

    expect(response.status).toBe(201);
  });

  it('refuses a file type that is not a bill', async () => {
    const response = await uploadBill(tokenA, {
      buffer: Buffer.from('#!/bin/sh\nrm -rf /'),
      filename: 'evil.sh',
      type: 'application/x-sh',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  // A Content-Type header is a claim, not evidence.
  it('refuses a file whose bytes contradict its declared type', async () => {
    const response = await uploadBill(tokenA, {
      buffer: Buffer.from('MZ this is a windows executable, not a png'),
      filename: 'notreally.png',
      type: 'image/png',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('FILE_TYPE_MISMATCH');
  });

  it('refuses an empty file', async () => {
    const response = await uploadBill(tokenA, { buffer: Buffer.alloc(0) });
    expect(response.status).toBe(422);
  });

  it('refuses a request with no file at all', async () => {
    const response = await request(app)
      .post('/api/v1/bills')
      .set(auth(tokenA))
      .field('direction', 'IN');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('NO_FILE');
  });

  it('refuses a direction it does not understand', async () => {
    const response = await uploadBill(tokenA, { direction: 'SIDEWAYS' });
    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/v1/bills')
      .field('direction', 'IN')
      .attach('file', PNG, { filename: 'bill.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
  });

  // A filename is display text. It must never be able to steer a write.
  it('stores a traversal filename harmlessly', async () => {
    const response = await uploadBill(tokenA, { filename: '../../../etc/passwd.png' });

    expect(response.status).toBe(201);
    expect(response.body.data.bill.file.name).not.toContain('..');
    expect(response.body.data.bill.file.name).not.toContain('/');
  });

  // WITHOUT A KEY IT MUST SAY SO, not pretend, and not invent an extraction.
  it('fails honestly when extraction is not configured', async () => {
    if (env.LLAMA_API_KEY) return; // A configured server is tested elsewhere.

    const response = await uploadBill(tokenA);

    expect(response.status).toBe(201);
    expect(response.body.data.bill.status).toBe('FAILED');
    expect(response.body.data.bill.extractionError).toMatch(/not set up|manually/i);
    // Above all: no fabricated data.
    expect(response.body.data.bill.reviewedData).toBeNull();
    expect(response.body.data.bill.extraction).toBeNull();
  });

  it('never returns a filesystem path', async () => {
    const response = await uploadBill(tokenA);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain('storageKey');
    expect(body).not.toMatch(/[A-Za-z]:\\|\/storage\//);
  });

  it('reports what the shop has to act on', async () => {
    await uploadBill(tokenA);

    const response = await request(app).get('/api/v1/bills/summary').set(auth(tokenA));

    expect(response.status).toBe(200);
    expect(response.body.data.counts.FAILED + response.body.data.counts.REVIEW).toBe(1);
    expect(response.body.data.extractionConfigured).toBe(Boolean(env.LLAMA_API_KEY));
  });
});

describe('one shop cannot see another shop bills', () => {
  it('hides a bill from another company behind a 404', async () => {
    const created = await uploadBill(tokenA);
    const billId = created.body.data.bill.id;

    const response = await request(app).get(`/api/v1/bills/${billId}`).set(auth(tokenB));

    // 404, not 403 - an id must not be confirmable by comparing error codes.
    expect(response.status).toBe(404);
  });

  it('refuses to serve another company file', async () => {
    const created = await uploadBill(tokenA);
    const billId = created.body.data.bill.id;

    const response = await request(app).get(`/api/v1/bills/${billId}/file`).set(auth(tokenB));
    expect(response.status).toBe(404);
  });

  it('serves the file back to its own shop', async () => {
    const created = await uploadBill(tokenA);
    const billId = created.body.data.bill.id;

    const response = await request(app).get(`/api/v1/bills/${billId}/file`).set(auth(tokenA));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('never lists another company bills', async () => {
    await uploadBill(tokenA);

    const response = await request(app).get('/api/v1/bills').set(auth(tokenB));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(0);
  });
});

describe('reviewing and confirming', () => {
  /** A bill parked in REVIEW with data a human has entered. */
  async function billInReview(token = tokenA, direction = 'IN') {
    const created = await uploadBill(token, { direction });
    const billId = created.body.data.bill.id;

    await request(app)
      .patch(`/api/v1/bills/${billId}/review`)
      .set(auth(token))
      .send({
        reviewedData: {
          partyName: 'ABC Traders',
          invoiceNumber: 'INV-001',
          invoiceDate: '2026-06-15',
          grandTotal: '450.00',
          lines: [{ description: 'Sugar 1kg', quantity: '10', unitPrice: '45.00' }],
        },
      });

    return billId;
  }

  it('saves corrections without posting anything', async () => {
    const billId = await billInReview();

    const bill = await request(app).get(`/api/v1/bills/${billId}`).set(auth(tokenA));

    expect(bill.body.data.bill.status).toBe('REVIEW');
    expect(bill.body.data.bill.reviewedData.partyName).toBe('ABC Traders');
    expect(bill.body.data.bill.posted).toBeNull();
  });

  // THE BRIDGE. A confirmed bill becomes an ordinary purchase, with real stock
  // and a real journal entry, through the existing service.
  it('turns a confirmed IN bill into a posted purchase', async () => {
    const billId = await billInReview();

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-001',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '10', unitCost: '45' }],
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.bill.status).toBe('POSTED');
    expect(response.body.data.bill.posted.sourceType).toBe('PURCHASE');

    const purchaseId = response.body.data.bill.posted.sourceId;

    // A REAL purchase, posted through the ordinary flow.
    const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
    expect(purchase.status).toBe('POSTED');
    expect(purchase.companyId).toBe(companyA.id);

    // With a REAL journal entry - written by the existing posting path, not here.
    const entry = await prisma.journalEntry.findFirst({
      where: { companyId: companyA.id, sourceType: 'PURCHASE', sourceId: purchaseId },
    });
    expect(entry).not.toBeNull();

    // And real stock.
    const movements = await prisma.stockMovement.count({
      where: { companyId: companyA.id, productId: ctxA.productId },
    });
    expect(movements).toBeGreaterThan(0);
  });

  // A BILL BECOMES AT MOST ONE DOCUMENT.
  it('refuses to post the same bill twice', async () => {
    const billId = await billInReview();

    const document = {
      supplierId: ctxA.supplierId,
      warehouseId: ctxA.warehouseId,
      invoiceNumber: 'INV-DUP',
      invoiceDate: '2026-06-15',
      items: [{ productId: ctxA.productId, quantity: '5', unitCost: '45' }],
    };

    const first = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({ document });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({ document: { ...document, invoiceNumber: 'INV-DUP-2' } });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BILL_ALREADY_POSTED');

    // Scoped to this test's own invoices - purchases from earlier tests remain.
    expect(
      await prisma.purchase.count({
        where: { companyId: companyA.id, invoiceNumber: { in: ['INV-DUP', 'INV-DUP-2'] } },
      }),
    ).toBe(1);
  });

  // The confirmed document is held to the SAME schema the ordinary form uses.
  it('refuses a confirmation missing a field the purchase form requires', async () => {
    const billId = await billInReview();

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          // No supplierId, no warehouseId.
          invoiceNumber: 'INV-BAD',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '1', unitCost: '45' }],
        },
      });

    expect(response.status).toBe(400);
  });

  it('refuses a confirmation with no items', async () => {
    const billId = await billInReview();

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-EMPTY',
          invoiceDate: '2026-06-15',
          items: [],
        },
      });

    expect(response.status).toBe(400);
  });

  // A bill cannot reach into another shop's master data.
  it('refuses a product belonging to another company', async () => {
    const ctxB = await prepareCompany(tokenB, 'B');
    const billId = await billInReview();

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-CROSS',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxB.productId, quantity: '1', unitCost: '45' }],
        },
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.purchase.count({
        where: { companyId: companyA.id, invoiceNumber: 'INV-CROSS' },
      }),
    ).toBe(0);
  });

  // Confirming IS posting, so it follows the same rule posting always has.
  it('refuses to let a staff member confirm a bill', async () => {
    const billId = await billInReview();

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(staffTokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-STAFF',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '1', unitCost: '45' }],
        },
      });

    expect(response.status).toBe(403);
  });

  it('lets a staff member upload and review', async () => {
    const created = await uploadBill(staffTokenA);
    expect(created.status).toBe(201);

    const response = await request(app)
      .patch(`/api/v1/bills/${created.body.data.bill.id}/review`)
      .set(auth(staffTokenA))
      .send({ reviewedData: { partyName: 'Reviewed by staff' } });

    expect(response.status).toBe(200);
  });

  it('cancels a bill without touching the books', async () => {
    const billId = await billInReview();

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/cancel`)
      .set(auth(tokenA))
      .send({ reason: 'Duplicate photo' });

    expect(response.status).toBe(200);
    expect(response.body.data.bill.status).toBe('CANCELLED');
    // A cancelled bill produced no accounting document of its own.
    expect(response.body.data.bill.posted).toBeNull();
    const cancelled = await prisma.bill.findUnique({ where: { id: billId } });
    expect(cancelled.postedSourceId).toBeNull();
  });

  it('refuses to cancel a bill that is already recorded', async () => {
    const billId = await billInReview();

    await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-CANCEL',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '1', unitCost: '45' }],
        },
      });

    const response = await request(app)
      .post(`/api/v1/bills/${billId}/cancel`)
      .set(auth(tokenA))
      .send({ reason: 'Changed my mind' });

    expect(response.status).toBe(409);
  });

  it('refuses to edit a bill that is already recorded', async () => {
    const billId = await billInReview();

    await request(app)
      .post(`/api/v1/bills/${billId}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-LOCKED',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '1', unitCost: '45' }],
        },
      });

    const response = await request(app)
      .patch(`/api/v1/bills/${billId}/review`)
      .set(auth(tokenA))
      .send({ reviewedData: { partyName: 'Too late' } });

    expect(response.status).toBe(409);
  });
});
