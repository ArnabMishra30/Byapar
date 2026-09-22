import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import {
  prisma,
  resetDatabase,
  createCompanyWithUsers,
  createPlan,
  login,
} from '../helpers/db.js';

// THE PRICE LIST, PUBLICLY.
//
// The marketing site has to show prices, and a price list is public by
// definition. This is the ONLY unauthenticated route in the platform module, so
// it is worth being precise about what it does and does not reveal.

const PASSWORD = 'test-password-123';

beforeEach(async () => {
  await resetDatabase();
});

describe('GET /api/v1/public/plans', () => {
  it('needs no token at all', async () => {
    await createPlan({ name: '3 Months', price: '300.0000' });

    const response = await request(app).get('/api/v1/public/plans');

    expect(response.status).toBe(200);
    expect(response.body.data.plans).toHaveLength(1);
  });

  it('returns the price and duration a pricing page needs', async () => {
    await createPlan({ name: '6 Months', price: '500.0000', durationValue: 6 });

    const response = await request(app).get('/api/v1/public/plans');
    const plan = response.body.data.plans[0];

    expect(plan.name).toBe('6 Months');
    expect(plan.price).toBe('500.00');
    expect(plan.durationLabel).toBe('6 months');
    expect(plan.currency).toBe('INR');
  });

  // A pricing page must never advertise something a rep cannot sell.
  it('lists only plans that are actually on sale', async () => {
    await createPlan({ name: 'On Sale', price: '300.0000', isActive: true });
    await createPlan({ name: 'Withdrawn', price: '100.0000', isActive: false });

    const response = await request(app).get('/api/v1/public/plans');
    const names = response.body.data.plans.map((plan) => plan.name);

    expect(names).toContain('On Sale');
    expect(names).not.toContain('Withdrawn');
  });

  it('returns an empty list rather than an error when nothing is on sale', async () => {
    const response = await request(app).get('/api/v1/public/plans');

    expect(response.status).toBe(200);
    expect(response.body.data.plans).toEqual([]);
  });

  // WHAT AN ANONYMOUS CALLER MUST NOT LEARN.
  it('reveals nothing about the operator business', async () => {
    const { company } = await createCompanyWithUsers('secret');
    await createPlan({ name: '3 Months', price: '300.0000' });

    const response = await request(app).get('/api/v1/public/plans');
    const body = JSON.stringify(response.body);

    // No shops, no subscriber counts, no revenue, no internal flags.
    expect(body).not.toContain(company.id);
    expect(body).not.toContain('secret Company');
    expect(body).not.toMatch(/subscriberCount|revenue|isActive|createdAt|updatedAt/);
  });

  it('exposes only the fields a pricing page uses', async () => {
    await createPlan({ name: '3 Months', price: '300.0000' });

    const response = await request(app).get('/api/v1/public/plans');
    const keys = Object.keys(response.body.data.plans[0]).sort();

    expect(keys).toEqual([
      'currency',
      'description',
      'durationLabel',
      'durationUnit',
      'durationValue',
      'id',
      'name',
      'price',
    ]);
  });

  it('cannot be used to read one plan by id', async () => {
    const plan = await createPlan({ name: '3 Months', price: '300.0000' });

    const response = await request(app).get(`/api/v1/public/plans/${plan.id}`);

    // There is no such route, deliberately - nothing here is enumerable.
    expect(response.status).toBe(404);
  });
});

describe('the authenticated plan routes are unchanged', () => {
  it('still refuses a shop admin', async () => {
    const { admin } = await createCompanyWithUsers('shopuser');
    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .get('/api/v1/plans')
      .set({ Authorization: `Bearer ${token}` });

    expect(response.status).toBe(403);
  });

  it('still refuses an anonymous caller', async () => {
    const response = await request(app).get('/api/v1/plans');
    expect(response.status).toBe(401);
  });

  // Creating and repricing stay behind auth. Only READING the catalogue is open.
  it('never lets the public route write anything', async () => {
    const before = await prisma.subscriptionPlan.count();

    const response = await request(app)
      .post('/api/v1/public/plans')
      .send({ name: 'Injected', price: '1', durationValue: 1, durationUnit: 'MONTH' });

    expect(response.status).toBe(404);
    expect(await prisma.subscriptionPlan.count()).toBe(before);
  });
});
