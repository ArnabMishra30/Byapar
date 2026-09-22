import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import {
  prisma,
  resetDatabase,
  createCompanyWithUsers,
  createPlatformUser,
  createPlan,
  createSubscription,
  login,
} from '../helpers/db.js';

// THE SaaS LAYER, end to end through HTTP.
//
// Three things are being proved here, and they are the three that would hurt if
// they were wrong:
//
//   1. A shop's people cannot reach the platform, and platform people cannot
//      reach a shop's books.
//   2. Pricing is data. Nothing in the system knows what 300 or 500 mean.
//   3. An expired shop cannot post - and a shop that never had a subscription
//      still can, because it was trading before any of this existed.

const PASSWORD = 'test-password-123';

async function platformToken(overrides = {}) {
  const { user } = await createPlatformUser(overrides);
  return { token: await login(app, user.email, PASSWORD), user };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('subscription plans', () => {
  it('lets a platform admin create a plan at any price the operator chooses', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '3 Months', price: '300', durationValue: 3, durationUnit: 'MONTH' });

    expect(response.status).toBe(201);
    expect(response.body.data.plan.name).toBe('3 Months');
    expect(response.body.data.plan.price).toBe('300.00');
    expect(response.body.data.plan.durationValue).toBe(3);
  });

  // PRICING IS DATA. The brief's 300 and 500 are examples, not constants: an
  // operator can charge 1234.56 for 45 days and nothing objects.
  it('accepts a price and duration the brief never mentioned', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Odd Plan', price: '1234.56', durationValue: 45, durationUnit: 'DAY' });

    expect(response.status).toBe(201);
    expect(response.body.data.plan.price).toBe('1234.56');
  });

  it('refuses a negative price', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', price: '-100', durationValue: 3, durationUnit: 'MONTH' });

    expect(response.status).toBe(400);
  });

  it('refuses a zero or negative duration', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', price: '100', durationValue: 0, durationUnit: 'MONTH' });

    expect(response.status).toBe(400);
  });

  // A sales rep may read the price list. They may not rewrite it.
  it('refuses to let a sales rep create a plan', async () => {
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cheap', price: '1', durationValue: 12, durationUnit: 'MONTH' });

    expect(response.status).toBe(403);
  });

  it('lets a sales rep read the plan list', async () => {
    await createPlan({ name: '3 Months', price: '300.0000' });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  // A plan in use is never deleted, because subscriptions point at it.
  it('deactivates a plan instead of deleting it', async () => {
    const plan = await createPlan();
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .patch(`/api/v1/plans/${plan.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.plan.isActive).toBe(false);
    expect(await prisma.subscriptionPlan.findUnique({ where: { id: plan.id } })).not.toBeNull();
  });

  it('shuts a shop out of the platform entirely', async () => {
    const { admin } = await createCompanyWithUsers('shop');
    const token = await login(app, admin.email, PASSWORD);

    for (const path of ['/api/v1/plans', '/api/v1/subscriptions', '/api/v1/businesses', '/api/v1/sales-team']) {
      const response = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(response.status, `${path} should be forbidden for a shop admin`).toBe(403);
    }
  });
});

describe('shop onboarding', () => {
  it('registers a shop, its owner and its subscription in one call', async () => {
    const plan = await createPlan({ name: '3 Months', price: '300.0000' });
    const { token, user: rep } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Ramesh Medical Store',
        phone: '9876543210',
        city: 'Pune',
        owner: { name: 'Ramesh', email: 'ramesh@shop.test', password: 'shop-password-1' },
        planId: plan.id,
        payment: { amount: '300', method: 'CASH' },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.business.name).toBe('Ramesh Medical Store');
    expect(response.body.data.subscription.plan).toBe('3 Months');
    expect(response.body.data.payment.amount).toBe('300.00');

    // The owner can actually sign in - the whole point of the exercise.
    const ownerToken = await login(app, 'ramesh@shop.test', 'shop-password-1');
    expect(ownerToken).toBeTruthy();

    // And the shop got its chart of accounts, so it can trade immediately.
    const company = await prisma.company.findFirst({ where: { name: 'Ramesh Medical Store' } });
    expect(await prisma.account.count({ where: { companyId: company.id } })).toBeGreaterThan(0);
    expect(company.onboardedById).toBe(rep.id);
  });

  // GST IS OPTIONAL and must stay optional.
  it('registers a shop with no GST registration at all', async () => {
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Corner Kirana',
        owner: { name: 'Owner', email: 'owner@kirana.test', password: 'shop-password-1' },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.business.gstEnabled).toBe(false);
    expect(response.body.data.business.gstin).toBeNull();
  });

  it('registers a shop without selling it a plan yet', async () => {
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Later Plan Shop',
        owner: { name: 'Owner', email: 'owner@later.test', password: 'shop-password-1' },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.subscription).toBeNull();
  });

  it('refuses a duplicate business name', async () => {
    const { token } = await platformToken({ email: 'rep@platform.test' });
    const body = {
      name: 'Duplicate Shop',
      owner: { name: 'Owner', email: 'first@dup.test', password: 'shop-password-1' },
    };

    await request(app).post('/api/v1/businesses/onboard').set('Authorization', `Bearer ${token}`).send(body);

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, owner: { ...body.owner, email: 'second@dup.test' } });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('BUSINESS_NAME_TAKEN');
  });

  it('refuses an email that already signs in somewhere', async () => {
    const { admin } = await createCompanyWithUsers('existing');
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Shop',
        owner: { name: 'Owner', email: admin.email, password: 'shop-password-1' },
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_TAKEN');
  });

  // NOTHING HALF-CREATED. If the plan is refused, no company is left behind.
  it('leaves no company behind when the plan is not sellable', async () => {
    const plan = await createPlan({ isActive: false });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rollback Shop',
        owner: { name: 'Owner', email: 'owner@rollback.test', password: 'shop-password-1' },
        planId: plan.id,
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PLAN_INACTIVE');
    expect(await prisma.company.findFirst({ where: { name: 'Rollback Shop' } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'owner@rollback.test' } })).toBeNull();
  });

  it('refuses a rep who does not hold BUSINESS_CREATE', async () => {
    const { token } = await platformToken({
      email: 'readonly@platform.test',
      permissions: ['BUSINESS_VIEW'],
    });

    const response = await request(app)
      .post('/api/v1/businesses/onboard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Nope Shop',
        owner: { name: 'Owner', email: 'owner@nope.test', password: 'shop-password-1' },
      });

    expect(response.status).toBe(403);
  });

  it('shows a rep only the shops they signed up when they ask for their own', async () => {
    const { token: repToken } = await platformToken({ email: 'rep1@platform.test' });
    const { token: otherToken } = await platformToken({ email: 'rep2@platform.test' });

    await request(app).post('/api/v1/businesses/onboard').set('Authorization', `Bearer ${repToken}`).send({
      name: 'Rep One Shop',
      owner: { name: 'Rep One Owner', email: 'a@shops.test', password: 'shop-password-1' },
    });
    await request(app).post('/api/v1/businesses/onboard').set('Authorization', `Bearer ${otherToken}`).send({
      name: 'Rep Two Shop',
      owner: { name: 'Rep Two Owner', email: 'b@shops.test', password: 'shop-password-1' },
    });

    const response = await request(app)
      .get('/api/v1/businesses?mine=true')
      .set('Authorization', `Bearer ${repToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Rep One Shop');
  });
});

describe('selling and renewing a subscription', () => {
  it('sells a subscription and records the money', async () => {
    const { company } = await createCompanyWithUsers('buyer');
    const plan = await createPlan({ name: '6 Months', price: '500.0000', durationValue: 6 });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId: company.id,
        planId: plan.id,
        payment: { amount: '500', method: 'UPI', reference: 'UPI-1234' },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.subscription.status).toBe('ACTIVE');
    expect(response.body.data.subscription.price).toBe('500.00');
  });

  // SUBSCRIPTION MONEY IS THE PLATFORM'S REVENUE, NOT THE SHOP'S EXPENSE. It
  // must never appear in the shop's own books - that would be inventing a
  // transaction the shop never recorded.
  it('writes nothing into the shop journal', async () => {
    const { company } = await createCompanyWithUsers('nojournal');
    const plan = await createPlan();
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const before = await prisma.journalEntry.count({ where: { companyId: company.id } });

    await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId: company.id, planId: plan.id, payment: { amount: '300', method: 'CASH' } });

    expect(await prisma.journalEntry.count({ where: { companyId: company.id } })).toBe(before);
  });

  // Repricing must never rewrite what somebody already bought.
  it('keeps the price a shop paid even after the plan is repriced', async () => {
    const { company } = await createCompanyWithUsers('snapshot');
    const plan = await createPlan({ name: '3 Months', price: '300.0000' });
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId: company.id, planId: plan.id });

    await request(app)
      .patch(`/api/v1/plans/${plan.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: '999' });

    const subscription = await prisma.subscription.findFirst({ where: { companyId: company.id } });
    expect(subscription.priceSnapshot.toString()).toBe('300');
    expect(subscription.planNameSnapshot).toBe('3 Months');
  });

  // RENEWING EARLY MUST NOT DELETE THE DAYS ALREADY PAID FOR.
  it('stacks a renewal onto the end of a running subscription', async () => {
    const { company } = await createCompanyWithUsers('renewer');
    const existing = await createSubscription({
      companyId: company.id,
      startsInDays: -10,
      endsInDays: 20,
    });
    const plan = await createPlan({ name: 'Renewal', price: '300.0000', durationValue: 1 });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId: company.id, planId: plan.id });

    expect(response.status).toBe(201);

    // The new period begins the day AFTER the old one ends.
    const expectedStart = new Date(existing.endDate.getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    expect(response.body.data.subscription.startDate).toBe(expectedStart);
  });

  it('refuses to sell a deactivated plan', async () => {
    const { company } = await createCompanyWithUsers('inactive');
    const plan = await createPlan({ isActive: false });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId: company.id, planId: plan.id });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PLAN_INACTIVE');
  });

  // Selling and switching off are separate jobs and separate permissions.
  it('refuses a cancellation from a rep who may sell but not cancel', async () => {
    const { company } = await createCompanyWithUsers('cancel');
    const subscription = await createSubscription({ companyId: company.id });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post(`/api/v1/subscriptions/${subscription.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Shop closed' });

    expect(response.status).toBe(403);
  });

  it('lets a platform admin cancel', async () => {
    const { company } = await createCompanyWithUsers('cancel2');
    const subscription = await createSubscription({ companyId: company.id });
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post(`/api/v1/subscriptions/${subscription.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Shop closed' });

    expect(response.status).toBe(200);
    expect(response.body.data.subscription.status).toBe('CANCELLED');
  });

  it('records a payment against a subscription', async () => {
    const { company } = await createCompanyWithUsers('paying');
    const subscription = await createSubscription({ companyId: company.id });
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post(`/api/v1/subscriptions/${subscription.id}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '300', method: 'CASH' });

    expect(response.status).toBe(201);
    expect(response.body.data.payment.amount).toBe('300.00');
  });
});

