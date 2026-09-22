import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { runMasterDataSuite } from '../helpers/master-data-suite.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

runMasterDataSuite({
  resource: 'taxes',
  singular: 'tax',
  payload: (_ctx, suffix = '') => ({
    name: `GST 18%${suffix ? ` ${suffix}` : ''}`,
    rate: '18.00',
  }),
  update: { name: 'GST 18 percent' },
  invalid: { name: 'GST 18%', rate: '150' },
});

describe('taxes: module specific rules', () => {
  let adminToken;

  beforeAll(async () => {
    await resetDatabase();
    const company = await createCompanyWithUsers('alpha');
    adminToken = await login(app, company.admin.email, company.adminPassword);

    await request(app)
      .post('/api/v1/taxes')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ name: 'GST 5%', rate: 5 });
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('rejects a duplicate name', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'GST 5%', rate: '5.00' });

    expect(response.status).toBe(409);
  });

  it('returns the rate as a string, never a float', async () => {
    const response = await request(app).get('/api/v1/taxes').set(auth());
    const tax = response.body.data.find((item) => item.name === 'GST 5%');

    expect(tax.rate).toBe('5.00');
    expect(typeof tax.rate).toBe('string');
  });

  it('accepts a numeric rate and stores it exactly', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'GST 12.5%', rate: 12.5 });

    expect(response.status).toBe(201);
    expect(response.body.data.tax.rate).toBe('12.50');
  });

  it('rejects a rate above 100', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'Impossible', rate: '101' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.rate');
  });

  it('rejects a negative rate', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'Negative', rate: '-5' });

    expect(response.status).toBe(400);
  });

  it('rejects a rate with more than 2 decimal places', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'Too Precise', rate: '18.005' });

    expect(response.status).toBe(400);
  });

  it('rejects an unknown tax type', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'VAT 10%', rate: '10', type: 'VAT' });

    expect(response.status).toBe(400);
  });

  it('defaults the type to GST', async () => {
    const response = await request(app)
      .post('/api/v1/taxes')
      .set(auth())
      .send({ name: 'GST 28%', rate: '28' });

    expect(response.body.data.tax.type).toBe('GST');
  });
});
