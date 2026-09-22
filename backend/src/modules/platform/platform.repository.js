import { prisma } from '../../config/prisma.js';

// All Prisma access for the SaaS layer: plans, subscriptions, the money the
// platform collects, and the sales staff who collect it.
//
// Nothing here reads or writes an accounting table. The two layers meet only at
// the Company row they both point at.

const PLAN_FIELDS = {
  id: true,
  name: true,
  description: true,
  durationValue: true,
  durationUnit: true,
  price: true,
  currency: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const SUBSCRIPTION_FIELDS = {
  id: true,
  companyId: true,
  planId: true,
  planNameSnapshot: true,
  priceSnapshot: true,
  currencySnapshot: true,
  durationValueSnapshot: true,
  durationUnitSnapshot: true,
  startDate: true,
  endDate: true,
  status: true,
  previousSubscriptionId: true,
  origin: true,
  grantReason: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  company: { select: { id: true, name: true, isActive: true } },
  plan: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

// --- plans -----------------------------------------------------------------

export function findPlanById(id, client = prisma) {
  return client.subscriptionPlan.findUnique({ where: { id }, select: PLAN_FIELDS });
}

export function findPlanByName(name) {
  return prisma.subscriptionPlan.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: PLAN_FIELDS,
  });
}

export async function findPlans({ skip, take, isActive, search } = {}) {
  const where = {};
  if (isActive !== undefined) where.isActive = isActive;
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      where,
      select: PLAN_FIELDS,
      orderBy: [{ isActive: 'desc' }, { price: 'asc' }],
      skip,
      take,
    }),
    prisma.subscriptionPlan.count({ where }),
  ]);

  return { items, total };
}

export function createPlan(data) {
  return prisma.subscriptionPlan.create({ data, select: PLAN_FIELDS });
}

export function updatePlan(id, data) {
  return prisma.subscriptionPlan.update({ where: { id }, data, select: PLAN_FIELDS });
}

/** How many subscriptions reference a plan. A plan in use is never deleted. */
export function countSubscriptionsForPlan(planId) {
  return prisma.subscription.count({ where: { planId } });
}

// --- subscriptions ---------------------------------------------------------

export function findSubscriptionById(id, client = prisma) {
  return client.subscription.findUnique({ where: { id }, select: SUBSCRIPTION_FIELDS });
}

/**
 * The newest subscription a shop has, whatever its state.
 *
 * "Newest" is by end date, not by creation: a renewal bought early has a later
 * end date and is the one that decides when the next period starts.
 */
export function findLatestSubscription(companyId, client = prisma) {
  return client.subscription.findFirst({
    where: { companyId },
    orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
    select: SUBSCRIPTION_FIELDS,
  });
}

/**
 * The subscription that entitles a shop to use the application today.
 *
 * Read on every shop request, so it is one indexed lookup and nothing more.
 */
export function findEntitlingSubscription(companyId, asOf, client = prisma) {
  return client.subscription.findFirst({
    where: {
      companyId,
      status: { in: ['ACTIVE', 'PENDING'] },
      startDate: { lte: asOf },
      endDate: { gte: asOf },
    },
    orderBy: { endDate: 'desc' },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      planNameSnapshot: true,
    },
  });
}

export async function findSubscriptions({ skip, take, companyId, status, expiringBefore } = {}) {
  const where = {};
  if (companyId) where.companyId = companyId;
  if (status) where.status = status;
  if (expiringBefore) {
    where.endDate = { lte: expiringBefore };
    where.status = where.status ?? 'ACTIVE';
  }

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      select: SUBSCRIPTION_FIELDS,
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.subscription.count({ where }),
  ]);

  return { items, total };
}

export function createSubscription(tx, data) {
  return tx.subscription.create({ data, select: SUBSCRIPTION_FIELDS });
}

export function updateSubscription(tx, id, data) {
  return tx.subscription.update({ where: { id }, data, select: SUBSCRIPTION_FIELDS });
}

/**
 * Locks a company's subscriptions for the duration of a transaction.
 *
 * Two sales reps selling the same shop a renewal at the same moment would
 * otherwise both read the same end date and both extend from it, giving the shop
 * one period instead of two. The lock is on the COMPANY row, because that is the
 * thing they are both contending for.
 */
export async function lockCompanyForSubscription(tx, companyId) {
  await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
  return tx.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, isActive: true },
  });
}

/** Flips every lapsed subscription to EXPIRED. Idempotent. */
export function expireLapsedSubscriptions(asOf) {
  return prisma.subscription.updateMany({
    where: { status: { in: ['ACTIVE', 'PENDING'] }, endDate: { lt: asOf } },
    data: { status: 'EXPIRED' },
  });
}

// --- payments --------------------------------------------------------------