describe('sales team', () => {
  it('creates a rep with no company of their own', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/sales-team')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Rep', email: 'newrep@platform.test', password: 'rep-password-1' });

    expect(response.status).toBe(201);
    expect(response.body.data.staff.role).toBe('SALES_STAFF');

    const created = await prisma.user.findUnique({ where: { email: 'newrep@platform.test' } });
    // The thing that keeps them out of every shop's books.
    expect(created.companyId).toBeNull();
  });

  it('gives a new rep the default permissions', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/sales-team')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rep', email: 'defaults@platform.test', password: 'rep-password-1' });

    expect(response.body.data.staff.permissions).toContain('BUSINESS_CREATE');
    // Not trusted with cancellation by default.
    expect(response.body.data.staff.permissions).not.toContain('SUBSCRIPTION_CANCEL');
  });

  it('refuses a permission it does not define', async () => {
    const { token } = await platformToken({ email: 'admin@platform.test', role: 'PLATFORM_ADMIN' });

    const response = await request(app)
      .post('/api/v1/sales-team')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rep',
        email: 'bad@platform.test',
        password: 'rep-password-1',
        permissions: ['DELETE_EVERYTHING'],
      });

    expect(response.status).toBe(400);
  });

  // A rep must never be able to widen their own permissions.
  it('refuses to let a rep manage the sales team', async () => {
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/sales-team')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Me Again', email: 'again@platform.test', password: 'rep-password-1' });

    expect(response.status).toBe(403);
  });

  it('reports what a rep has actually done', async () => {
    const { token: adminToken } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });
    const { token: repToken, user: rep } = await platformToken({ email: 'rep@platform.test' });

    await request(app).post('/api/v1/businesses/onboard').set('Authorization', `Bearer ${repToken}`).send({
      name: 'Counted Shop',
      owner: { name: 'Owner', email: 'owner@counted.test', password: 'shop-password-1' },
    });

    const response = await request(app)
      .get(`/api/v1/sales-team/${rep.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.staff.shopsOnboarded).toBe(1);
  });
});

describe('the subscription posting guard', () => {
  /** Posts an expense - the simplest posted document there is. */
  async function postAnExpense(token, companyId) {
    const account = await prisma.account.findFirst({
      // 5210 Rent. COGS and the inventory adjustment account are maintained by
      // other parts of the system and are refused as expense categories.
      where: { companyId, code: '5210' },
    });

    const created = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        expenseDate: new Date().toISOString().slice(0, 10),
        expenseAccountId: account.id,
        amount: '100',
        paymentMode: 'CASH',
      });

    if (created.status !== 201) return created;

    return request(app)
      .post(`/api/v1/expenses/${created.body.data.expense.id}/post`)
      .set('Authorization', `Bearer ${token}`);
  }

  // THE GRANDFATHER RULE. Every business that existed before this feature has no
  // subscription row. They must carry on exactly as before.
  it('lets a shop with no subscription at all carry on trading', async () => {
    const { company, admin } = await createCompanyWithUsers('nosub');
    const token = await login(app, admin.email, PASSWORD);

    const response = await postAnExpense(token, company.id);
    expect(response.status).toBe(200);
  });

  it('lets a shop with a current subscription post', async () => {
    const { company, admin } = await createCompanyWithUsers('current');
    await createSubscription({ companyId: company.id, startsInDays: -10, endsInDays: 10 });
    const token = await login(app, admin.email, PASSWORD);

    const response = await postAnExpense(token, company.id);
    expect(response.status).toBe(200);
  });

  it('refuses a posting from a shop whose subscription has lapsed', async () => {
    const { company, admin } = await createCompanyWithUsers('lapsed');
    await createSubscription({ companyId: company.id, startsInDays: -60, endsInDays: -1 });
    const token = await login(app, admin.email, PASSWORD);

    const response = await postAnExpense(token, company.id);
    expect(response.status).toBe(402);
    expect(response.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('refuses a posting from a shop whose subscription was cancelled', async () => {
    const { company, admin } = await createCompanyWithUsers('cancelled');
    await createSubscription({
      companyId: company.id,
      startsInDays: -10,
      endsInDays: 30,
      status: 'CANCELLED',
    });
    const token = await login(app, admin.email, PASSWORD);

    const response = await postAnExpense(token, company.id);
    expect(response.status).toBe(402);
    expect(response.body.code).toBe('SUBSCRIPTION_CANCELLED');
  });

  // NOTHING PARTIAL. A refused posting must leave the document a draft.
  it('leaves the document a draft and writes no journal entry when it refuses', async () => {
    const { company, admin } = await createCompanyWithUsers('partial');
    await createSubscription({ companyId: company.id, startsInDays: -60, endsInDays: -1 });
    const token = await login(app, admin.email, PASSWORD);

    await postAnExpense(token, company.id);

    const expense = await prisma.expense.findFirst({ where: { companyId: company.id } });
    expect(expense.status).toBe('DRAFT');
    expect(await prisma.journalEntry.count({ where: { companyId: company.id } })).toBe(0);
  });

  // AN EXPIRED SHOP KEEPS ITS OWN BOOKS. Locking a shop out of its history to
  // extract a renewal would be a hostage-taking, not a product.
  it('still lets an expired shop read its own data', async () => {
    const { company, admin } = await createCompanyWithUsers('readonly');
    await createSubscription({ companyId: company.id, startsInDays: -60, endsInDays: -1 });
    const token = await login(app, admin.email, PASSWORD);

    for (const path of ['/api/v1/expenses', '/api/v1/products', '/api/v1/reports/profit-and-loss']) {
      const response = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(response.status, `${path} should stay readable`).not.toBe(402);
    }
  });

  it('lets a shop post again the moment its subscription is renewed', async () => {
    const { company, admin } = await createCompanyWithUsers('renewed');
    await createSubscription({ companyId: company.id, startsInDays: -60, endsInDays: -1 });
    const token = await login(app, admin.email, PASSWORD);

    expect((await postAnExpense(token, company.id)).status).toBe(402);

    const plan = await createPlan({ name: 'Rescue', price: '300.0000' });
    const { token: repToken } = await platformToken({ email: 'rep@platform.test' });
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${repToken}`)
      .send({ companyId: company.id, planId: plan.id });

    expect((await postAnExpense(token, company.id)).status).toBe(200);
  });
});

