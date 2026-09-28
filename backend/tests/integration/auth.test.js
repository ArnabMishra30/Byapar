import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createTestUser, cookiesFrom } from '../helpers/db.js';

const EMAIL = 'tester@example.com';
const PASSWORD = 'test-password-123';

beforeAll(async () => {
  await resetDatabase();
  await createTestUser({ email: EMAIL, password: PASSWORD });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function loginAndGetToken() {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: EMAIL, password: PASSWORD });

  return cookiesFrom(response).byapar_at;
}

describe('POST /api/v1/auth/login', () => {
  it('logs in and sets the session as httpOnly cookies, never in the body', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(EMAIL);
    expect(response.body.data.token).toBeUndefined();

    const setCookie = response.headers['set-cookie'].join(' | ');
    expect(setCookie).toMatch(/byapar_at=[^;]+;.*Path=\/api\/v1;.*HttpOnly;.*SameSite=Strict/);
    expect(setCookie).toMatch(/byapar_rt=[^;]+;.*Path=\/api\/v1\/auth;.*HttpOnly;.*SameSite=Strict/);

    // Neither token may appear anywhere a page script can read.
    const { byapar_at: access, byapar_rt: refresh } = cookiesFrom(response);
    expect(JSON.stringify(response.body)).not.toContain(access);
    expect(JSON.stringify(response.body)).not.toContain(refresh);
  });

  it('accepts the email in a different case', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL.toUpperCase(), password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('rejects an unknown email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'Invalid credentials' });
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'Invalid credentials' });
  });

  it('rejects a request with missing fields and explains which ones', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation failed');

    const fields = response.body.errors.map((error) => error.field);
    expect(fields).toContain('body.email');
    expect(fields).toContain('body.password');
  });

  it('rejects a malformed email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.email');
  });

  it('rejects a deactivated user', async () => {
    await createTestUser({ email: 'inactive@example.com', password: PASSWORD, isActive: false });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@example.com', password: PASSWORD });

    expect(response.status).toBe(401);
  });

  it('never exposes the password hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$argon2');
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user with a valid token', async () => {
    const token = await loginAndGetToken();

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(EMAIL);
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('rejects a request without a token', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Token abc123');

    expect(response.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid or expired token');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: 'some-user-id' }, 'a-different-secret-value-1234567890');

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ sub: 'some-user-id' }, process.env.JWT_SECRET, { expiresIn: '-1s' });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expired}`);

    expect(response.status).toBe(401);
  });

  it('rejects a valid token whose user no longer exists', async () => {
    const { user } = await createTestUser({ email: 'deleted@example.com', password: PASSWORD });
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });

    await prisma.user.delete({ where: { id: user.id } });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});

describe('cookie sessions', () => {
  async function signIn() {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    return cookiesFrom(response);
  }

  const refreshWith = (refreshToken) =>
    request(app).post('/api/v1/auth/refresh').set('Cookie', `byapar_rt=${refreshToken}`);

  it('authenticates a request from the access cookie alone', async () => {
    const { byapar_at: access } = await signIn();

    const response = await request(app).get('/api/v1/auth/me').set('Cookie', `byapar_at=${access}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(EMAIL);
  });

  it('stores only a hash of the refresh token', async () => {
    const { byapar_rt: refresh } = await signIn();

    const rows = await prisma.refreshToken.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.tokenHash === refresh)).toBe(false);
  });

  it('refreshes: a new access token and a ROTATED refresh token', async () => {
    const { byapar_rt: original } = await signIn();

    const response = await refreshWith(original);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(EMAIL);
    const next = cookiesFrom(response);
    expect(next.byapar_at).toBeTruthy();
    expect(next.byapar_rt).toBeTruthy();
    expect(next.byapar_rt).not.toBe(original);

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `byapar_at=${next.byapar_at}`);
    expect(me.status).toBe(200);
  });

  it('tolerates two tabs refreshing with the same token at once', async () => {
    const { byapar_rt: original } = await signIn();

    const first = await refreshWith(original);
    const second = await refreshWith(original);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The loser gets an access token only and leaves the winner's cookie alone.
    expect(cookiesFrom(second).byapar_at).toBeTruthy();
    expect(cookiesFrom(second).byapar_rt).toBeUndefined();
  });

  it('treats a replayed old token as theft and ends the whole sign-in', async () => {
    const { byapar_rt: original } = await signIn();
    const rotated = cookiesFrom(await refreshWith(original)).byapar_rt;

    // Age the rotation past the grace window, as a thief replaying later would.
    await prisma.refreshToken.updateMany({
      where: { replacedById: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60 * 1000) },
    });

    const replay = await refreshWith(original);
    expect(replay.status).toBe(401);
    expect(cookiesFrom(replay).byapar_rt).toBe('');

    // The legitimate holder's newer token is dead too.
    const legit = await refreshWith(rotated);
    expect(legit.status).toBe(401);
  });

  it('rejects a missing, unknown or expired refresh token', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
    expect((await refreshWith('not-a-real-token')).status).toBe(401);

    const { byapar_rt: refresh } = await signIn();
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refreshWith(refresh)).status).toBe(401);
  });

  it('refuses to refresh for a deactivated user', async () => {
    const other = 'deactivated-refresh@example.com';
    const { user } = await createTestUser({ email: other, password: PASSWORD });
    const login = await request(app).post('/api/v1/auth/login').send({ email: other, password: PASSWORD });
    const { byapar_rt: refresh } = cookiesFrom(login);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect((await refreshWith(refresh)).status).toBe(401);
  });

  it('logout revokes the refresh token and clears both cookies', async () => {
    const { byapar_rt: refresh } = await signIn();

    const response = await request(app).post('/api/v1/auth/logout').set('Cookie', `byapar_rt=${refresh}`);

    expect(response.status).toBe(200);
    const cleared = cookiesFrom(response);
    expect(cleared.byapar_at).toBe('');
    expect(cleared.byapar_rt).toBe('');

    expect((await refreshWith(refresh)).status).toBe(401);
  });

  it('logout without a session still succeeds', async () => {
    const response = await request(app).post('/api/v1/auth/logout');
    expect(response.status).toBe(200);
  });
});
