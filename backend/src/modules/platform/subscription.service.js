import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, round, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as platformRepository from './platform.repository.js';
import {
  resolvePeriod,
  deriveStatus,
  daysRemaining,
  assertPlanSellable,
  toBusinessDate,
  toDateString,
} from './subscription.rules.js';

// SUBSCRIPTIONS: what a shop has bought, and the money the platform took for it.
//
// THIS IS NOT ACCOUNTING. A subscription payment is the PLATFORM's revenue, and
// it never appears in the shop's journal, profit and loss, or cash book. Putting
// it there would charge a shop's own books for software it bought from us -
// a cost it never agreed to record - and would make the shop's profit wrong.
//
// So there is no GL posting anywhere in this file, and that is deliberate.

const MONEY_DP = 4;

// --- serialization ---------------------------------------------------------

function toPublicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    durationValue: plan.durationValue,
    durationUnit: plan.durationUnit,
    /** e.g. "3 months" - so a screen never has to assemble it. */
    durationLabel: `${plan.durationValue} ${plan.durationUnit.toLowerCase()}${plan.durationValue === 1 ? '' : 's'}`,
    price: toMoneyString(plan.price, 2),
    currency: plan.currency,
    isActive: plan.isActive,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function toPublicSubscription(subscription, asOf = new Date()) {
  // The stored status is what the database last recorded; the derived one is
  // what is true today. Both are published, because a stale ACTIVE row that has
  // actually lapsed would otherwise let a shop in.
  const derived = deriveStatus(subscription, asOf);

  return {
    id: subscription.id,
    company: subscription.company
      ? { id: subscription.company.id, name: subscription.company.name }
      : null,
    plan: {
      id: subscription.planId,
      // The name AS SOLD. Renaming a plan does not rewrite what a shop bought.
      name: subscription.planNameSnapshot,
      currentName: subscription.plan?.name ?? null,
    },
    price: toMoneyString(subscription.priceSnapshot, 2),
    currency: subscription.currencySnapshot,
    duration: `${subscription.durationValueSnapshot} ${subscription.durationUnitSnapshot.toLowerCase()}${subscription.durationValueSnapshot === 1 ? '' : 's'}`,
    startDate: toDateString(subscription.startDate),
    endDate: toDateString(subscription.endDate),
    status: derived,
    storedStatus: subscription.status,
    daysRemaining: daysRemaining(subscription, asOf),
    isRenewal: Boolean(subscription.previousSubscriptionId),
    /** SALE, or ADMIN_GRANT for a manual recharge or free grant. */
    origin: subscription.origin ?? "SALE",
    grantReason: subscription.grantReason ?? null,
    previousSubscriptionId: subscription.previousSubscriptionId,
    cancelledAt: subscription.cancelledAt,
    cancelReason: subscription.cancelReason,
    soldBy: subscription.createdBy
      ? { id: subscription.createdBy.id, name: subscription.createdBy.name }
      : null,
    createdAt: subscription.createdAt,
  };
}

function toPublicPayment(payment) {
  return {
    id: payment.id,
    amount: toMoneyString(payment.amount, 2),
    method: payment.method,
    reference: payment.reference,
    paidAt: toDateString(payment.paidAt),
    notes: payment.notes,
    collectedBy: payment.collectedBy
      ? { id: payment.collectedBy.id, name: payment.collectedBy.name }
      : null,
    subscription: payment.subscription
      ? {
          id: payment.subscription.id,
          plan: payment.subscription.planNameSnapshot,
          company: payment.subscription.company,
        }
      : undefined,
    createdAt: payment.createdAt,
  };
}

// --- plans -----------------------------------------------------------------

export async function listPlans(query = {}) {
  const { page, limit, isActive, search } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await platformRepository.findPlans({ skip, take, isActive, search });

  return { plans: items.map(toPublicPlan), pagination: buildPagination({ page, limit, total }) };
}

export async function getPlan(id) {
  const plan = await platformRepository.findPlanById(id);
  if (!plan) throw ApiError.business(404, 'PLAN_NOT_FOUND', 'Plan not found');

  return {
    ...toPublicPlan(plan),
    subscriptionCount: await platformRepository.countSubscriptionsForPlan(id),
  };
}

