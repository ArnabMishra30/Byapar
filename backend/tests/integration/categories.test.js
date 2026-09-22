import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { runMasterDataSuite } from '../helpers/master-data-suite.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

runMasterDataSuite({
  resource: 'categories',
  singular: 'category',
  payload: (_ctx, suffix = '') => ({
    name: `Medicine${suffix ? ` ${suffix}` : ''}`,
    description: 'Pharmaceutical products',
  }),
  update: { name: 'Renamed Category' },
  invalid: { name: 'A' },
});

describe('categories: module specific rules', () => {
  let adminToken;

  beforeAll(async () => {
    await resetDatabase();
    const company = await createCompanyWithUsers('alpha');
    adminToken = await login(app, company.admin.email, company.adminPassword);

    await request(app)
      .post('/api/v1/categories')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ name: 'Antibiotics', description: 'Antibiotic medicines' });
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('rejects a duplicate name in the same company', async () => {
    const response = await request(app)
      .post('/api/v1/categories')
      .set(auth())
      .send({ name: 'Antibiotics' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('already exists');
  });

  it('rejects a duplicate name that differs only by case', async () => {
    const response = await request(app)
      .post('/api/v1/categories')
      .set(auth())
      .send({ name: 'antibiotics' });

    expect(response.status).toBe(409);
  });

  it('searches by name, case-insensitively', async () => {
    const response = await request(app).get('/api/v1/categories?search=ANTIBIO').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Antibiotics');
  });

  it('searches by description', async () => {
    const response = await request(app).get('/api/v1/categories?search=medicines').set(auth());
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('accepts a category without a description', async () => {
    const response = await request(app).post('/api/v1/categories').set(auth()).send({ name: 'Syrups' });

    expect(response.status).toBe(201);
    expect(response.body.data.category.description).toBeNull();
  });

  it('rejects a description longer than 1000 characters', async () => {
    const response = await request(app)
      .post('/api/v1/categories')
      .set(auth())
      .send({ name: 'Long', description: 'x'.repeat(1001) });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.description');
  });
});
