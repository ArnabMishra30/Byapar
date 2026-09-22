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

// MANUAL RECHARGE AND ADMIN GRANT.
//
// An admin gives a shop a subscription by hand - cash taken at the counter, or a
// free month for a struggling customer. No payment gateway is involved anywhere
// in this file, because the product has none.
//
// The two things being proved:
//
//   1. A grant is a REAL subscription with a full audit trail, not an UPDATE of
//      an expiry date. "Who gave this shop four free months, and why?" must be
//      answerable months later.
//   2. Only someone actually authorised can do it, enforced on the SERVER.

const PASSWORD = 'test-password-123';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** A business date offset from today, as "YYYY-MM-DD". */
function dayOffset(days) {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
}

async function platformToken(overrides = {}) {
  const { user } = await createPlatformUser(overrides);
  return { token: await login(app, user.email, PASSWORD), user };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('CASE A - recharging a shop whose subscription has expired', () => {
  it('starts the new period today, not backdated into the gap', async () => {
    const { company } = await createCompanyWithUsers('expired');
    await createSubscription({ companyId: company.id, startsInDays: -90, endsInDays: -10 });
    const plan = await createPlan({ name: '3 Months', price: '300.0000', durationValue: 3 });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({
        companyId: company.id,
        planId: plan.id,
        amount: '300',
        method: 'MANUAL',
        reference: 'OFFLINE-001',
        reason: 'Cash collected by sales staff',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.subscription.status).toBe('ACTIVE');
    // Today, because backdating would sell days that have already gone by.
    expect(response.body.data.subscription.startDate).toBe(dayOffset(0));
    expect(response.body.data.subscription.origin).toBe('ADMIN_GRANT');
  });

  it('lets the shop post again immediately', async () => {
    const { company, admin } = await createCompanyWithUsers('blocked');
    await createSubscription({ companyId: company.id, startsInDays: -90, endsInDays: -10 });
    const plan = await createPlan();
    const shopToken = await login(app, admin.email, PASSWORD);

    const account = await prisma.account.findFirst({
      where: { companyId: company.id, code: '5210' },
    });

    const postExpense = async () => {
      const created = await request(app).post('/api/v1/expenses').set(auth(shopToken)).send({
        expenseDate: dayOffset(0),
        expenseAccountId: account.id,
        amount: '100',
        paymentMode: 'CASH',
      });
      return request(app)
        .post(`/api/v1/expenses/${created.body.data.expense.id}/post`)
        .set(auth(shopToken));
    };

    // Blocked before the recharge.
    expect((await postExpense()).status).toBe(402);

    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });
    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Offline payment received' });

    // Trading again the moment it is recharged.
    expect((await postExpense()).status).toBe(200);
  });

  it('switches a deactivated shop back on', async () => {
    const { company } = await createCompanyWithUsers('switchedoff');
    await prisma.company.update({ where: { id: company.id }, data: { isActive: false } });
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Reinstated after payment' });

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after.isActive).toBe(true);
  });
});