export async function createPlan(input) {
  const existing = await platformRepository.findPlanByName(input.name);
  if (existing) {
    throw ApiError.business(409, 'PLAN_NAME_TAKEN', `A plan named "${input.name}" already exists`);
  }

  const plan = await platformRepository.createPlan({
    name: input.name,
    description: input.description ?? null,
    durationValue: input.durationValue,
    durationUnit: input.durationUnit,
    price: round(input.price, MONEY_DP),
    currency: input.currency ?? 'INR',
    isActive: input.isActive ?? true,
  });

  return toPublicPlan(plan);
}

/**
 * Edits a plan.
 *
 * Changing the price does NOT change what anybody already bought: every
 * subscription froze its own price at the moment of sale. This edit governs
 * future sales only.
 */
export async function updatePlan(id, input) {
  const plan = await platformRepository.findPlanById(id);
  if (!plan) throw ApiError.business(404, 'PLAN_NOT_FOUND', 'Plan not found');

  if (input.name && input.name.toLowerCase() !== plan.name.toLowerCase()) {
    const clash = await platformRepository.findPlanByName(input.name);
    if (clash) {
      throw ApiError.business(409, 'PLAN_NAME_TAKEN', `A plan named "${input.name}" already exists`);
    }
  }

  const data = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.durationValue !== undefined) data.durationValue = input.durationValue;
  if (input.durationUnit !== undefined) data.durationUnit = input.durationUnit;
  if (input.price !== undefined) data.price = round(input.price, MONEY_DP);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return toPublicPlan(await platformRepository.updatePlan(id, data));
}

/**
 * Turns a plan off.
 *
 * There is deliberately NO delete. A plan that has been sold is part of the
 * record of what a shop bought, and removing it would leave subscriptions
 * pointing at nothing. Deactivation takes it out of the catalogue and leaves
 * history intact.
 */
export async function setPlanActive(id, isActive) {
  const plan = await platformRepository.findPlanById(id);
  if (!plan) throw ApiError.business(404, 'PLAN_NOT_FOUND', 'Plan not found');

  return toPublicPlan(await platformRepository.updatePlan(id, { isActive }));
}

// --- subscriptions ---------------------------------------------------------

/**
 * Sells a shop a subscription, and records the money if any was taken.
 *
 * ONE TRANSACTION covers the subscription, the payment and the shop's activation,
 * so a rep cannot end up having taken cash for a subscription that was not
 * created.
 *
 * The company row is LOCKED first. Two reps selling the same shop a renewal at
 * the same moment would otherwise both read the same end date and both extend
 * from it - the shop would pay twice and get one period.
 */
export async function createSubscription(currentUser, input) {
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));

  const result = await withRetryableTransaction(async (tx) => {
    const company = await platformRepository.lockCompanyForSubscription(tx, input.companyId);
    if (!company) throw ApiError.business(404, 'BUSINESS_NOT_FOUND', 'Business not found');

    const plan = assertPlanSellable(await platformRepository.findPlanById(input.planId, tx));

    // What the shop already has decides when the new period starts.
    const current = await platformRepository.findLatestSubscription(input.companyId, tx);
    const { startDate, endDate } = resolvePeriod(today, current, plan);

    const subscription = await platformRepository.createSubscription(tx, {
      companyId: input.companyId,
      planId: plan.id,
      // Frozen at the moment of sale. The plan may be repriced tomorrow.
      planNameSnapshot: plan.name,
      priceSnapshot: round(plan.price, MONEY_DP),
      currencySnapshot: plan.currency,
      durationValueSnapshot: plan.durationValue,
      durationUnitSnapshot: plan.durationUnit,
      startDate,
      endDate,
      // ACTIVE the moment it is sold: the rep is standing in the shop and the
      // owner expects to log in. A subscription with no payment recorded is
      // still a subscription - the platform simply has a debt to chase.
      status: 'ACTIVE',
      previousSubscriptionId: current && current.status !== 'CANCELLED' ? current.id : null,
      createdById: currentUser.id,
    });

    let payment = null;
    if (input.payment) {
      payment = await platformRepository.createPayment(tx, {
        subscriptionId: subscription.id,
        amount: round(input.payment.amount, MONEY_DP),
        method: input.payment.method ?? 'CASH',
        reference: input.payment.reference ?? null,
        paidAt: input.payment.paidAt ?? today,
        notes: input.payment.notes ?? null,
        collectedById: currentUser.id,
      });
    }

    // A shop that has just bought a subscription can use the application.
    if (!company.isActive) {
      await tx.company.update({ where: { id: company.id }, data: { isActive: true } });
    }

    return { subscription, payment };
  });

  return {
    subscription: toPublicSubscription(result.subscription, today),
    payment: result.payment ? toPublicPayment(result.payment) : null,
  };
}

