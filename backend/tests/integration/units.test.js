import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { runMasterDataSuite } from '../helpers/master-data-suite.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

runMasterDataSuite({
  resource: 'units',
  singular: 'unit',
  payload: (_ctx, suffix = '') => ({
    name: `Piece${suffix ? ` ${suffix}` : ''}`,
    shortCode: suffix ? `P${suffix.slice(0, 3)}` : 'PCS',
  }),
  update: { name: 'Pieces' },
  invalid: { name: 'Piece' },
});

describe('units: module specific rules', () => {
  let adminToken;

  beforeAll(async () => {
    await resetDatabase();
    const company = await createCompanyWithUsers('alpha');
    adminToken = await login(app, company.admin.email, company.adminPassword);

    await request(app)
      .post('/api/v1/units')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ name: 'Kilogram', shortCode: 'KG' });
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('rejects a duplicate name', async () => {
    const response = await request(app)
      .post('/api/v1/units')
      .set(auth())
      .send({ name: 'Kilogram', shortCode: 'KGS' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('name');
  });

  it('rejects a duplicate short code', async () => {
    const response = await request(app)
      .post('/api/v1/units')
      .set(auth())
      .send({ name: 'Kilo Gram', shortCode: 'KG' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('short code');
  });

  it('rejects a duplicate short code that differs only by case', async () => {
    const response = await request(app)
      .post('/api/v1/units')
      .set(auth())
      .send({ name: 'Another', shortCode: 'kg' });

    expect(response.status).toBe(409);
  });

  it('stores the short code upper-cased', async () => {
    const response = await request(app)
      .post('/api/v1/units')
      .set(auth())
      .send({ name: 'Litre', shortCode: 'l' });

    expect(response.status).toBe(201);
    expect(response.body.data.unit.shortCode).toBe('L');
  });

  it('requires a short code', async () => {
    const response = await request(app).post('/api/v1/units').set(auth()).send({ name: 'Bottle' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.shortCode');
  });

  it('searches by short code', async () => {
    const response = await request(app).get('/api/v1/units?search=KG').set(auth());
    expect(response.body.data.some((unit) => unit.shortCode === 'KG')).toBe(true);
  });
});