describe('CASE B - recharging a shop whose subscription is still running', () => {
  // THE RULE THAT PROTECTS THE SHOP. Recharging early must ADD time, never
  // replace what has already been paid for.
  it('extends from the existing expiry rather than shortening it', async () => {
    const { company } = await createCompanyWithUsers('running');
    const existing = await createSubscription({
      companyId: company.id,
      startsInDays: -10,
      endsInDays: 20,
    });
    const plan = await createPlan({ name: '3 Months', durationValue: 3 });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Renewed in advance' });

    expect(response.status).toBe(201);

    // The day AFTER the current subscription ends - not today.
    const expectedStart = new Date(existing.endDate.getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    expect(response.body.data.subscription.startDate).toBe(expectedStart);

    // And the new end date is genuinely later than the old one.
    expect(new Date(response.body.data.subscription.endDate).getTime()).toBeGreaterThan(
      existing.endDate.getTime(),
    );
  });

  it('never shortens or rewrites the subscription it extends', async () => {
    const { company } = await createCompanyWithUsers('untouched');
    const existing = await createSubscription({
      companyId: company.id,
      startsInDays: -10,
      endsInDays: 20,
    });
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Extension' });

    // The original row is byte-for-byte what it was.
    const unchanged = await prisma.subscription.findUnique({ where: { id: existing.id } });
    expect(unchanged.endDate.toISOString()).toBe(existing.endDate.toISOString());
    expect(unchanged.status).toBe(existing.status);
  });

  it('chains the new subscription to the one it extends', async () => {
    const { company } = await createCompanyWithUsers('chained');
    const existing = await createSubscription({ companyId: company.id, endsInDays: 20 });
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Extension' });

    expect(response.body.data.subscription.previousSubscriptionId).toBe(existing.id);
    expect(response.body.data.subscription.isRenewal).toBe(true);
    // And the response tells the caller what it extended, for the UI preview.
    expect(response.body.data.previous.id).toBe(existing.id);
  });
});

describe('CASE C - a free promotional grant', () => {
  it('activates the shop with no money recorded at all', async () => {
    const { company } = await createCompanyWithUsers('promo');
    const plan = await createPlan({ name: '3 Months', price: '300.0000' });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Promotional access' });

    expect(response.status).toBe(201);
    expect(response.body.data.subscription.status).toBe('ACTIVE');
    expect(response.body.data.subscription.price).toBe('0.00');

    // NO payment row. A zero-rupee payment would dress a gift up as a
    // transaction and inflate every collections report.
    expect(response.body.data.payment).toBeNull();
    const payments = await prisma.subscriptionPayment.count({
      where: { subscription: { companyId: company.id } },
    });
    expect(payments).toBe(0);
  });

  it('records zero rather than the plan list price', async () => {
    const { company } = await createCompanyWithUsers('freeprice');
    const plan = await createPlan({ price: '500.0000' });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Goodwill' });

    const subscription = await prisma.subscription.findFirst({ where: { companyId: company.id } });
    // Never claim the shop was charged 500 when it was charged nothing.
    expect(subscription.priceSnapshot.toString()).toBe('0');
  });

  it('explicitly recorded as zero behaves the same as omitting the amount', async () => {
    const { company } = await createCompanyWithUsers('explicitzero');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, amount: '0', reason: 'Free trial' });

    expect(response.status).toBe(201);
    expect(response.body.data.payment).toBeNull();
  });
});

describe('CASE D - a custom duration', () => {
  it('honours an override instead of the plan duration', async () => {
    const { company } = await createCompanyWithUsers('custom');
    const plan = await createPlan({ durationValue: 3, durationUnit: 'MONTH' });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({
        companyId: company.id,
        planId: plan.id,
        durationValue: 14,
        durationUnit: 'DAY',
        reason: 'Two week extension while they decide',
      });

    expect(response.status).toBe(201);
    // 14 days starting today, inclusive: today + 13.
    expect(response.body.data.subscription.endDate).toBe(dayOffset(13));
    expect(response.body.data.subscription.duration).toBe('14 days');
  });
});

describe('the audit trail', () => {
  // A grant must answer "who, when, why" months later. This is the whole reason
  // it is a real subscription row rather than a moved date.
  it('records who granted it, why, and against which plan', async () => {
    const { company } = await createCompanyWithUsers('audited');
    const plan = await createPlan({ name: '6 Months', price: '500.0000' });
    const { token, user: adminUser } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({
        companyId: company.id,
        planId: plan.id,
        amount: '500',
        method: 'MANUAL',
        reference: 'OFFLINE-ABC-001',
        reason: 'Cash collected by sales staff',
      });

    const subscription = await prisma.subscription.findFirst({
      where: { companyId: company.id },
    });

    expect(subscription.origin).toBe('ADMIN_GRANT');
    expect(subscription.grantReason).toBe('Cash collected by sales staff');
    expect(subscription.createdById).toBe(adminUser.id);
    expect(subscription.planNameSnapshot).toBe('6 Months');
    expect(subscription.createdAt).toBeInstanceOf(Date);

    const payment = await prisma.subscriptionPayment.findFirst({
      where: { subscriptionId: subscription.id },
    });
    expect(payment.method).toBe('MANUAL');
    expect(payment.reference).toBe('OFFLINE-ABC-001');
    expect(payment.collectedById).toBe(adminUser.id);
  });

  it('refuses a grant with no reason', async () => {
    const { company } = await createCompanyWithUsers('noreason');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id });

    expect(response.status).toBe(400);
    expect(await prisma.subscription.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('serves the full history of subscriptions and payments', async () => {
    const { company } = await createCompanyWithUsers('history');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, amount: '300', reason: 'First recharge' });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Free extension' });

    const response = await request(app)
      .get(`/api/v1/businesses/${company.id}/history`)
      .set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data.subscriptions).toHaveLength(2);
    // One paid, one free - so exactly one payment.
    expect(response.body.data.payments).toHaveLength(1);
    expect(response.body.data.subscriptions[0].grantReason).toBeTruthy();
  });

  // Subscription money is the PLATFORM's revenue. A grant must not touch the
  // shop's own books, exactly as an ordinary sale does not.
  it('writes nothing into the shop journal', async () => {
    const { company } = await createCompanyWithUsers('nojournal');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, amount: '500', reason: 'Offline payment' });

    expect(await prisma.journalEntry.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prisma.expense.count({ where: { companyId: company.id } })).toBe(0);
  });
});

