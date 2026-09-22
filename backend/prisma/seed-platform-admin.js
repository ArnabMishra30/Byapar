import { env } from '../src/config/env.js';
import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';

/**
 * Creates the PLATFORM operator's superadmin.
 *
 * WHY THIS EXISTS SEPARATELY FROM seed-admin.js. That script seeds a SHOP: a
 * company, and an ADMIN who runs it. This one seeds the person who runs the
 * SaaS itself - who has no shop, and must not have one.
 *
 * Keeping them apart is the whole point. A shop's admin who could also
 * administer the platform would be able to reach every OTHER shop's account, and
 * the multi-tenancy boundary would exist only by accident.
 *
 * The account created here:
 *   role       PLATFORM_ADMIN  - passes every platform permission implicitly
 *   companyId  null            - so no shop route can ever resolve a tenant
 *                                for them, and no shop's books are reachable
 *
 * Safe to run repeatedly: the user is matched by email, and an existing account
 * is never duplicated and its password is never overwritten.
 *
 * Run with: npm run seed:platform
 */
export async function seedPlatformAdmin() {
  if (!env.PLATFORM_ADMIN_EMAIL || !env.PLATFORM_ADMIN_PASSWORD) {
    throw new Error(
      'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must be set in .env before running this seed (see .env.example)',
    );
  }

  const email = env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase();
  const existing = await authRepository.findUserByEmail(email);

  if (existing) {
    // Someone already signs in with this address. If they are already the
    // platform admin, there is nothing to do. If they are a SHOP user, refuse
    // rather than silently promoting them - quietly turning a shop's admin into
    // a platform superadmin is exactly the mistake this file exists to prevent.
    if (existing.role !== 'PLATFORM_ADMIN') {
      throw new Error(
        `${email} already exists as ${existing.role} and was left untouched. ` +
          'Use a different PLATFORM_ADMIN_EMAIL: promoting an existing shop user to platform ' +
          'administrator would give them access to every other business.',
      );
    }

    return { created: false, user: existing };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: env.PLATFORM_ADMIN_NAME,
      passwordHash: await hashPassword(env.PLATFORM_ADMIN_PASSWORD),
      role: 'PLATFORM_ADMIN',
      // No company. This is what keeps them out of every shop's books.
      companyId: null,
      // Empty on purpose: a PLATFORM_ADMIN bypasses the permission list
      // entirely, so an explicit list here would only be misleading.
      permissions: [],
    },
    select: { id: true, email: true, name: true, role: true, companyId: true },
  });

  return { created: true, user };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-platform-admin.js');

if (isDirectRun) {
  seedPlatformAdmin()
    .then((result) => {
      if (result.created) {
        console.log(`Platform administrator created: ${result.user.email}`);
        console.log('This account administers the SaaS platform and belongs to no shop.');
      } else {
        console.log(`Platform administrator already exists: ${result.user.email} (nothing changed)`);
      }
    })
    .catch((error) => {
      console.error(`Seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