export function createPayment(tx, data) {
  return tx.subscriptionPayment.create({
    data,
    select: {
      id: true,
      subscriptionId: true,
      amount: true,
      method: true,
      reference: true,
      paidAt: true,
      notes: true,
      createdAt: true,
      collectedBy: { select: { id: true, name: true } },
    },
  });
}

export function findPaymentsForSubscription(subscriptionId) {
  return prisma.subscriptionPayment.findMany({
    where: { subscriptionId },
    orderBy: { paidAt: 'desc' },
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      paidAt: true,
      notes: true,
      createdAt: true,
      collectedBy: { select: { id: true, name: true } },
    },
  });
}

/**
 * Every payment a shop has ever made, newest first.
 *
 * Reached through its subscriptions, because a payment belongs to a
 * subscription rather than directly to a company - the same shape the audit
 * trail on the business detail page needs.
 */
export function findPaymentsForCompany(companyId) {
  return prisma.subscriptionPayment.findMany({
    where: { subscription: { companyId } },
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      paidAt: true,
      notes: true,
      createdAt: true,
      collectedBy: { select: { id: true, name: true } },
      subscription: {
        select: {
          id: true,
          planNameSnapshot: true,
          origin: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function findPayments({ skip, take, collectedById, fromDate, toDate } = {}) {
  const where = {};
  if (collectedById) where.collectedById = collectedById;
  if (fromDate || toDate) {
    where.paidAt = {};
    if (fromDate) where.paidAt.gte = fromDate;
    if (toDate) where.paidAt.lte = toDate;
  }

  const [items, total] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        paidAt: true,
        createdAt: true,
        collectedBy: { select: { id: true, name: true } },
        subscription: {
          select: {
            id: true,
            planNameSnapshot: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.subscriptionPayment.count({ where }),
  ]);

  return { items, total };
}

export function sumPayments({ collectedById, fromDate, toDate } = {}) {
  const where = {};
  if (collectedById) where.collectedById = collectedById;
  if (fromDate || toDate) {
    where.paidAt = {};
    if (fromDate) where.paidAt.gte = fromDate;
    if (toDate) where.paidAt.lte = toDate;
  }

  return prisma.subscriptionPayment.aggregate({
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });
}

// --- sales staff -----------------------------------------------------------

const STAFF_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  permissions: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
};

export function findStaffById(id) {
  return prisma.user.findFirst({
    where: { id, role: { in: ['PLATFORM_ADMIN', 'SALES_STAFF'] } },
    select: STAFF_FIELDS,
  });
}

export async function findStaff({ skip, take, search, isActive } = {}) {
  const where = { role: { in: ['PLATFORM_ADMIN', 'SALES_STAFF'] } };
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: STAFF_FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.user.count({ where }),
  ]);

  return { items, total };
}

export function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

export function createStaff(data) {
  return prisma.user.create({ data, select: STAFF_FIELDS });
}

export function updateStaff(id, data) {
  return prisma.user.update({ where: { id }, data, select: STAFF_FIELDS });
}

// --- shops, from the platform's point of view ------------------------------

const SHOP_FIELDS = {
  id: true,
  name: true,
  ownerName: true,
  phone: true,
  email: true,
  city: true,
  pincode: true,
  gstin: true,
  stateCode: true,
  isActive: true,
  createdAt: true,
  onboardedBy: { select: { id: true, name: true } },
};

export async function findShops({ skip, take, search, onboardedById, isActive } = {}) {
  const where = {};
  if (onboardedById) where.onboardedById = onboardedById;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { ownerName: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.company.findMany({
      where,
      select: SHOP_FIELDS,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.company.count({ where }),
  ]);

  return { items, total };
}

export function findShopById(id) {
  return prisma.company.findUnique({ where: { id }, select: SHOP_FIELDS });
}

/** Switches a shop on or off. Deletes nothing - the books stay where they are. */
export function setShopActive(id, isActive) {
  return prisma.company.update({
    where: { id },
    data: { isActive },
    select: SHOP_FIELDS,
  });
}

export function countShops({ onboardedById } = {}) {
  return prisma.company.count({ where: onboardedById ? { onboardedById } : {} });
}

export function countSubscriptionsByStatus() {
  return prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } });
}

export function countSubscriptionsByPlan() {
  return prisma.subscription.groupBy({
    by: ['planNameSnapshot'],
    _count: { _all: true },
    _sum: { priceSnapshot: true },
  });
}

export function countStaff() {
  return prisma.user.count({ where: { role: { in: ['PLATFORM_ADMIN', 'SALES_STAFF'] } } });
}

export function findExpiringSubscriptions(from, to) {
  return prisma.subscription.findMany({
    where: { status: 'ACTIVE', endDate: { gte: from, lte: to } },
    orderBy: { endDate: 'asc' },
    select: SUBSCRIPTION_FIELDS,
  });
}

