import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { runMasterDataSuite } from '../helpers/master-data-suite.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** A product needs a category and a unit, so create them per company first. */
async function prepareProductDependencies(_companyId, token) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: 'Tablets' });

  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: 'Strip', shortCode: 'STR' });

  const tax = await request(app)
    .post('/api/v1/taxes')
    .set(auth(token))
    .send({ name: 'GST 12%', rate: '12' });

  return {
    categoryId: category.body.data?.category?.id,
    unitId: unit.body.data?.unit?.id,
    taxId: tax.body.data?.tax?.id,
  };
}

runMasterDataSuite({
  resource: 'products',
  singular: 'product',
  prepare: prepareProductDependencies,
  payload: (ctx, suffix = '') => ({
    name: `Paracetamol 500mg${suffix ? ` ${suffix}` : ''}`,
    sku: suffix ? `SKU-${suffix.toUpperCase()}` : 'SKU-PARA-500',
    barcode: suffix ? `BAR${suffix}` : '8901234567890',
    categoryId: ctx.categoryId,
    unitId: ctx.unitId,
    taxId: ctx.taxId,
    purchasePrice: '18.5000',
    sellingPrice: '25.00',
    reorderLevel: '100',
  }),
  update: { name: 'Paracetamol 650mg' },
  invalid: { name: 'No Relations Product' },
});

