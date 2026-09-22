import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { round, toMoneyString } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import { hashPassword } from '../auth/auth.service.js';
import * as companyRepository from '../companies/company.repository.js';
import * as userRepository from '../users/user.repository.js';
import { initializeCompanyDefaults } from '../companies/company-defaults.js';
import * as platformRepository from './platform.repository.js';
import { resolvePeriod, assertPlanSellable, toBusinessDate, toDateString } from './subscription.rules.js';
import {
  DEFAULT_SALES_STAFF_PERMISSIONS,
  assertValidPermissions,
  isPlatformRole,
} from './permissions.js';

// SHOP ONBOARDING and SALES TEAM.
//
// A rep standing in a shop does one thing: signs it up. That is a company, its
// owner's login, a subscription, and usually some cash - and it must be all or
// nothing. Half of it would leave either a shop that cannot log in or a payment
// against a shop that does not exist.
//
// So it is ONE transaction, built from the SAME pieces the existing company
// service uses: companyRepository, userRepository and initializeCompanyDefaults.
// Nothing about creating a company is reimplemented here.

const MONEY_DP = 4;

// --- shop onboarding -------------------------------------------------------

/**
 * Registers a shop, creates its owner's login, sells it a plan and records the
 * money - in one transaction.
 *
 * `initializeCompanyDefaults` is the same call the ordinary company-creation
 * path makes: it seeds the chart of accounts, units and taxes. A shop must never
 * exist without them, which is why it is inside this transaction too.
 */
export async function onboardShop(currentUser, input) {
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));

  // Everything that can be checked without a lock, checked before we take one.
  const [nameTaken, emailTaken] = await Promise.all([
    companyRepository.findByName(input.name),
    userRepository.findByEmail(input.owner.email),
  ]);

  if (nameTaken) {
    throw ApiError.business(409, 'BUSINESS_NAME_TAKEN', 'A business with this name already exists');
  }
  if (emailTaken) {
    throw ApiError.business(409, 'EMAIL_TAKEN', 'Someone already signs in with this email');
  }
  if (input.gstin) {
    const gstinTaken = await companyRepository.findByGstin(input.gstin);
    if (gstinTaken) {
      throw ApiError.business(409, 'GSTIN_TAKEN', 'A business with this GSTIN already exists');
    }
  }

  // A plan is optional at onboarding: a rep may register a shop today and sell
  // it a plan tomorrow. If one IS named, it must be sellable.
  const plan = input.planId
    ? assertPlanSellable(await platformRepository.findPlanById(input.planId))
    : null;

  const passwordHash = await hashPassword(input.owner.password);

  const result = await withRetryableTransaction(async (tx) => {
    const company = await companyRepository.create(
      {
        name: input.name,
        // GST is OPTIONAL. A shop with no registration sends neither of these,
        // and stateCode staying null is exactly what keeps GST switched off.
        gstin: input.gstin ?? null,
        stateCode: input.stateCode ?? null,
        gstRegistrationType: input.gstin ? 'REGULAR' : 'UNREGISTERED',
        ownerName: input.owner.name,
        phone: input.phone ?? null,
        email: input.email ?? input.owner.email,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
        registeredAddress: input.address ?? null,
        onboardedById: currentUser.id,
      },
      tx,
    );

    const owner = await userRepository.create(
      {
        email: input.owner.email,
        name: input.owner.name,
        passwordHash,
        // The shop's own admin - not a platform role. They run their shop; they
        // have no access to the platform's plans, staff or other shops.
        role: 'ADMIN',
        companyId: company.id,
      },
      tx,
    );

    // The chart of accounts, units and taxes. Same call the ordinary company
    // path makes; a shop must never exist without them.
    await initializeCompanyDefaults(company.id, tx);

    let subscription = null;
    let payment = null;

    if (plan) {
      const { startDate, endDate } = resolvePeriod(today, null, plan);

      subscription = await platformRepository.createSubscription(tx, {
        companyId: company.id,
        planId: plan.id,
        planNameSnapshot: plan.name,
        priceSnapshot: round(plan.price, MONEY_DP),
        currencySnapshot: plan.currency,
        durationValueSnapshot: plan.durationValue,
        durationUnitSnapshot: plan.durationUnit,
        startDate,
        endDate,
        status: 'ACTIVE',
        createdById: currentUser.id,
      });

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
    }

    return { company, owner, subscription, payment };
  });

  return {
    business: {
      id: result.company.id,
      name: result.company.name,
      ownerName: input.owner.name,
      phone: input.phone ?? null,
      city: input.city ?? null,
      gstEnabled: Boolean(input.stateCode),
      gstin: input.gstin ?? null,
    },
    owner: {
      id: result.owner.id,
      email: result.owner.email,
      name: result.owner.name,
      role: result.owner.role,
    },
    subscription: result.subscription
      ? {
          id: result.subscription.id,
          plan: result.subscription.planNameSnapshot,
          price: toMoneyString(result.subscription.priceSnapshot, 2),
          startDate: toDateString(result.subscription.startDate),
          endDate: toDateString(result.subscription.endDate),
          status: result.subscription.status,
        }
      : null,
    payment: result.payment
      ? {
          id: result.payment.id,
          amount: toMoneyString(result.payment.amount, 2),
          method: result.payment.method,
        }
      : null,
    note: 'The shop owner can now sign in to the business application with the email and password given here.',
  };
}