describe('the recharge preview', () => {
  it('shows the new expiry before anything is committed', async () => {
    const { company } = await createCompanyWithUsers('preview');
    const existing = await createSubscription({ companyId: company.id, endsInDays: 20 });
    const plan = await createPlan({ durationValue: 3, durationUnit: 'MONTH' });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .get(`/api/v1/businesses/${company.id}/recharge-preview?planId=${plan.id}`)
      .set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data.preview.extending).toBe(true);
    expect(response.body.data.preview.current.endDate).toBe(
      existing.endDate.toISOString().slice(0, 10),
    );
    expect(response.body.data.preview.explanation).toMatch(/no paid days are lost/i);

    // AND IT CHANGED NOTHING.
    expect(await prisma.subscription.count({ where: { companyId: company.id } })).toBe(1);
  });

  it('says the period starts today when nothing is running', async () => {
    const { company } = await createCompanyWithUsers('previewfresh');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .get(`/api/v1/businesses/${company.id}/recharge-preview?planId=${plan.id}`)
      .set(auth(token));

    expect(response.body.data.preview.extending).toBe(false);
    expect(response.body.data.preview.startDate).toBe(dayOffset(0));
    expect(response.body.data.preview.current).toBeNull();
  });

  // The preview must agree with what actually happens, or it is worse than none.
  it('matches the dates the real grant produces', async () => {
    const { company } = await createCompanyWithUsers('agree');
    await createSubscription({ companyId: company.id, endsInDays: 12 });
    const plan = await createPlan({ durationValue: 6, durationUnit: 'MONTH' });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const preview = await request(app)
      .get(`/api/v1/businesses/${company.id}/recharge-preview?planId=${plan.id}`)
      .set(auth(token));

    const granted = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Matching test' });

    expect(granted.body.data.subscription.startDate).toBe(preview.body.data.preview.startDate);
    expect(granted.body.data.subscription.endDate).toBe(preview.body.data.preview.endDate);
  });
});