describe('a shop asking about its own subscription', () => {
  it('reports days remaining', async () => {
    const { company, admin } = await createCompanyWithUsers('asking');
    await createSubscription({ companyId: company.id, startsInDays: -10, endsInDays: 12 });
    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .get('/api/v1/my-subscription')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.subscription.isEntitled).toBe(true);
    expect(response.body.data.subscription.daysRemaining).toBe(12);
  });

  it('explains why a lapsed shop cannot post', async () => {
    const { company, admin } = await createCompanyWithUsers('lapsedask');
    await createSubscription({ companyId: company.id, startsInDays: -60, endsInDays: -5 });
    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .get('/api/v1/my-subscription')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.subscription.isEntitled).toBe(false);
    expect(response.body.data.subscription.status).toBe('EXPIRED');
  });

  // THE TENANT RULE. There is no parameter with which to ask about anyone else.
  it('never reports another shop, whatever the query string says', async () => {
    const { company: mine, admin } = await createCompanyWithUsers('mine');
    const { company: theirs } = await createCompanyWithUsers('theirs');
    await createSubscription({ companyId: mine.id, endsInDays: 5, planName: 'Mine' });
    await createSubscription({ companyId: theirs.id, endsInDays: 500, planName: 'Theirs' });

    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .get(`/api/v1/my-subscription?companyId=${theirs.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.subscription.plan).toBe('Mine');
  });
});
