import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { runMasterDataSuite } from '../helpers/master-data-suite.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

runMasterDataSuite({
  resource: 'warehouses',
  singular: 'warehouse',
  payload: (_ctx, suffix = '') => ({
    name: `Main Store${suffix ? ` ${suffix}` : ''}`,
    code: suffix ? `W${suffix.slice(0, 4)}` : 'MAIN',
    address: '12 MG Road, Pune',
  }),
  update: { name: 'Main Warehouse' },
  invalid: { name: 'Main Store' },
});

describe('warehouses: module specific rules', () => {
  let adminToken;

  beforeAll(async () => {
    await resetDatabase();
    const company = await createCompanyWithUsers('alpha');
    adminToken = await login(app, company.admin.email, company.adminPassword);

    await request(app)
      .post('/api/v1/warehouses')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ name: 'Cold Storage', code: 'COLD', address: 'Unit 4' });
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('rejects a duplicate name', async () => {
    const response = await request(app)
      .post('/api/v1/warehouses')
      .set(auth())
      .send({ name: 'Cold Storage', code: 'COLD2' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('name');
  });

  it('rejects a duplicate code', async () => {
    const response = await request(app)
      .post('/api/v1/warehouses')
      .set(auth())
      .send({ name: 'Cold Storage 2', code: 'COLD' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('code');
  });

  it('stores the code upper-cased', async () => {
    const response = await request(app)
      .post('/api/v1/warehouses')
      .set(auth())
      .send({ name: 'Branch Store', code: 'br1' });

    expect(response.body.data.warehouse.code).toBe('BR1');
  });

  it('requires a code', async () => {
    const response = await request(app)
      .post('/api/v1/warehouses')
      .set(auth())
      .send({ name: 'No Code Store' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.code');
  });

  it('accepts a warehouse without an address', async () => {
    const response = await request(app)
      .post('/api/v1/warehouses')
      .set(auth())
      .send({ name: 'Transit Point', code: 'TRN' });

    expect(response.status).toBe(201);
    expect(response.body.data.warehouse.address).toBeNull();
  });

  it('does not expose any stock field', async () => {
    const response = await request(app).get('/api/v1/warehouses').set(auth());
    const body = JSON.stringify(response.body).toLowerCase();

    expect(body).not.toContain('stock');
    expect(body).not.toContain('quantity');
  });
});