describe('products: relationships, identifiers and pricing', () => {
  let companyA;
  let companyB;
  let adminA;
  let adminB;
  let ctxA;
  let ctxB;

  beforeAll(async () => {
    await resetDatabase();

    companyA = await createCompanyWithUsers('alpha');
    companyB = await createCompanyWithUsers('beta');

    adminA = await login(app, companyA.admin.email, companyA.adminPassword);
    adminB = await login(app, companyB.admin.email, companyB.adminPassword);

    ctxA = await prepareProductDependencies(companyA.company.id, adminA);
    ctxB = await prepareProductDependencies(companyB.company.id, adminB);

    await request(app)
      .post('/api/v1/products')
      .set(auth(adminA))
      .send({
        name: 'Amoxicillin 250mg',
        sku: 'SKU-AMOX-250',
        barcode: '8909999999999',
        categoryId: ctxA.categoryId,
        unitId: ctxA.unitId,
        taxId: ctxA.taxId,
        purchasePrice: '40.25',
        sellingPrice: '55.75',
      });
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  describe('cross-company relationships are rejected', () => {
    it('rejects a category belonging to another company', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Cross Category Product',
          categoryId: ctxB.categoryId, // company B
          unitId: ctxA.unitId,
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('body.categoryId');
    });

    it('rejects a unit belonging to another company', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Cross Unit Product',
          categoryId: ctxA.categoryId,
          unitId: ctxB.unitId, // company B
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('body.unitId');
    });

    it('rejects a tax belonging to another company', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Cross Tax Product',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
          taxId: ctxB.taxId, // company B
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('body.taxId');
    });

    it('rejects a cross-company category on update too', async () => {
      const created = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Updatable Product',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
        });

      const response = await request(app)
        .patch(`/api/v1/products/${created.body.data.product.id}`)
        .set(auth(adminA))
        .send({ categoryId: ctxB.categoryId });

      expect(response.status).toBe(400);

      // The product must be unchanged.
      const after = await request(app)
        .get(`/api/v1/products/${created.body.data.product.id}`)
        .set(auth(adminA));
      expect(after.body.data.product.category.id).toBe(ctxA.categoryId);
    });

    it('gives the same error for a non-existent category as for another company one', async () => {
      const missing = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Missing Category Product',
          categoryId: '00000000-0000-4000-8000-000000000000',
          unitId: ctxA.unitId,
        });

      const otherCompany = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Other Company Category Product',
          categoryId: ctxB.categoryId,
          unitId: ctxA.unitId,
        });

      // Identical responses, so the API never confirms that the id exists elsewhere.
      expect(missing.status).toBe(otherCompany.status);
      expect(missing.body.message).toBe(otherCompany.body.message);
    });
  });

  describe('required relationships', () => {
    it('requires a category', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({ name: 'No Category', unitId: ctxA.unitId });

      expect(response.status).toBe(400);
      expect(response.body.errors.some((e) => e.field === 'body.categoryId')).toBe(true);
    });

    it('requires a unit', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({ name: 'No Unit', categoryId: ctxA.categoryId });

      expect(response.status).toBe(400);
      expect(response.body.errors.some((e) => e.field === 'body.unitId')).toBe(true);
    });

    it('allows a product without a tax', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({ name: 'Untaxed Product', categoryId: ctxA.categoryId, unitId: ctxA.unitId });

      expect(response.status).toBe(201);
      expect(response.body.data.product.tax).toBeNull();
    });
  });

  describe('SKU and barcode', () => {
    it('rejects a duplicate SKU in the same company', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Duplicate SKU Product',
          sku: 'SKU-AMOX-250',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('SKU');
    });

    it('rejects a duplicate barcode in the same company', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Duplicate Barcode Product',
          barcode: '8909999999999',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('barcode');
    });

    it('allows another company to reuse the same SKU and barcode', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminB))
        .send({
          name: 'Amoxicillin 250mg',
          sku: 'SKU-AMOX-250',
          barcode: '8909999999999',
          categoryId: ctxB.categoryId,
          unitId: ctxB.unitId,
        });

      expect(response.status).toBe(201);
    });

    it('allows several products without a SKU or barcode', async () => {
      const first = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({ name: 'No Code One', categoryId: ctxA.categoryId, unitId: ctxA.unitId });

      const second = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({ name: 'No Code Two', categoryId: ctxA.categoryId, unitId: ctxA.unitId });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.product.sku).toBeNull();
    });

    it('stores the SKU upper-cased', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Lowercase Sku Product',
          sku: 'sku-lower-1',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
        });

      expect(response.body.data.product.sku).toBe('SKU-LOWER-1');
    });
  });

  describe('pricing and stock', () => {
    it('returns money as exact strings', async () => {
      const response = await request(app).get('/api/v1/products?search=Amoxicillin').set(auth(adminA));
      const product = response.body.data[0];

      expect(product.purchasePrice).toBe('40.25');
      expect(product.sellingPrice).toBe('55.75');
      expect(typeof product.purchasePrice).toBe('string');
    });

    it('preserves decimals that a float would corrupt', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Float Trap Product',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
          purchasePrice: '0.10',
          sellingPrice: '0.20',
        });

      expect(response.body.data.product.purchasePrice).toBe('0.10');
      expect(response.body.data.product.sellingPrice).toBe('0.20');
    });

    it('defaults prices and reorder level to zero', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({ name: 'Default Price Product', categoryId: ctxA.categoryId, unitId: ctxA.unitId });

      expect(response.body.data.product.purchasePrice).toBe('0.00');
      expect(response.body.data.product.reorderLevel).toBe('0.000');
    });

    it('rejects a negative price', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set(auth(adminA))
        .send({
          name: 'Negative Price Product',
          categoryId: ctxA.categoryId,
          unitId: ctxA.unitId,
          sellingPrice: '-10',
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('body.sellingPrice');
    });

    it('never exposes a stock quantity field', async () => {
      const response = await request(app).get('/api/v1/products').set(auth(adminA));
      const body = JSON.stringify(response.body);

      expect(body).not.toContain('stockQuantity');
      expect(body).not.toContain('quantityInStock');
      expect(body.toLowerCase()).not.toContain('"stock"');
    });
  });

  describe('list filters and shape', () => {
    it('embeds category, unit and tax without exposing internals', async () => {
      const response = await request(app).get('/api/v1/products?search=Amoxicillin').set(auth(adminA));
      const product = response.body.data[0];

      expect(product.category).toEqual({ id: ctxA.categoryId, name: 'Tablets' });
      expect(product.unit).toEqual({ id: ctxA.unitId, name: 'Strip', shortCode: 'STR' });
      expect(product.tax).toEqual({ id: ctxA.taxId, name: 'GST 12%', rate: '12.00' });
      expect(product.categoryId).toBeUndefined();
      expect(product.companyId).toBeUndefined();
    });

    it('filters by categoryId', async () => {
      const response = await request(app)
        .get(`/api/v1/products?categoryId=${ctxA.categoryId}`)
        .set(auth(adminA));

      expect(response.status).toBe(200);
      expect(response.body.data.every((p) => p.category.id === ctxA.categoryId)).toBe(true);
    });

    it('filters by unitId and taxId', async () => {
      const byUnit = await request(app)
        .get(`/api/v1/products?unitId=${ctxA.unitId}`)
        .set(auth(adminA));
      const byTax = await request(app).get(`/api/v1/products?taxId=${ctxA.taxId}`).set(auth(adminA));

      expect(byUnit.status).toBe(200);
      expect(byTax.body.data.every((p) => p.tax?.id === ctxA.taxId)).toBe(true);
    });

    it('rejects a malformed filter id', async () => {
      const response = await request(app).get('/api/v1/products?categoryId=nope').set(auth(adminA));

      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('query.categoryId');
    });

    it('searches by SKU and barcode', async () => {
      const bySku = await request(app).get('/api/v1/products?search=SKU-AMOX').set(auth(adminA));
      const byBarcode = await request(app)
        .get('/api/v1/products?search=8909999999999')
        .set(auth(adminA));

      expect(bySku.body.data.length).toBeGreaterThan(0);
      expect(byBarcode.body.data.length).toBeGreaterThan(0);
    });

    it('does not return another company products even with a matching filter', async () => {
      const response = await request(app)
        .get(`/api/v1/products?categoryId=${ctxB.categoryId}`)
        .set(auth(adminA));

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });
  });
});
