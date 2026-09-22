import { env, isProduction } from '../src/config/env.js';
import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as companyRepository from '../src/modules/companies/company.repository.js';
import * as userRepository from '../src/modules/users/user.repository.js';
import { initializeCompanyDefaults } from '../src/modules/companies/company-defaults.js';

/**
 * DEVELOPMENT DEMO ACCOUNTS — one of each role, so every login screen in the
 * project can actually be tried.
 *
 * WHY THIS IS A SEED AND NOT A DOCUMENT OF PASSWORDS.
 *
 * Credentials belong in a seed script that a developer runs against their own
 * empty database, never in frontend source, never in a committed .env, and never
 * printed on a login page. A login screen that advertises a password is both a
 * security problem and - when the password is later changed - a support problem
 * that looks exactly like a broken login.
 *
 * REFUSES TO RUN IN PRODUCTION. These are known-weak passwords published in the
 * project's own README. Creating them on a live system would be handing out the
 * keys, so NODE_ENV=production stops this script dead.
 *
 * Run with: npm run seed:demo
 */

const PASSWORD = 'Demo@12345';

const ACCOUNTS = {
  platformAdmin: { email: 'superadmin@byapar.test', name: 'Platform Super Admin' },
  salesStaff: { email: 'sales@byapar.test', name: 'Sales Representative' },
  shopOwner: { email: 'owner@demoshop.test', name: 'Demo Shop Owner' },
  shopStaff: { email: 'staff@demoshop.test', name: 'Demo Shop Staff' },
};

const SHOP_NAME = 'Demo Kirana Store';

/** Creates a user only if the email is free. Never overwrites a password. */
async function ensureUser({ email, name, role, companyId, permissions = [] }) {
  const existing = await authRepository.findUserByEmail(email);
  if (existing) return { created: false, user: existing };

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      companyId,
      permissions,
      passwordHash: await hashPassword(PASSWORD),
    },
    select: { id: true, email: true, name: true, role: true, companyId: true },
  });

  return { created: true, user };
}

/**
 * The name of the database host, or '' if DATABASE_URL cannot be parsed.
 *
 * NODE_ENV alone is not enough protection: running this from a laptop, whose
 * .env says "development", with DATABASE_URL pointed at a hosted database would
 * sail past that check. The host is what actually says where the data goes.
 */
function databaseHost() {
  try {
    return new URL(env.DATABASE_URL).hostname;
  } catch {
    return '';
  }
}

const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

export async function seedDemo() {
  if (isProduction) {
    throw new Error(
      'Refusing to seed demo accounts with NODE_ENV=production. These passwords are published in the README.',
    );
  }

  const host = databaseHost();
  if (!LOCAL_DATABASE_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to seed demo accounts into a non-local database (${host || 'unreadable DATABASE_URL'}). These passwords are published in the README.`,
    );
  }

  const created = [];

  // --- the platform operator's own people ----------------------------------
  //
  // companyId is null for both. That single fact is what keeps them out of
  // every shop's books: shop routes derive their tenant from req.user.companyId.
  const superAdmin = await ensureUser({
    ...ACCOUNTS.platformAdmin,
    role: 'PLATFORM_ADMIN',
    companyId: null,
  });
  if (superAdmin.created) created.push('Platform Super Admin');

  const sales = await ensureUser({
    ...ACCOUNTS.salesStaff,
    role: 'SALES_STAFF',
    companyId: null,
    // The ordinary field-rep set: sign shops up, sell plans, take money.
    // Deliberately WITHOUT SUBSCRIPTION_GRANT - handing out free access is a
    // permission an operator grants on purpose, not a default.
    permissions: [
      'BUSINESS_CREATE',
      'BUSINESS_VIEW',
      'SUBSCRIPTION_CREATE',
      'SUBSCRIPTION_VIEW',
      'PAYMENT_CREATE',
      'PAYMENT_VIEW',
      'PLAN_VIEW',
    ],
  });
  if (sales.created) created.push('Sales Representative');

  // --- a demo shop, and the two people who work in it ----------------------
  let company = await companyRepository.findByName(SHOP_NAME);
  if (!company) {
    company = await companyRepository.create({
      name: SHOP_NAME,
      ownerName: ACCOUNTS.shopOwner.name,
      city: 'Pune',
      // GST deliberately OFF. Most small shops are not registered, and the demo
      // should show the product as they will actually meet it.
      gstin: null,
      stateCode: null,
      gstRegistrationType: 'UNREGISTERED',
    });
    created.push(`Company "${SHOP_NAME}"`);
  }

  // Chart of accounts, units and taxes. Idempotent, so re-running repairs a
  // company that predates a default rather than duplicating anything.
  await initializeCompanyDefaults(company.id);

  const owner = await ensureUser({
    ...ACCOUNTS.shopOwner,
    // ADMIN means SHOP OWNER. It has never meant platform administrator.
    role: 'ADMIN',
    companyId: company.id,
  });
  if (owner.created) created.push('Shop Owner');

  const staff = await ensureUser({
    ...ACCOUNTS.shopStaff,
    role: 'STAFF',
    companyId: company.id,
  });
  if (staff.created) created.push('Shop Staff');

  return {
    created,
    password: PASSWORD,
    company,
    accounts: {
      platformAdmin: superAdmin.user,
      salesStaff: sales.user,
      shopOwner: owner.user,
      shopStaff: staff.user,
    },
  };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo.js');

if (isDirectRun) {
  seedDemo()
    .then((result) => {
      console.log('');
      console.log('Demo accounts ready. Password for all four:  ' + result.password);
      console.log('');
      console.log('  PLATFORM CONSOLE   http://localhost:3001/admin/login');
      console.log(`    Super Admin      ${ACCOUNTS.platformAdmin.email}`);
      console.log(`    Sales Rep        ${ACCOUNTS.salesStaff.email}`);
      console.log('');
      console.log('  SHOP APPLICATION   http://localhost:3002/shop/login');
      console.log(`    Shop Owner       ${ACCOUNTS.shopOwner.email}`);
      console.log(`    Shop Staff       ${ACCOUNTS.shopStaff.email}`);
      console.log('');
      console.log('  LANDING PAGE       http://localhost:3002/');
      console.log('');

      if (result.created.length === 0) {
        console.log('Nothing new was created - they all existed already.');
      } else {
        console.log('Created: ' + result.created.join(', '));
      }

      console.log('');
      console.log('A shop owner has NO subscription yet. Sell or grant one from the');
      console.log('platform console to let them record new business.');
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}

export { ACCOUNTS, PASSWORD, SHOP_NAME };
