import { env } from '../src/config/env.js';
import { disconnectPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import * as companyRepository from '../src/modules/companies/company.repository.js';
import * as userRepository from '../src/modules/users/user.repository.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import { initializeCompanyDefaults } from '../src/modules/companies/company-defaults.js';

/**
 * Creates the first company and admin user from environment variables.
 *
 * Safe to run any number of times:
 *  - the company is matched by name
 *  - the user is matched by email
 *  - an existing admin is never duplicated and its password is never overwritten
 *
 * Run with: npm run prisma:seed
 */
export async function seedAdmin() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env before running the seed (see .env.example)',
    );
  }

  const email = env.ADMIN_EMAIL.trim().toLowerCase();

  let company = await companyRepository.findByName(env.ADMIN_COMPANY_NAME);

  if (!company) {
    company = await companyRepository.create({ name: env.ADMIN_COMPANY_NAME });
  }

  // Settings plus default units and taxes. Idempotent, so re-running the seed
  // repairs a company that predates these defaults without touching edited rows.
  await initializeCompanyDefaults(company.id);

  const existingUser = await authRepository.findUserByEmail(email);

  if (existingUser) {
    return { created: false, company, user: existingUser };
  }

  const user = await userRepository.create({
    email,
    name: env.ADMIN_NAME,
    passwordHash: await hashPassword(env.ADMIN_PASSWORD),
    role: 'ADMIN',
    companyId: company.id,
  });

  return { created: true, company, user };
}

// Only run automatically when executed directly (npm run prisma:seed),
// never when imported by a test.
const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-admin.js');

if (isDirectRun) {
  seedAdmin()
    .then((result) => {
      if (result.created) {
        console.log(`Admin user created: ${result.user.email}`);
      } else {
        console.log(`Admin user already exists: ${result.user.email} (nothing changed)`);
      }
      console.log(`Company: ${result.company.name}`);
    })
    .catch((error) => {
      console.error(`Seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
