import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// Two separate tenants. Company A must never be able to see or touch Company B.
let companyA;
let companyB;
let adminAToken;
let staffAToken;
let adminBToken;

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('alpha');
  companyB = await createCompanyWithUsers('beta');

  adminAToken = await login(app, companyA.admin.email, companyA.adminPassword);
  staffAToken = await login(app, companyA.staff.email, companyA.staffPassword);
  adminBToken = await login(app, companyB.admin.email, companyB.adminPassword);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('RBAC on user management', () => {
  it('lets an ADMIN list users', async () => {
    const response = await request(app).get('/api/v1/users').set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('returns 403 when STAFF lists users', async () => {
    const response = await request(app).get('/api/v1/users').set(auth(staffAToken));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('returns 403 when STAFF creates a user', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(staffAToken))
      .send({ email: 'new@alpha.test', password: 'password123', name: 'New User' });

    expect(response.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: 'new@alpha.test' } })).toBeNull();
  });

  it('returns 403 when STAFF deactivates another user', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyA.admin.id}/status`)
      .set(auth(staffAToken))
      .send({ isActive: false });

    expect(response.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/v1/users');
    expect(response.status).toBe(401);
  });
});

describe('tenant isolation', () => {
  it('lists only users of the current company', async () => {
    const response = await request(app).get('/api/v1/users').set(auth(adminAToken));

    const emails = response.body.data.map((user) => user.email);
    expect(emails).toContain(companyA.admin.email);
    expect(emails).toContain(companyA.staff.email);
    expect(emails).not.toContain(companyB.admin.email);
    expect(emails).not.toContain(companyB.staff.email);
    expect(response.body.data.every((user) => user.companyId === companyA.company.id)).toBe(true);
  });

  it('returns 404 when reading a user from another company', async () => {
    const response = await request(app)
      .get(`/api/v1/users/${companyB.staff.id}`)
      .set(auth(adminAToken));

    expect(response.status).toBe(404);
  });

  it('returns 404 when updating a user from another company, and changes nothing', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyB.staff.id}`)
      .set(auth(adminAToken))
      .send({ name: 'Hijacked' });

    expect(response.status).toBe(404);

    const untouched = await prisma.user.findUnique({ where: { id: companyB.staff.id } });
    expect(untouched.name).toBe(companyB.staff.name);
  });

  it('returns 404 when deactivating a user from another company, and changes nothing', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyB.staff.id}/status`)
      .set(auth(adminAToken))
      .send({ isActive: false });

    expect(response.status).toBe(404);

    const untouched = await prisma.user.findUnique({ where: { id: companyB.staff.id } });
    expect(untouched.isActive).toBe(true);
  });

  it('scopes each admin to their own company', async () => {
    const response = await request(app).get('/api/v1/users').set(auth(adminBToken));

    expect(response.body.data.every((user) => user.companyId === companyB.company.id)).toBe(true);
  });
});

describe('POST /api/v1/users', () => {
  it('creates a STAFF user in the admin company', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'created@alpha.test', password: 'password123', name: 'Created User' });

    expect(response.status).toBe(201);
    expect(response.body.data.user.email).toBe('created@alpha.test');
    expect(response.body.data.user.role).toBe('STAFF');
    expect(response.body.data.user.companyId).toBe(companyA.company.id);
  });

  it('hashes the password and never returns it', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'hashed@alpha.test', password: 'password123', name: 'Hashed User' });

    expect(JSON.stringify(response.body)).not.toContain('password123');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');

    const stored = await prisma.user.findUnique({ where: { email: 'hashed@alpha.test' } });
    expect(stored.passwordHash).not.toBe('password123');
    expect(stored.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('ignores a companyId supplied by the client', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({
        email: 'injected@alpha.test',
        password: 'password123',
        name: 'Injected User',
        companyId: companyB.company.id,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.user.companyId).toBe(companyA.company.id);

    const stored = await prisma.user.findUnique({ where: { email: 'injected@alpha.test' } });
    expect(stored.companyId).toBe(companyA.company.id);
  });

  it('rejects a duplicate email with 409', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: companyA.staff.email, password: 'password123', name: 'Duplicate' });

    expect(response.status).toBe(409);
  });

  it('rejects an invalid email', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'not-an-email', password: 'password123', name: 'Bad Email' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.email');
  });

  it('rejects a password shorter than 8 characters', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'weak@alpha.test', password: 'short', name: 'Weak Password' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.password');
  });

  it('rejects an invalid role', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'role@alpha.test', password: 'password123', name: 'Bad Role', role: 'SUPERUSER' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/users pagination', () => {
  it('returns the standard pagination block', async () => {
    const response = await request(app)
      .get('/api/v1/users?page=1&limit=2')
      .set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeLessThanOrEqual(2);
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(response.body.pagination.total).toBeGreaterThan(0);
    expect(response.body.pagination.totalPages).toBeGreaterThan(0);
  });

  it('rejects a limit above the maximum', async () => {
    const response = await request(app).get('/api/v1/users?limit=500').set(auth(adminAToken));

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('query.limit');
  });

  it('filters by search term', async () => {
    const response = await request(app)
      .get(`/api/v1/users?search=${encodeURIComponent(companyA.staff.email)}`)
      .set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe(companyA.staff.email);
  });

  it('never includes password hashes in a list', async () => {
    const response = await request(app).get('/api/v1/users').set(auth(adminAToken));

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns a user of the same company', async () => {
    const response = await request(app)
      .get(`/api/v1/users/${companyA.staff.id}`)
      .set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(companyA.staff.id);
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a malformed id without leaking a database error', async () => {
    const response = await request(app).get('/api/v1/users/not-a-uuid').set(auth(adminAToken));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('prisma');
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const response = await request(app)
      .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
      .set(auth(adminAToken));

    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/v1/users/:id/status', () => {
  it('lets an admin deactivate a staff user', async () => {
    const { body } = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'todeactivate@alpha.test', password: 'password123', name: 'To Deactivate' });

    const response = await request(app)
      .patch(`/api/v1/users/${body.data.user.id}/status`)
      .set(auth(adminAToken))
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.user.isActive).toBe(false);
  });

  it('blocks a deactivated user from logging in and from using an existing token', async () => {
    const created = await request(app)
      .post('/api/v1/users')
      .set(auth(adminAToken))
      .send({ email: 'blocked@alpha.test', password: 'password123', name: 'Blocked User' });

    // Token obtained while the account is still active.
    const token = await login(app, 'blocked@alpha.test', 'password123');

    const before = await request(app).get('/api/v1/auth/me').set(auth(token));
    expect(before.status).toBe(200);

    await request(app)
      .patch(`/api/v1/users/${created.body.data.user.id}/status`)
      .set(auth(adminAToken))
      .send({ isActive: false });

    // The existing token must stop working immediately.
    const after = await request(app).get('/api/v1/auth/me').set(auth(token));
    expect(after.status).toBe(401);

    const loginAttempt = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'blocked@alpha.test', password: 'password123' });
    expect(loginAttempt.status).toBe(401);
  });

  it('prevents an admin from deactivating themselves', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyA.admin.id}/status`)
      .set(auth(adminAToken))
      .send({ isActive: false });

    expect(response.status).toBe(400);
  });

  it('rejects a non-boolean status', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyA.staff.id}/status`)
      .set(auth(adminAToken))
      .send({ isActive: 'yes' });

    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/v1/users/:id', () => {
  it('updates the name of a user in the same company', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyA.staff.id}`)
      .set(auth(adminAToken))
      .send({ name: 'Renamed Staff' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.name).toBe('Renamed Staff');
  });

  it('prevents an admin from changing their own role', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyA.admin.id}`)
      .set(auth(adminAToken))
      .send({ role: 'STAFF' });

    expect(response.status).toBe(400);
  });

  it('rejects an empty update', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${companyA.staff.id}`)
      .set(auth(adminAToken))
      .send({});

    expect(response.status).toBe(400);
  });
});
