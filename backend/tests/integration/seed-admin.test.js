import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { seedAdmin } from '../../prisma/seed-admin.js';
import { prisma, resetDatabase } from '../helpers/db.js';

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('admin seed', () => {
  it('creates the admin user and its company on the first run', async () => {
    const result = await seedAdmin();

    expect(result.created).toBe(true);
    expect(result.user.email).toBe(process.env.ADMIN_EMAIL.toLowerCase());
    expect(result.user.role).toBe('ADMIN');
    expect(result.user.companyId).toBe(result.company.id);
  });

  it('stores the password hashed, never in plain text', async () => {
    const user = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL.toLowerCase() },
    });

    expect(user.passwordHash).not.toBe(process.env.ADMIN_PASSWORD);
    expect(user.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('does not create a duplicate when run again', async () => {
    const result = await seedAdmin();
    expect(result.created).toBe(false);

    const userCount = await prisma.user.count({
      where: { email: process.env.ADMIN_EMAIL.toLowerCase() },
    });
    const companyCount = await prisma.company.count();

    expect(userCount).toBe(1);
    expect(companyCount).toBe(1);
  });

  it('creates an admin who can log in with the seeded password', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe('ADMIN');
  });
});
