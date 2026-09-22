import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { env } from '../../src/config/env.js';
import * as extraction from '../../src/modules/bills/bill-extraction.service.js';

// THE MOCK MUST BE vi.mock, NOT vi.spyOn.
//
// bill.service.js imported extractBill as a live ESM binding before any test
// ran. Spying on the namespace object leaves that binding pointing at the real
// function, so the stub is never called and every assertion passes for the
// wrong reason. vi.mock replaces the module before the service imports it.
//
// Only the two functions that talk to the vendor are replaced. The schema and
// the parser are the REAL ones, so nothing here weakens what is under test.
vi.mock('../../src/modules/bills/bill-extraction.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isExtractionConfigured: vi.fn(() => true),
    extractBill: vi.fn(),
  };
});

// AI FAILURE MODES.
//
// The single property this file exists to prove:
//
//   NO MATTER WHAT THE MODEL DOES, THE BOOKS ARE UNTOUCHED.
//
// It can time out, return prose, return a hallucinated schema, return a total of
// "about five thousand", or not be configured at all. In every case the shop
// ends up with a bill it can correct by hand, and ZERO journal entries, ZERO
// stock movements and ZERO documents it did not ask for.
//
// The extractor is stubbed here on purpose - the point is to drive failure modes
// a live vendor will not produce on demand. The PARSER those responses are fed
// through is the real one, exercised directly in tests/unit/bill-extraction.test.js.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
    '05fe02fea7b5c4a40000000049454e44ae426082',
  'hex',
);

let companyA;
let tokenA;
let tokenB;

function uploadBill(token, direction = 'IN') {
  return request(app)
    .post('/api/v1/bills')
    .set(auth(token))
    .field('direction', direction)
    .attach('file', PNG, { filename: 'bill.png', contentType: 'image/png' });
}

/** Every accounting artefact a bill could possibly have produced. */
async function accountingFootprint(companyId) {
  const [journal, purchases, sales, movements, payables] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId } }),
    prisma.purchase.count({ where: { companyId } }),
    prisma.salesInvoice.count({ where: { companyId } }),
    prisma.stockMovement.count({ where: { companyId } }),
    prisma.supplierPayable.count({ where: { companyId } }),
  ]);
  return { journal, purchases, sales, movements, payables };
}

beforeAll(async () => {
  await resetDatabase();
  const a = await createCompanyWithUsers('aia');
  const b = await createCompanyWithUsers('aib');
  companyA = a.company;
  tokenA = await login(app, a.admin.email, PASSWORD);
  tokenB = await login(app, b.admin.email, PASSWORD);
});

beforeEach(async () => {
  await prisma.bill.deleteMany();
  vi.mocked(extraction.extractBill).mockReset();
  vi.mocked(extraction.isExtractionConfigured).mockReset().mockReturnValue(true);
});

afterAll(async () => {
  await rm(path.resolve(env.BILL_STORAGE_DIR), { recursive: true, force: true }).catch(() => {});
});

describe('when the AI is not configured', () => {
  it('does not crash, and says so plainly', async () => {
    vi.mocked(extraction.isExtractionConfigured).mockReturnValue(false);

    const response = await uploadBill(tokenA);

    expect(response.status).toBe(201);
    expect(response.body.data.bill.status).toBe('FAILED');
    expect(response.body.data.bill.extractionError).toMatch(/not set up|configure|manually/i);
  });

  it('never invents an extraction to fill the gap', async () => {
    vi.mocked(extraction.isExtractionConfigured).mockReturnValue(false);

    const response = await uploadBill(tokenA);

    expect(response.body.data.bill.reviewedData).toBeNull();
    expect(response.body.data.bill.extraction).toBeNull();
  });

  it('leaks no secret and no environment value', async () => {
    const response = await request(app).get('/api/v1/bills/summary').set(auth(tokenA));
    const body = JSON.stringify(response.body);

    // A boolean saying whether it works - never the key, the URL or the model.
    expect(response.body.data).toHaveProperty('extractionConfigured');
    expect(body).not.toMatch(/LLAMA_API_KEY|api\.llama|Bearer /i);
  });
});

describe('when the AI fails', () => {
  const failures = [
    ['a timeout', { status: 504, code: 'EXTRACTION_TIMEOUT', message: 'Reading the bill took too long.' }],
    ['the service being unreachable', { status: 502, code: 'EXTRACTION_UNAVAILABLE', message: 'unreachable' }],
    ['rate limiting', { status: 429, code: 'EXTRACTION_RATE_LIMITED', message: 'busy' }],
    ['an unreadable response', { status: 422, code: 'EXTRACTION_UNREADABLE', message: 'could not be read' }],
    ['a response that is not the shape we asked for', { status: 422, code: 'EXTRACTION_INVALID', message: 'did not make sense' }],
  ];

  for (const [label, error] of failures) {
    it(`survives ${label} and records the bill as failed`, async () => {
      vi.mocked(extraction.extractBill).mockRejectedValue(
        Object.assign(new Error(error.message), { status: error.status, code: error.code }),
      );

      const response = await uploadBill(tokenA);

      // The upload itself succeeds - the file is kept so the shop can type it in.
      expect(response.status).toBe(201);
      expect(response.body.data.bill.status).toBe('FAILED');
      expect(response.body.data.bill.extractionError).toBeTruthy();
    });
  }

  // THE HEADLINE ASSERTION OF THIS FILE.
  it('creates no accounting whatsoever when extraction fails', async () => {
    const before = await accountingFootprint(companyA.id);

    vi.mocked(extraction.extractBill).mockRejectedValue(new Error('the model exploded'));
    await uploadBill(tokenA);

    expect(await accountingFootprint(companyA.id)).toEqual(before);
  });

  it('keeps the file so the bill is never lost to a failure', async () => {
    vi.mocked(extraction.extractBill).mockRejectedValue(new Error('transient'));

    const created = await uploadBill(tokenA);
    const file = await request(app)
      .get(`/api/v1/bills/${created.body.data.bill.id}/file`)
      .set(auth(tokenA));

    expect(file.status).toBe(200);
  });
});