/** Shops, as the platform sees them. Not a shop's own data - just the account. */
export async function listShops(currentUser, query = {}) {
  const { page, limit, search, isActive, mine } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await platformRepository.findShops({
    skip,
    take,
    search,
    isActive,
    // A rep looking at "my shops" sees the ones they signed up.
    onboardedById: mine ? currentUser.id : query.onboardedById,
  });

  return {
    businesses: items.map(toPublicShop),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getShop(id) {
  const shop = await platformRepository.findShopById(id);
  if (!shop) throw ApiError.business(404, 'BUSINESS_NOT_FOUND', 'Business not found');

  const { items } = await platformRepository.findSubscriptions({ companyId: id, take: 50 });
  const latest = items[0] ?? null;

  return {
    ...toPublicShop(shop),
    subscriptions: items.map((row) => ({
      id: row.id,
      plan: row.planNameSnapshot,
      price: toMoneyString(row.priceSnapshot, 2),
      startDate: toDateString(row.startDate),
      endDate: toDateString(row.endDate),
      status: row.status,
    })),
    currentSubscription: latest
      ? {
          id: latest.id,
          plan: latest.planNameSnapshot,
          endDate: toDateString(latest.endDate),
          status: latest.status,
        }
      : null,
  };
}

function toPublicShop(shop) {
  return {
    id: shop.id,
    name: shop.name,
    ownerName: shop.ownerName,
    phone: shop.phone,
    email: shop.email,
    city: shop.city,
    pincode: shop.pincode,
    gstin: shop.gstin,
    /** Derived the same way the shop application derives it. */
    gstEnabled: Boolean(shop.stateCode),
    isActive: shop.isActive,
    onboardedBy: shop.onboardedBy,
    createdAt: shop.createdAt,
  };
}

/**
 * Turns a shop's account on or off.
 *
 * Deactivating blocks its people from signing in. It deletes NOTHING: the books
 * stay exactly where they are, and turning the account back on restores access
 * to all of it.
 */
export async function setShopActive(id, isActive) {
  const shop = await platformRepository.findShopById(id);
  if (!shop) throw ApiError.business(404, 'BUSINESS_NOT_FOUND', 'Business not found');

  return toPublicShop(await platformRepository.setShopActive(id, isActive));
}

// --- sales team ------------------------------------------------------------

function toPublicStaff(staff) {
  return {
    id: staff.id,
    email: staff.email,
    name: staff.name,
    role: staff.role,
    permissions: staff.permissions ?? [],
    isActive: staff.isActive,
    lastLoginAt: staff.lastLoginAt,
    createdAt: staff.createdAt,
  };
}

export async function listStaff(query = {}) {
  const { page, limit, search, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await platformRepository.findStaff({ skip, take, search, isActive });

  return { staff: items.map(toPublicStaff), pagination: buildPagination({ page, limit, total }) };
}

export async function getStaff(id) {
  const staff = await platformRepository.findStaffById(id);
  if (!staff) throw ApiError.business(404, 'STAFF_NOT_FOUND', 'Staff member not found');

  const [shopCount, collected] = await Promise.all([
    platformRepository.countShops({ onboardedById: id }),
    platformRepository.sumPayments({ collectedById: id }),
  ]);

  return {
    ...toPublicStaff(staff),
    shopsOnboarded: shopCount,
    paymentsCollected: {
      total: toMoneyString(collected._sum.amount ?? 0, 2),
      count: collected._count._all,
    },
  };
}

/**
 * Creates a member of the platform's own team.
 *
 * They have NO company: a sales rep works across every shop and owns none. That
 * is why `companyId` is nullable, and it is what keeps them out of any shop's
 * books - a shop route reads req.user.companyId, and theirs is null.
 */
export async function createStaff(input) {
  const emailTaken = await platformRepository.findUserByEmail(input.email);
  if (emailTaken) {
    throw ApiError.business(409, 'EMAIL_TAKEN', 'Someone already signs in with this email');
  }

  const role = input.role ?? 'SALES_STAFF';
  if (!isPlatformRole(role)) {
    throw ApiError.business(
      422,
      'INVALID_STAFF_ROLE',
      'A platform staff member must be PLATFORM_ADMIN or SALES_STAFF',
    );
  }

  const permissions = input.permissions ?? DEFAULT_SALES_STAFF_PERMISSIONS;
  const unknown = assertValidPermissions(permissions);
  if (unknown.length > 0) {
    throw ApiError.business(422, 'UNKNOWN_PERMISSION', `Unknown permission: ${unknown.join(', ')}`);
  }

  const staff = await platformRepository.createStaff({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    role,
    // No shop. This is the platform's own person.
    companyId: null,
    // A PLATFORM_ADMIN can do everything regardless, so an explicit list on one
    // would only be misleading.
    permissions: role === 'PLATFORM_ADMIN' ? [] : permissions,
  });

  return toPublicStaff(staff);
}

export async function updateStaff(id, input) {
  const staff = await platformRepository.findStaffById(id);
  if (!staff) throw ApiError.business(404, 'STAFF_NOT_FOUND', 'Staff member not found');

  const data = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  if (input.role !== undefined) {
    if (!isPlatformRole(input.role)) {
      throw ApiError.business(
        422,
        'INVALID_STAFF_ROLE',
        'A platform staff member must be PLATFORM_ADMIN or SALES_STAFF',
      );
    }
    data.role = input.role;
  }

  if (input.permissions !== undefined) {
    const unknown = assertValidPermissions(input.permissions);
    if (unknown.length > 0) {
      throw ApiError.business(422, 'UNKNOWN_PERMISSION', `Unknown permission: ${unknown.join(', ')}`);
    }
    data.permissions = input.permissions;
  }

  return toPublicStaff(await platformRepository.updateStaff(id, data));
}

export { toPublicShop, toPublicStaff };
