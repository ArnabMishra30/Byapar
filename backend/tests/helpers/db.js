import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/config/prisma.js';
import { hashPassword } from '../../src/modules/auth/auth.service.js';
import { systemAccountRows } from '../../src/modules/accounting/system-accounts.js';

// Tests talk to Prisma directly on purpose: they set up and verify state, they
// are not application code. Application code must go through repositories.

/**
 * Removes all rows. Order matters: children before parents, because the foreign
 * keys are RESTRICT. Add new models here when they are introduced.
 */
export async function resetDatabase() {
  // Accounting periods reference companies and users.
  await prisma.accountingPeriod.deleteMany();
  // Expenses reference accounts and suppliers.
  await prisma.expense.deleteMany();
  // The general ledger next: journal lines reference accounts, and accounts
  // reference companies.
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.account.deleteMany();
  // Customer sub-ledger next: it references sales invoices and receivables.
  await prisma.salesReturnItem.deleteMany();
  await prisma.salesReturn.deleteMany();
  await prisma.customerPaymentAllocation.deleteMany();
  await prisma.customerLedgerEntry.deleteMany();
  await prisma.customerPayment.deleteMany();
  await prisma.customerReceivable.deleteMany();
  await prisma.salesInvoiceItem.deleteMany();
  await prisma.salesInvoice.deleteMany();
  // Then the supplier sub-ledger: it references purchases and payables.
  await prisma.supplierPaymentAllocation.deleteMany();
  await prisma.supplierLedgerEntry.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.supplierPayable.deleteMany();
  // Then returns: they reference purchase items.
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  // Then purchases: their items reference products and taxes.
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.documentSequence.deleteMany();
  // Then inventory: movements and balances reference products and warehouses.
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.product.deleteMany();
  // Tax classifications reference taxes and are referenced by products.
  await prisma.taxClassification.deleteMany();
  await prisma.category.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.tax.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.companySettings.deleteMany();
  // The SaaS layer. Bills reference companies and users; payments reference
  // subscriptions; subscriptions reference companies, plans and users. All of it
  // therefore goes before users and companies.
  await prisma.bill.deleteMany();
  await prisma.subscriptionPayment.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.subscriptionPlan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
}

export async function createCompany({ name = 'Test Co', gstin = null } = {}) {
  const company = await prisma.company.create({ data: { name, gstin } });

  // Every real company gets its chart of accounts from initializeCompanyDefaults.
  // Fixtures create companies directly, so they seed the same accounts here -
  // otherwise a posting would have to create them mid-transaction and the tests
  // would not exercise the production path.
  await prisma.account.createMany({
    data: systemAccountRows(company.id),
    skipDuplicates: true,
  });

  return company;
}

/** Creates one user inside an existing company. */
export async function createUser({
  companyId,
  email = 'user@example.com',
  password = 'test-password-123',
  name = 'Test User',
  role = 'STAFF',
  isActive = true,
}) {
  const user = await prisma.user.create({
    data: { email, name, role, isActive, companyId, passwordHash: await hashPassword(password) },
  });

  return { user, password };
}

/** Creates a company plus one user in it. Returns both, with the plain password. */
export async function createTestUser({
  email = 'tester@example.com',
  password = 'test-password-123',
  name = 'Tester',
  role = 'STAFF',
  isActive = true,
  companyName = 'Test Co',
} = {}) {
  const company = await createCompany({ name: companyName });
  const { user } = await createUser({ companyId: company.id, email, password, name, role, isActive });

  return { company, user, password };
}

/**
 * Builds a complete tenant: one company with an admin and a staff user.
 * Used by the RBAC and tenant isolation tests.
 */