export async function listSubscriptions(query = {}) {
  const { page, limit, companyId, status, expiringWithinDays } = query;
  const { skip, take } = toSkipTake({ page, limit });

  let expiringBefore;
  if (expiringWithinDays !== undefined) {
    expiringBefore = new Date();
    expiringBefore.setUTCDate(expiringBefore.getUTCDate() + expiringWithinDays);
  }

  const { items, total } = await platformRepository.findSubscriptions({
    skip,
    take,
    companyId,
    status,
    expiringBefore,
  });

  const asOf = new Date();
  return {
    subscriptions: items.map((row) => toPublicSubscription(row, asOf)),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getSubscription(id) {
  const subscription = await platformRepository.findSubscriptionById(id);
  if (!subscription) {
    throw ApiError.business(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
  }

  const payments = await platformRepository.findPaymentsForSubscription(id);
  const paid = payments.reduce((total, row) => add(total, row.amount), toDecimal(0));

  return {
    ...toPublicSubscription(subscription),
    payments: payments.map(toPublicPayment),
    amountPaid: toMoneyString(paid, 2),
    balanceDue: toMoneyString(
      isGreaterThan(subscription.priceSnapshot, paid)
        ? toDecimal(subscription.priceSnapshot).minus(paid)
        : 0,
      2,
    ),
  };
}

/**
 * Cancels a subscription.
 *
 * The row is kept, with who cancelled it and why. Deleting it would erase the
 * fact that the shop paid, which is exactly the record a dispute needs.
 */
export async function cancelSubscription(currentUser, id, input = {}) {
  const existing = await platformRepository.findSubscriptionById(id);
  if (!existing) {
    throw ApiError.business(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
  }
  if (existing.status === 'CANCELLED') {
    throw ApiError.business(
      409,
      'SUBSCRIPTION_ALREADY_CANCELLED',
      'This subscription is already cancelled',
    );
  }

  const updated = await withRetryableTransaction(async (tx) =>
    platformRepository.updateSubscription(tx, id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelReason: input.reason ?? null,
    }),
  );

  return toPublicSubscription(updated);
}

// --- payments --------------------------------------------------------------

export async function recordPayment(currentUser, subscriptionId, input) {
  const subscription = await platformRepository.findSubscriptionById(subscriptionId);
  if (!subscription) {
    throw ApiError.business(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
  }
  if (subscription.status === 'CANCELLED') {
    throw ApiError.business(
      422,
      'SUBSCRIPTION_CANCELLED',
      'This subscription was cancelled. Money cannot be recorded against it.',
    );
  }

  const payment = await withRetryableTransaction(async (tx) =>
    platformRepository.createPayment(tx, {
      subscriptionId,
      amount: round(input.amount, MONEY_DP),
      method: input.method ?? 'CASH',
      reference: input.reference ?? null,
      paidAt: input.paidAt ?? toBusinessDate(new Date().toISOString().slice(0, 10)),
      notes: input.notes ?? null,
      collectedById: currentUser.id,
    }),
  );

  return toPublicPayment(payment);
}

export async function listPaymentsForSubscription(subscriptionId) {
  const subscription = await platformRepository.findSubscriptionById(subscriptionId);
  if (!subscription) {
    throw ApiError.business(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
  }

  const payments = await platformRepository.findPaymentsForSubscription(subscriptionId);
  return { payments: payments.map(toPublicPayment) };
}

export async function listPayments(query = {}) {
  const { page, limit, collectedById, fromDate, toDate } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await platformRepository.findPayments({
    skip,
    take,
    collectedById,
    fromDate,
    toDate,
  });

  return {
    payments: items.map(toPublicPayment),
    pagination: buildPagination({ page, limit, total }),
  };
}

// --- entitlement -----------------------------------------------------------

/**
 * What a shop is entitled to today.
 *
 * Read by the shop application on every load and by the posting guard, so it is
 * one indexed lookup.
 */
export async function getEntitlement(companyId) {
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));
  const subscription = await platformRepository.findEntitlingSubscription(companyId, today);

  if (!subscription) {
    const latest = await platformRepository.findLatestSubscription(companyId);
    return {
      isEntitled: false,
      status: latest ? deriveStatus(latest, today) : 'NONE',
      reason: latest
        ? 'Your subscription has ended. Renew it to carry on recording business.'
        : 'This business does not have a subscription yet.',
      plan: latest?.planNameSnapshot ?? null,
      endDate: latest ? toDateString(latest.endDate) : null,
      daysRemaining: latest ? daysRemaining(latest, today) : null,
    };
  }

  return {
    isEntitled: true,
    status: 'ACTIVE',
    reason: null,
    plan: subscription.planNameSnapshot,
    startDate: toDateString(subscription.startDate),
    endDate: toDateString(subscription.endDate),
    daysRemaining: daysRemaining(subscription, today),
  };
}

// --- manual grants and recharges -------------------------------------------

/**
 * A platform admin gives a shop a subscription by hand.
 *
 * WHY THIS EXISTS. A shop pays a rep in cash at the counter, or the operator
 * decides to give a struggling customer a free month. Neither involves a payment
 * gateway, and this system has none. Somebody with authority records what
 * happened, and the shop can trade again.
 *
 * WHAT IT IS NOT. It is emphatically NOT `UPDATE subscriptions SET endDate = ...`.
 * Moving a date would leave no answer to "who gave this shop four free months,
 * and why?" - which is exactly the question an operator will eventually ask
 * about a subscription nobody paid for.
 *
 * So a grant creates a REAL subscription row, in the same shape and through the
 * same rules as a sale: the plan's terms are snapshotted, the period is resolved
 * by `resolvePeriod`, and the row is chained to the one before it via
 * `previousSubscriptionId`. The only differences are `origin = ADMIN_GRANT`, a
 * mandatory `grantReason`, and who is recorded as having done it.
 *
 * THE DATES. `resolvePeriod` already encodes the rule that protects the shop:
 *
 *   expired or nothing  -> the new period starts TODAY          (Case A)
 *   still running       -> it starts the day AFTER the current  (Case B)
 *                          end date, so an early recharge adds
 *                          time rather than replacing it
 *
 * A free grant (Case C) is identical except that no money is recorded.
 *
 * @param {{ id: string }} currentUser the admin doing it
 * @param {{ companyId: string, planId: string, reason: string,
 *           amount?: string, method?: string, reference?: string,
 *           durationValue?: number, durationUnit?: string }} input
 */
export async function grantSubscription(currentUser, input) {
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));

  const reason = (input.reason ?? '').trim();
  if (reason.length < 3) {
    throw ApiError.business(
      422,
      'GRANT_REASON_REQUIRED',
      'Say why this subscription is being granted. It is the only record of why a shop has access nobody paid for.',
    );
  }

  const result = await withRetryableTransaction(async (tx) => {
    // The same lock a sale takes. Two admins recharging the same shop at once
    // would otherwise both read the same end date and both extend from it,
    // giving the shop one period instead of two.
    const company = await platformRepository.lockCompanyForSubscription(tx, input.companyId);
    if (!company) throw ApiError.business(404, 'BUSINESS_NOT_FOUND', 'Business not found');

    // A grant may use a plan that is no longer on sale: an operator honouring an
    // old promise should not be blocked because the plan was withdrawn last
    // month. So the plan must EXIST, but need not be sellable.
    const plan = await platformRepository.findPlanById(input.planId, tx);
    if (!plan) throw ApiError.business(404, 'PLAN_NOT_FOUND', 'Plan not found');

    const current = await platformRepository.findLatestSubscription(input.companyId, tx);

    // Case D: a custom duration, when the operator wants a fortnight rather than
    // whatever the plan says. It flows through the SAME date arithmetic - there
    // is no second implementation of "when does this end".
    const terms = {
      durationValue: input.durationValue ?? plan.durationValue,
      durationUnit: input.durationUnit ?? plan.durationUnit,
    };

    const { startDate, endDate } = resolvePeriod(today, current, terms);

    // What the shop is being charged. A free grant is 0, and that is a real
    // answer rather than a missing one.
    const amount = round(input.amount ?? '0', MONEY_DP);
    const isFree = !isGreaterThan(amount, 0);

    const subscription = await platformRepository.createSubscription(tx, {
      companyId: input.companyId,
      planId: plan.id,
      // Snapshotted exactly as a sale would, so a grant reads the same way in
      // history and survives the plan being repriced or renamed.
      planNameSnapshot: plan.name,
      // The price RECORDED, not the plan's list price: a ₹0 promotional grant
      // must not claim the shop was charged ₹500.
      priceSnapshot: amount,
      currencySnapshot: plan.currency,
      durationValueSnapshot: terms.durationValue,
      durationUnitSnapshot: terms.durationUnit,
      startDate,
      endDate,
      status: 'ACTIVE',
      origin: 'ADMIN_GRANT',
      grantReason: reason,
      previousSubscriptionId: current && current.status !== 'CANCELLED' ? current.id : null,
      createdById: currentUser.id,
    });

    // A payment row is written only when money actually changed hands. A ₹0
    // "payment" would dress a gift up as a transaction and quietly inflate every
    // collections report the operator runs.
    let payment = null;
    if (!isFree) {
      payment = await platformRepository.createPayment(tx, {
        subscriptionId: subscription.id,
        amount,
        // Neither of these is a gateway. MANUAL means collected offline.
        method: input.method ?? 'MANUAL',
        reference: input.reference ?? null,
        paidAt: today,
        notes: reason,
        collectedById: currentUser.id,
      });
    }

    // A shop switched off for non-payment can trade again the moment it is
    // recharged - otherwise an admin would have to remember a second step.
    if (!company.isActive) {
      await tx.company.update({ where: { id: company.id }, data: { isActive: true } });
    }

    return { subscription, payment, previous: current, reactivated: !company.isActive };
  });

  return {
    subscription: toPublicSubscription(result.subscription, today),
    payment: result.payment ? toPublicPayment(result.payment) : null,
    /** What it replaced, so the caller can show "30 Sep → 31 Dec". */
    previous: result.previous
      ? {
          id: result.previous.id,
          plan: result.previous.planNameSnapshot,
          endDate: toDateString(result.previous.endDate),
          status: deriveStatus(result.previous, today),
        }
      : null,
    reactivated: result.reactivated,
  };
}

/**
 * What a recharge WOULD do, without doing it.
 *
 * The dialog shows "current expiry 30 Sep → new expiry 31 Dec" before anybody
 * commits. That preview must be produced by the same arithmetic as the real
 * thing; a second implementation would eventually disagree with it, and the
 * disagreement would only surface after somebody had already clicked.
 */
export async function previewGrant(companyId, { planId, durationValue, durationUnit }) {
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));

  const company = await platformRepository.findShopById(companyId);
  if (!company) throw ApiError.business(404, 'BUSINESS_NOT_FOUND', 'Business not found');

  const plan = await platformRepository.findPlanById(planId);
  if (!plan) throw ApiError.business(404, 'PLAN_NOT_FOUND', 'Plan not found');

  const current = await platformRepository.findLatestSubscription(companyId);

  const terms = {
    durationValue: durationValue ?? plan.durationValue,
    durationUnit: durationUnit ?? plan.durationUnit,
  };

  const { startDate, endDate } = resolvePeriod(today, current, terms);

  const currentStatus = current ? deriveStatus(current, today) : 'NONE';
  const extending = currentStatus === 'ACTIVE';

  return {
    plan: { id: plan.id, name: plan.name, price: toMoneyString(plan.price, 2) },
    current: current
      ? {
          plan: current.planNameSnapshot,
          endDate: toDateString(current.endDate),
          status: currentStatus,
        }
      : null,
    /** True when this adds to a running subscription rather than starting fresh. */
    extending,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
    duration: `${terms.durationValue} ${terms.durationUnit.toLowerCase()}${terms.durationValue === 1 ? '' : 's'}`,
    explanation: extending
      ? `This shop is paid up to ${toDateString(current.endDate)}. The new period starts the day after, so no paid days are lost.`
      : currentStatus === 'NONE'
        ? 'This shop has never had a subscription. The new period starts today.'
        : `This shop's subscription ${currentStatus === 'CANCELLED' ? 'was cancelled' : 'ended'} on ${toDateString(current.endDate)}. The new period starts today.`,
  };
}

/**
 * A shop's full subscription and payment history, for the audit trail.
 *
 * Read-only and ordered newest first. Every grant carries who made it and why,
 * which is what makes "why does this shop have free access?" answerable.
 */
export async function getCompanyHistory(companyId) {
  const company = await platformRepository.findShopById(companyId);
  if (!company) throw ApiError.business(404, 'BUSINESS_NOT_FOUND', 'Business not found');

  const asOf = new Date();
  const { items } = await platformRepository.findSubscriptions({ companyId, take: 200 });
  const payments = await platformRepository.findPaymentsForCompany(companyId);

  return {
    subscriptions: items.map((row) => toPublicSubscription(row, asOf)),
    payments: payments.map(toPublicPayment),
  };
}

export { toPublicPlan, toPublicSubscription, toPublicPayment };