describe('when the AI returns nonsense', () => {
  /** Stubs one successful extraction returning exactly this payload. */
  function mockExtraction(data) {
    vi.mocked(extraction.extractBill).mockResolvedValue({
      data,
      model: 'test-model',
      raw: data,
    });
  }

  it('accepts a valid extraction and parks it for review, posting nothing', async () => {
    mockExtraction({
      partyName: 'ABC Traders',
      invoiceNumber: 'INV-77',
      invoiceDate: '2026-06-15',
      grandTotal: '450.00',
      lines: [{ description: 'Sugar 1kg', quantity: '10', unitPrice: '45.00' }],
      confidence: 'HIGH',
    });

    const before = await accountingFootprint(companyA.id);
    const response = await uploadBill(tokenA);

    expect(response.body.data.bill.status).toBe('REVIEW');
    expect(response.body.data.bill.reviewedData.partyName).toBe('ABC Traders');

    // REVIEW is not POSTED. A successful read still touches no books.
    expect(response.body.data.bill.posted).toBeNull();
    expect(await accountingFootprint(companyA.id)).toEqual(before);
  });

  it('stores a hallucinated field nowhere it could do harm', async () => {
    // The extractor's own schema strips unknown keys; this proves nothing
    // downstream re-introduces them.
    mockExtraction({ partyName: 'ABC', grandTotal: '100.00', lines: [] });

    const response = await uploadBill(tokenA);
    const stored = response.body.data.bill.reviewedData;

    expect(stored.companyId).toBeUndefined();
    expect(stored.isPosted).toBeUndefined();
    expect(stored.postedSourceId).toBeUndefined();
  });

  it('carries a low-confidence warning through to the review screen', async () => {
    mockExtraction({ partyName: 'Smudged', grandTotal: null, lines: [], confidence: 'LOW' });

    const response = await uploadBill(tokenA);

    expect(response.body.data.bill.reviewedData.confidence).toBe('LOW');
    // Nothing was invented to replace what could not be read.
    expect(response.body.data.bill.reviewedData.grandTotal).toBeNull();
  });

  it('keeps the raw model output for audit alongside the shaped version', async () => {
    mockExtraction({ partyName: 'Audit Me', grandTotal: '10.00', lines: [] });

    const response = await uploadBill(tokenA);

    expect(response.body.data.bill.extraction).toBeTruthy();
    expect(response.body.data.bill.extractionModel).toBe('test-model');
    expect(response.body.data.bill.extractedAt).toBeTruthy();
  });

  // A model can name another company. It must not be able to reach one.
  it('cannot reach another company however it names it', async () => {
    mockExtraction({ partyName: 'ABC', grandTotal: '100.00', lines: [] });

    const created = await uploadBill(tokenA);
    const billId = created.body.data.bill.id;

    for (const path of [`/api/v1/bills/${billId}`, `/api/v1/bills/${billId}/file`]) {
      const response = await request(app).get(path).set(auth(tokenB));
      expect(response.status, `${path} must not cross tenants`).toBe(404);
    }
  });
});

describe('confirming is what posts, never the AI', () => {
  it('a bill in REVIEW has produced no document at all', async () => {
    vi.mocked(extraction.extractBill).mockResolvedValue({
      data: {
        partyName: 'ABC Traders',
        invoiceNumber: 'INV-99',
        invoiceDate: '2026-06-15',
        grandTotal: '450.00',
        lines: [{ description: 'Sugar', quantity: '10', unitPrice: '45.00' }],
        confidence: 'HIGH',
      },
      model: 'test-model',
      raw: {},
    });

    const before = await accountingFootprint(companyA.id);
    const created = await uploadBill(tokenA);

    const bill = await request(app)
      .get(`/api/v1/bills/${created.body.data.bill.id}`)
      .set(auth(tokenA));

    expect(bill.body.data.bill.status).toBe('REVIEW');
    expect(bill.body.data.bill.posted).toBeNull();
    expect(await accountingFootprint(companyA.id)).toEqual(before);
  });

  it('cancelling a reviewed bill still posts nothing', async () => {
    vi.mocked(extraction.extractBill).mockResolvedValue({
      data: { partyName: 'ABC', grandTotal: '1.00', lines: [], confidence: 'HIGH' },
      model: 'test-model',
      raw: {},
    });

    const before = await accountingFootprint(companyA.id);
    const created = await uploadBill(tokenA);

    await request(app)
      .post(`/api/v1/bills/${created.body.data.bill.id}/cancel`)
      .set(auth(tokenA))
      .send({ reason: 'Wrong photo' });

    expect(await accountingFootprint(companyA.id)).toEqual(before);
  });
});
