import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { runMasterDataSuite } from '../helpers/master-data-suite.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

runMasterDataSuite({
  resource: 'customers',
  singular: 'customer',
  payload: (_ctx, suffix = '') => ({
    name: `Acme Traders${suffix ? ` ${suffix}` : ''}`,
    phone: '+91 98765 43210',
    email: 'contact@acme.test',
    gstin: '27AAPFU0939F1ZV',
    openingBalance: '1500.50',
    creditLimit: '50000',
  }),
  update: { name: 'Acme Traders Pvt Ltd' },
  invalid: { name: 'Acme', email: 'not-an-email' },
});

describe('customers: module specific rules', () => {
  let adminToken;

  beforeAll(async () => {
    await resetDatabase();
    const company = await createCompanyWithUsers('alpha');
    adminToken = await login(app, company.admin.email, company.adminPassword);

    await request(app)
      .post('/api/v1/customers')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        name: 'Sunrise Distributors',
        phone: '9876543210',
        email: 'sales@sunrise.test',
        gstin: '29AAGCB1286Q1ZP',
        openingBalance: '2500.75',
      });
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('rejects a duplicate name', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Sunrise Distributors' });

    expect(response.status).toBe(409);
  });

  it('returns money as an exact string, not a float', async () => {
    const response = await request(app).get('/api/v1/customers?search=Sunrise').set(auth());
    const record = response.body.data[0];

    expect(record.openingBalance).toBe('2500.75');
    expect(record.creditLimit).toBe('0.00');
    expect(typeof record.openingBalance).toBe('string');
  });

  it('preserves decimals that a float would corrupt', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Precision Test', openingBalance: '0.10', creditLimit: '0.20' });

    expect(response.body.data.customer.openingBalance).toBe('0.10');
    expect(response.body.data.customer.creditLimit).toBe('0.20');
  });

  it('defaults financial fields to zero', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Minimal Party' });

    expect(response.status).toBe(201);
    expect(response.body.data.customer.openingBalance).toBe('0.00');
    expect(response.body.data.customer.creditLimit).toBe('0.00');
  });

  it('rejects a negative opening balance', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Negative Party', openingBalance: '-100' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.openingBalance');
  });

  it('rejects an invalid GSTIN', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Bad GSTIN Party', gstin: 'NOT-A-GSTIN' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.gstin');
  });

  it('rejects an invalid phone number', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Bad Phone Party', phone: 'call-me' });

    expect(response.status).toBe(400);
  });

  it('searches by phone, email and GSTIN', async () => {
    const byPhone = await request(app).get('/api/v1/customers?search=9876543210').set(auth());
    const byEmail = await request(app).get('/api/v1/customers?search=sunrise.test').set(auth());
    const byGstin = await request(app).get('/api/v1/customers?search=29AAGCB').set(auth());

    expect(byPhone.body.data.length).toBeGreaterThan(0);
    expect(byEmail.body.data.length).toBeGreaterThan(0);
    expect(byGstin.body.data.length).toBeGreaterThan(0);
  });

  it('accepts a party with only a name', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set(auth())
      .send({ name: 'Walk In Party' });

    expect(response.status).toBe(201);
    expect(response.body.data.customer.phone).toBeNull();
    expect(response.body.data.customer.gstin).toBeNull();
  });
});
