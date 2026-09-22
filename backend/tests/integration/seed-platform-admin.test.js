import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { seedPlatformAdmin } from '../../prisma/seed-platform-admin.js';
import { prisma, resetDatabase, createCompanyWithUsers } from '../helpers/db.js';

// THE PLATFORM SUPERADMIN.
//
// Until this seed existed, nobody could reach the platform console at all: the
// only seeded account was a SHOP's admin, who correctly holds no platform
// permission. This creates the operator's own account instead.
//
// The property that matters most here is the one about NOT promoting an
// existing shop user. Quietly turning a shop's admin into a platform
// administrator would hand them every other shop on the system.

const EMAIL = 'platform-seed@example.test';
const PASSWORD = 'platform-seed-password';

beforeAll(async () => {
  await resetDatabase();
  process.env.PLATFORM_ADMIN_EMAIL = EMAIL;
  process.env.PLATFORM_ADMIN_PASSWORD = PASSWORD;
});

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_PASSWORD;
  await resetDatabase();
});

describe('platform admin seed', () => {
  it('creates a PLATFORM_ADMIN with no company of its own', async () => {
    // The env is read at import time, so the seed is called with an explicit
    // override of what the module already loaded.
    const { env } = await import('../../src/config/env.js');
    env.PLATFORM_ADMIN_EMAIL = EMAIL;
    env.PLATFORM_ADMIN_PASSWORD = PASSWORD;

    const result = await seedPlatformAdmin();

    expect(result.created).toBe(true);
    expect(result.user.role).toBe('PLATFORM_ADMIN');
    // THE LINE THAT KEEPS THEM OUT OF EVERY SHOP'S BOOKS.
    expect(result.user.companyId).toBeNull();
  });

  it('stores the password hashed', async () => {
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });

    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(user.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('does not duplicate on a second run', async () => {
    const result = await seedPlatformAdmin();

    expect(result.created).toBe(false);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });

  it('creates an account that can actually sign in and reach the platform', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('PLATFORM_ADMIN');

    // And it can reach the console, which the shop admin cannot.
    const plans = await request(app)
      .get('/api/v1/plans')
      .set({ Authorization: `Bearer ${login.body.data.token}` });

    expect(plans.status).toBe(200);
  });

  // THE IMPORTANT ONE.
  it('refuses to promote an existing shop user to platform administrator', async () => {
    const { admin } = await createCompanyWithUsers('shopseed');

    const { env } = await import('../../src/config/env.js');
    env.PLATFORM_ADMIN_EMAIL = admin.email;

    await expect(seedPlatformAdmin()).rejects.toThrow(/already exists as ADMIN/i);

    // And that user is untouched.
    const unchanged = await prisma.user.findUnique({ where: { email: admin.email } });
    expect(unchanged.role).toBe('ADMIN');
    expect(unchanged.companyId).not.toBeNull();

    env.PLATFORM_ADMIN_EMAIL = EMAIL;
  });
});