export async function createCompanyWithUsers(prefix, gstin = null) {
  const company = await createCompany({ name: `${prefix} Company`, gstin });

  const { user: admin, password: adminPassword } = await createUser({
    companyId: company.id,
    email: `admin@${prefix}.test`,
    name: `${prefix} Admin`,
    role: 'ADMIN',
  });

  const { user: staff, password: staffPassword } = await createUser({
    companyId: company.id,
    email: `staff@${prefix}.test`,
    name: `${prefix} Staff`,
    role: 'STAFF',
  });

  return { company, admin, adminPassword, staff, staffPassword };
}

/**
 * Creates one of the SaaS operator's own people.
 *
 * companyId is NULL - a platform user belongs to no shop, which is precisely
 * what keeps them out of every shop's books.
 */
export async function createPlatformUser({
  email = 'platform@example.com',
  password = 'test-password-123',
  name = 'Platform User',
  role = 'SALES_STAFF',
  permissions,
  isActive = true,
} = {}) {
  const resolvedPermissions =
    permissions ??
    (role === 'SALES_STAFF'
      ? [
          'BUSINESS_CREATE',
          'BUSINESS_VIEW',
          'SUBSCRIPTION_CREATE',
          'SUBSCRIPTION_VIEW',
          'PAYMENT_CREATE',
          'PAYMENT_VIEW',
          'PLAN_VIEW',
        ]
      : []);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      isActive,
      companyId: null,
      permissions: resolvedPermissions,
      passwordHash: await hashPassword(password),
    },
  });

  return { user, password };
}

/**
 * A sellable plan. Price and duration are arguments - nothing is hardcoded.
 *
 * The name is unique per platform, so it defaults to a unique one: a test that
 * creates a plan alongside a subscription (which creates its own) would
 * otherwise collide on a constraint that has nothing to do with what it is
 * testing.
 */
export async function createPlan({
  name = `Test Plan ${randomUUID().slice(0, 8)}`,
  price = '300.0000',
  durationValue = 3,
  durationUnit = 'MONTH',
  isActive = true,
} = {}) {
  return prisma.subscriptionPlan.create({
    data: { name, price, durationValue, durationUnit, isActive },
  });
}

/**
 * Gives a company a subscription covering a date range.
 *
 * `daysFromToday` offsets are used rather than fixed dates so a test still means
 * the same thing when it runs next year.
 */
export async function createSubscription({
  companyId,
  planId = null,
  planName = 'Test Plan',
  price = '300.0000',
  startsInDays = -30,
  endsInDays = 30,
  status = 'ACTIVE',
  durationValue = 3,
  durationUnit = 'MONTH',
  createdById = null,
}) {
  const day = 86400000;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  let resolvedPlanId = planId;
  if (!resolvedPlanId) {
    // The PLAN's name must be unique; the SNAPSHOT on the subscription need not
    // be, and stays whatever the test asked for so assertions read naturally.
    const plan = await createPlan({
      name: `${planName} ${randomUUID().slice(0, 8)}`,
      price,
      durationValue,
      durationUnit,
    });
    resolvedPlanId = plan.id;
  }

  // Somebody always sells a subscription - the column is required precisely so
  // that every one of them has an audit trail. A fixture that omits it gets a
  // platform admin created for it rather than a null.
  let resolvedCreatedById = createdById;
  if (!resolvedCreatedById) {
    const { user } = await createPlatformUser({
      email: `subscription-creator-${randomUUID()}@platform.test`,
      role: 'PLATFORM_ADMIN',
    });
    resolvedCreatedById = user.id;
  }

  return prisma.subscription.create({
    data: {
      companyId,
      planId: resolvedPlanId,
      planNameSnapshot: planName,
      priceSnapshot: price,
      durationValueSnapshot: durationValue,
      durationUnitSnapshot: durationUnit,
      startDate: new Date(today.getTime() + startsInDays * day),
      endDate: new Date(today.getTime() + endsInDays * day),
      status,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
      cancelReason: status === 'CANCELLED' ? 'Test cancellation' : null,
      createdById: resolvedCreatedById,
    },
  });
}

/** Logs in through the real endpoint and returns the token. */
export async function login(app, email, password) {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return response.body.data.token;
}

export { prisma };
