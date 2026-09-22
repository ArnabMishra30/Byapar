import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// The GST configuration surface: the company's own registration, the HSN/SAC
// master, GSTIN validation, RBAC and tenant isolation.
//
// Document taxation lives in gst-documents.test.js.

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;

const VALID_GSTIN_27 = '27AAPFU0939F1ZV'; // Maharashtra
const VALID_GSTIN_24 = '24AAACC1206D1ZM'; // Gujarat

const getProfile = (token) => request(app).get('/api/v1/tax/profile').set(auth(token));
const patchProfile = (token, body) =>
  request(app).patch('/api/v1/tax/profile').set(auth(token)).send(body);
const createHsn = (token, body) =>
  request(app).post('/api/v1/tax/classifications').set(auth(token)).send(body);

let hsnCounter = 0;
const nextHsn = () => String(30049000 + (hsnCounter += 1));

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('gstalpha');
  companyB = await createCompanyWithUsers('gstbeta');

  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  staffA = await login(app, companyA.staff.email, companyA.staffPassword);
  adminB = await login(app, companyB.admin.email, companyB.adminPassword);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('company GST profile', () => {
  it('starts unregistered, with GST switched off', async () => {
    const response = await getProfile(adminA);

    expect(response.status).toBe(200);
    expect(response.body.data.gstProfile.gstEnabled).toBe(false);
    expect(response.body.data.gstProfile.stateCode).toBeNull();
    expect(response.body.data.gstProfile.registrationType).toBe('UNREGISTERED');
  });

  it('turns GST on when a state code is set', async () => {
    const response = await patchProfile(adminA, {
      stateCode: '27',
      legalName: 'Alpha Pharma Private Limited',
      registeredAddress: '12 Marine Drive, Mumbai',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.gstProfile.gstEnabled).toBe(true);
    expect(response.body.data.gstProfile.stateCode).toBe('27');
    expect(response.body.data.gstProfile.stateName).toBe('Maharashtra');
    expect(response.body.data.gstProfile.legalName).toBe('Alpha Pharma Private Limited');
  });

  it('accepts a GSTIN whose state matches, and reports the checksum', async () => {
    const response = await patchProfile(adminA, {
      gstin: VALID_GSTIN_27,
      registrationType: 'REGULAR',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.gstProfile.gstin).toBe(VALID_GSTIN_27);
    expect(response.body.data.gstProfile.gstinChecksumValid).toBe(true);
    expect(response.body.data.gstProfile.registrationType).toBe('REGULAR');
  });

  it('rejects a GSTIN whose embedded state disagrees with the company state', async () => {
    // The GSTIN is registered in Gujarat; the company says Maharashtra. One of
    // the two is wrong, and guessing which would misprint every invoice.
    const response = await patchProfile(adminA, { gstin: VALID_GSTIN_24 });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('GSTIN_STATE_MISMATCH');

    const unchanged = await getProfile(adminA);
    expect(unchanged.body.data.gstProfile.gstin).toBe(VALID_GSTIN_27);
  });

  it('rejects a GSTIN that fails the checksum', async () => {
    const response = await patchProfile(adminA, { gstin: '27AAPFU0939F1ZX' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_GSTIN');
    expect(response.body.message).toMatch(/checksum/i);
  });

  it('rejects an invalid state code', async () => {
    const response = await patchProfile(adminA, { stateCode: '55' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('GST_INVALID_STATE');
  });

  it('rejects a malformed state code before it reaches the service', async () => {
    const response = await patchProfile(adminA, { stateCode: '7' });
    expect(response.status).toBe(400);
  });

  it('refuses a REGULAR registration with no GSTIN', async () => {
    const response = await patchProfile(adminB, { registrationType: 'REGULAR' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('GSTIN_REQUIRED');
  });

  it('refuses a GSTIN that already belongs to another company', async () => {
    await patchProfile(adminB, { stateCode: '27' });
    const response = await patchProfile(adminB, { gstin: VALID_GSTIN_27 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('GSTIN_TAKEN');
  });

  it('requires at least one field', async () => {
    const response = await patchProfile(adminA, {});
    expect(response.status).toBe(400);
  });
});

describe('GSTIN validation endpoint', () => {
  it('accepts a valid GSTIN and reads its state and PAN', async () => {
    const response = await request(app)
      .post('/api/v1/tax/validate-gstin')
      .set(auth(staffA))
      .send({ gstin: VALID_GSTIN_27 });

    expect(response.status).toBe(200);
    expect(response.body.data.gstin.valid).toBe(true);
    expect(response.body.data.gstin.stateCode).toBe('27');
    expect(response.body.data.gstin.stateName).toBe('Maharashtra');
    expect(response.body.data.gstin.pan).toBe('AAPFU0939F');
  });

  it('never claims a valid GSTIN is a registered one', async () => {
    const response = await request(app)
      .post('/api/v1/tax/validate-gstin')
      .set(auth(adminA))
      .send({ gstin: VALID_GSTIN_27 });

    // The API says out loud what it did and did not check.
    expect(response.body.data.gstin.note).toMatch(/does not confirm/i);
  });

  it('explains why an invalid GSTIN was rejected', async () => {
    const cases = [
      ['27AAPFU0939F1Z', /15 characters/],
      ['55AAPFU0939F1ZV', /state code/],
      ['27AAPFU0939F1ZX', /checksum/],
      ['27AAPFU0939F1AV', /structure/],
    ];

    for (const [gstin, expected] of cases) {
      const response = await request(app)
        .post('/api/v1/tax/validate-gstin')
        .set(auth(adminA))
        .send({ gstin });

      expect(`${gstin}:${response.body.data.gstin.valid}`).toBe(`${gstin}:false`);
      expect(response.body.data.gstin.reason).toMatch(expected);
    }
  });

  it('requires a GSTIN in the body', async () => {
    const response = await request(app)
      .post('/api/v1/tax/validate-gstin')
      .set(auth(adminA))
      .send({});
    expect(response.status).toBe(400);
  });
});

describe('GST state list', () => {
  it('serves the state codes for a form', async () => {
    const response = await request(app).get('/api/v1/tax/states').set(auth(staffA));

    expect(response.status).toBe(200);
    expect(response.body.data.states.length).toBeGreaterThan(35);
    expect(response.body.data.states).toContainEqual({ code: '27', name: 'Maharashtra' });
  });
});

describe('HSN / SAC classification', () => {
  it('creates an HSN code', async () => {
    const code = nextHsn();
    const response = await createHsn(adminA, {
      code,
      kind: 'HSN',
      description: 'Medicaments, other',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.classification.code).toBe(code);
    expect(response.body.data.classification.kind).toBe('HSN');
    expect(response.body.data.classification.isActive).toBe(true);
  });

  it('creates a SAC code for services', async () => {
    const response = await createHsn(adminA, {
      code: '998311',
      kind: 'SAC',
      description: 'Management consulting',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.classification.kind).toBe('SAC');
  });

  it('rejects a duplicate code within the company', async () => {
    const code = nextHsn();
    await createHsn(adminA, { code });

    const response = await createHsn(adminA, { code });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('TAX_CLASSIFICATION_CODE_TAKEN');
  });

  it('allows the same code in another company', async () => {
    const code = nextHsn();
    const first = await createHsn(adminA, { code });
    const second = await createHsn(adminB, { code });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.classification.id).not.toBe(second.body.data.classification.id);
  });

  it('rejects a code that is not 4 to 8 digits', async () => {
    for (const code of ['30', '123456789', '3004ABCD', '']) {
      const response = await createHsn(adminA, { code });
      expect(`${code}:${response.status}`).toBe(`${code}:400`);
    }
  });

  it('attaches a default tax that must exist in this company', async () => {
    const tax = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'HSN GST 12%', rate: '12' });

    const ok = await createHsn(adminA, {
      code: nextHsn(),
      defaultTaxId: tax.body.data.tax.id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.classification.defaultTax.rate).toBe('12.00');

    // Company B's tax does not exist as far as company A is concerned.
    const foreignTax = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminB))
      .send({ name: 'Beta GST 12%', rate: '12' });

    const rejected = await createHsn(adminA, {
      code: nextHsn(),
      defaultTaxId: foreignTax.body.data.tax.id,
    });
    expect(rejected.status).toBe(404);
    expect(rejected.body.code).toBe('TAX_NOT_FOUND');
  });

  it('deactivates a classification but keeps its code', async () => {
    const code = nextHsn();
    const created = await createHsn(adminA, { code });

    const response = await request(app)
      .patch(`/api/v1/tax/classifications/${created.body.data.classification.id}`)
      .set(auth(adminA))
      .send({ isActive: false, code: '99999999' });

    expect(response.status).toBe(200);
    expect(response.body.data.classification.isActive).toBe(false);
    // The code is never editable: documents froze it onto their lines.
    expect(response.body.data.classification.code).toBe(code);
  });

  it('lists and filters classifications', async () => {
    const response = await request(app)
      .get('/api/v1/tax/classifications?kind=SAC&limit=100')
      .set(auth(staffA));

    expect(response.status).toBe(200);
    expect(response.body.data.every((row) => row.kind === 'SAC')).toBe(true);
  });

  it('reports how many products use a classification', async () => {
    const created = await createHsn(adminA, { code: nextHsn() });

    const response = await request(app)
      .get(`/api/v1/tax/classifications/${created.body.data.classification.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.classification.productCount).toBe(0);
  });
});

describe('assigning a classification to a product', () => {
  let categoryId;
  let unitId;
  let productCounter = 0;

  beforeAll(async () => {
    const category = await request(app)
      .post('/api/v1/categories')
      .set(auth(adminA))
      .send({ name: 'HSN Test Category' });
    const unit = await request(app)
      .post('/api/v1/units')
      .set(auth(adminA))
      .send({ name: 'HSN Test Unit', shortCode: 'HTU' });

    categoryId = category.body.data.category.id;
    unitId = unit.body.data.unit.id;
  });

  const makeProduct = (body) =>
    request(app)
      .post('/api/v1/products')
      .set(auth(adminA))
      .send({
        name: `HSN Product ${(productCounter += 1)}`,
        sku: `HSN-SKU-${productCounter}`,
        categoryId,
        unitId,
        ...body,
      });

  it('attaches an active classification', async () => {
    const hsn = await createHsn(adminA, { code: nextHsn() });

    const response = await makeProduct({
      taxClassificationId: hsn.body.data.classification.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.product.taxClassification.code).toBe(
      hsn.body.data.classification.code,
    );
  });

  it('refuses an inactive classification', async () => {
    const hsn = await createHsn(adminA, { code: nextHsn() });
    await request(app)
      .patch(`/api/v1/tax/classifications/${hsn.body.data.classification.id}`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await makeProduct({
      taxClassificationId: hsn.body.data.classification.id,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('TAX_CLASSIFICATION_INACTIVE');
  });

  it("refuses another company's classification", async () => {
    const foreign = await createHsn(adminB, { code: nextHsn() });

    const response = await makeProduct({
      taxClassificationId: foreign.body.data.classification.id,
    });

    expect(response.status).toBe(400);
  });
});

describe('tax master GST components', () => {
  it('derives the CGST/SGST/IGST split from the headline rate', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Derived GST 18%', rate: '18' });

    expect(response.status).toBe(201);
    const tax = response.body.data.tax;
    expect(tax.cgstRate).toBe('9.00');
    expect(tax.sgstRate).toBe('9.00');
    expect(tax.igstRate).toBe('18.00');
    expect(tax.cessRate).toBe('0.00');
    expect(tax.treatment).toBe('TAXABLE');
  });

  it('accepts an explicit split that adds up', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Explicit GST 5%', rate: '5', cgstRate: '2.5', sgstRate: '2.5', igstRate: '5' });

    expect(response.status).toBe(201);
    expect(response.body.data.tax.cgstRate).toBe('2.50');
  });

  it('rejects a split that does not add up to the rate', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Broken split', rate: '18', cgstRate: '9', sgstRate: '8', igstRate: '18' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('TAX_COMPONENT_MISMATCH');
  });

  it('rejects an IGST that disagrees with the rate', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Broken igst', rate: '18', cgstRate: '9', sgstRate: '9', igstRate: '12' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('TAX_COMPONENT_MISMATCH');
  });

  it('records an explicit tax treatment', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Exempt supply', rate: '0', treatment: 'EXEMPT' });

    expect(response.status).toBe(201);
    expect(response.body.data.tax.treatment).toBe('EXEMPT');
  });

  it('records an effective window and rejects a reversed one', async () => {
    const ok = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({
        name: 'Windowed GST 12%',
        rate: '12',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
      });

    expect(ok.status).toBe(201);
    expect(ok.body.data.tax.effectiveFrom).toBe('2026-04-01');
    expect(ok.body.data.tax.effectiveTo).toBe('2027-03-31');

    const reversed = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Reversed window', rate: '12', effectiveFrom: '2027-04-01', effectiveTo: '2026-03-31' });

    expect(reversed.status).toBe(400);
  });

  it('re-derives the split when the rate is changed', async () => {
    const created = await request(app)
      .post('/api/v1/taxes')
      .set(auth(adminA))
      .send({ name: 'Changing rate', rate: '12' });

    const updated = await request(app)
      .patch(`/api/v1/taxes/${created.body.data.tax.id}`)
      .set(auth(adminA))
      .send({ rate: '28' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.tax.rate).toBe('28.00');
    expect(updated.body.data.tax.cgstRate).toBe('14.00');
    expect(updated.body.data.tax.igstRate).toBe('28.00');
  });
});

describe('GST RBAC', () => {
  it('lets STAFF read configuration and summaries', async () => {
    for (const path of [
      '/api/v1/tax/profile',
      '/api/v1/tax/states',
      '/api/v1/tax/classifications',
      '/api/v1/tax/gst-summary',
      '/api/v1/tax/input-tax',
      '/api/v1/tax/output-tax',
      '/api/v1/tax/gst-purchases',
      '/api/v1/tax/gst-sales',
    ]) {
      const response = await request(app).get(path).set(auth(staffA));
      expect(`${path}:${response.status}`).toBe(`${path}:200`);
    }
  });

  it('refuses to let STAFF change the GST registration', async () => {
    const response = await patchProfile(staffA, { legalName: 'Staff Rename' });
    expect(response.status).toBe(403);
  });

  it('refuses to let STAFF create or edit an HSN code', async () => {
    const created = await createHsn(staffA, { code: nextHsn() });
    expect(created.status).toBe(403);

    const existing = await createHsn(adminA, { code: nextHsn() });
    const updated = await request(app)
      .patch(`/api/v1/tax/classifications/${existing.body.data.classification.id}`)
      .set(auth(staffA))
      .send({ description: 'hijacked' });
    expect(updated.status).toBe(403);
  });

  it('requires authentication everywhere', async () => {
    for (const path of ['/api/v1/tax/profile', '/api/v1/tax/classifications', '/api/v1/tax/gst-summary']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
    }
  });
});

describe('GST tenant isolation', () => {
  it("never returns another company's GST profile", async () => {
    const a = await getProfile(adminA);
    const b = await getProfile(adminB);

    expect(a.body.data.gstProfile.companyId).toBe(companyA.company.id);
    expect(b.body.data.gstProfile.companyId).toBe(companyB.company.id);
    expect(a.body.data.gstProfile.gstin).not.toBe(b.body.data.gstProfile.gstin);
  });

  it("returns 404 for another company's classification", async () => {
    const foreign = await createHsn(adminB, { code: nextHsn() });
    const id = foreign.body.data.classification.id;

    const read = await request(app)
      .get(`/api/v1/tax/classifications/${id}`)
      .set(auth(adminA));
    const updated = await request(app)
      .patch(`/api/v1/tax/classifications/${id}`)
      .set(auth(adminA))
      .send({ description: 'hijacked' });

    expect(read.status).toBe(404);
    expect(updated.status).toBe(404);

    const intact = await request(app).get(`/api/v1/tax/classifications/${id}`).set(auth(adminB));
    expect(intact.body.data.classification.description).not.toBe('hijacked');
  });

  it('never lists another company classifications', async () => {
    const foreign = await createHsn(adminB, { code: nextHsn() });

    const response = await request(app)
      .get('/api/v1/tax/classifications?limit=100')
      .set(auth(adminA));

    expect(response.body.data.map((row) => row.id)).not.toContain(
      foreign.body.data.classification.id,
    );
  });

  it('ignores a companyId sent in the body', async () => {
    const code = nextHsn();
    const response = await createHsn(adminA, { code, companyId: companyB.company.id });

    expect(response.status).toBe(201);
    const stored = await prisma.taxClassification.findFirst({
      where: { code, companyId: companyA.company.id },
    });
    expect(stored).toBeTruthy();
  });
});