describe('who may recharge - enforced on the server', () => {
  it('lets a platform admin recharge', async () => {
    const { company } = await createCompanyWithUsers('adminok');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Admin recharge' });

    expect(response.status).toBe(201);
  });

  // THE IMPORTANT ONE. A rep with the ordinary permissions could otherwise hand
  // out free access to anybody, indefinitely.
  it('refuses an ordinary sales rep', async () => {
    const { company } = await createCompanyWithUsers('repdenied');
    const plan = await createPlan();
    const { token } = await platformToken({ email: 'rep@platform.test' });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Trying it on' });

    expect(response.status).toBe(403);
    expect(await prisma.subscription.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('allows a rep who has been given the permission explicitly', async () => {
    const { company } = await createCompanyWithUsers('reptrusted');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'trusted@platform.test',
      permissions: ['BUSINESS_VIEW', 'SUBSCRIPTION_VIEW', 'SUBSCRIPTION_GRANT'],
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Trusted rep recharge' });

    expect(response.status).toBe(201);
  });

  it('keeps grant out of the default sales-staff permissions', async () => {
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app).get('/api/v1/sales-team/permissions').set(auth(token));

    expect(response.body.data.permissions).toContain('SUBSCRIPTION_GRANT');
    // Offered, but never handed out automatically.
    expect(response.body.data.defaults).not.toContain('SUBSCRIPTION_GRANT');
  });

  // A SHOP must not be able to recharge itself, which would make the whole
  // subscription model decorative.
  it('refuses a shop admin trying to recharge their own shop', async () => {
    const { company, admin } = await createCompanyWithUsers('selfserve');
    const plan = await createPlan();
    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Giving myself access' });

    expect(response.status).toBe(403);
    expect(await prisma.subscription.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('refuses one shop trying to recharge another', async () => {
    const { admin } = await createCompanyWithUsers('attacker');
    const { company: victim } = await createCompanyWithUsers('victim');
    const plan = await createPlan();
    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: victim.id, planId: plan.id, reason: 'Not mine to give' });

    expect(response.status).toBe(403);
    expect(await prisma.subscription.count({ where: { companyId: victim.id } })).toBe(0);
  });

  it('refuses an unauthenticated request', async () => {
    const { company } = await createCompanyWithUsers('anon');
    const plan = await createPlan();

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .send({ companyId: company.id, planId: plan.id, reason: 'No token' });

    expect(response.status).toBe(401);
  });

  it('refuses a shop admin reading another shop history', async () => {
    const { admin } = await createCompanyWithUsers('nosy');
    const { company: other } = await createCompanyWithUsers('private');
    const token = await login(app, admin.email, PASSWORD);

    const response = await request(app)
      .get(`/api/v1/businesses/${other.id}/history`)
      .set(auth(token));

    expect(response.status).toBe(403);
  });
});

describe('platform administration is never blocked by a shop subscription', () => {
  // An admin opening a lapsed shop must still be able to do everything, or the
  // only person who can fix the problem is locked out by it.
  it('lets an admin view and recharge a shop whose subscription has expired', async () => {
    const { company } = await createCompanyWithUsers('lapsedadmin');
    await createSubscription({ companyId: company.id, startsInDays: -90, endsInDays: -30 });
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    for (const path of [
      `/api/v1/businesses/${company.id}`,
      `/api/v1/businesses/${company.id}/history`,
      `/api/v1/subscriptions?companyId=${company.id}`,
    ]) {
      const response = await request(app).get(path).set(auth(token));
      expect(response.status, `${path} must stay reachable`).toBe(200);
    }

    const recharge = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Fixing a lapsed shop' });

    expect(recharge.status).toBe(201);
  });

  it('lets an admin recharge a shop that was switched off entirely', async () => {
    const { company } = await createCompanyWithUsers('deactivated');
    await prisma.company.update({ where: { id: company.id }, data: { isActive: false } });
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Bringing them back' });

    expect(response.status).toBe(201);
    expect(response.body.data.reactivated).toBe(true);
  });
});

describe('grant edge cases', () => {
  it('allows granting a plan that is no longer on sale', async () => {
    // An operator honouring an old promise must not be blocked because the plan
    // was withdrawn last month.
    const { company } = await createCompanyWithUsers('oldplan');
    const plan = await createPlan({ isActive: false, name: 'Retired Plan' });
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Honouring an old quote' });

    expect(response.status).toBe(201);
    expect(response.body.data.subscription.plan.name).toBe('Retired Plan');
  });

  it('404s on a business that does not exist', async () => {
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({
        companyId: '00000000-0000-0000-0000-000000000000',
        planId: plan.id,
        reason: 'Nobody home',
      });

    expect(response.status).toBe(404);
  });

  it('404s on a plan that does not exist', async () => {
    const { company } = await createCompanyWithUsers('noplan');
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({
        companyId: company.id,
        planId: '00000000-0000-0000-0000-000000000000',
        reason: 'No such plan',
      });

    expect(response.status).toBe(404);
  });

  it('starts a cancelled shop fresh rather than extending a cancellation', async () => {
    const { company } = await createCompanyWithUsers('cancelled');
    await createSubscription({
      companyId: company.id,
      endsInDays: 60,
      status: 'CANCELLED',
    });
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({ companyId: company.id, planId: plan.id, reason: 'Customer returned' });

    // Today - a cancelled subscription grants nothing, however far off its end.
    expect(response.body.data.subscription.startDate).toBe(dayOffset(0));
    expect(response.body.data.subscription.previousSubscriptionId).toBeNull();
  });

  it('rejects a gateway-shaped payload rather than silently ignoring it', async () => {
    // There is no gateway. A payload that assumes one is a bug worth surfacing.
    const { company } = await createCompanyWithUsers('gateway');
    const plan = await createPlan();
    const { token } = await platformToken({
      email: 'admin@platform.test',
      role: 'PLATFORM_ADMIN',
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/grant')
      .set(auth(token))
      .send({
        companyId: company.id,
        planId: plan.id,
        reason: 'Gateway attempt',
        method: 'RAZORPAY',
      });

    expect(response.status).toBe(400);
  });
});
