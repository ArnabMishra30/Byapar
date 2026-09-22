import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createTestUser } from '../helpers/db.js';

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

  return response.body.data.token;
}

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials and returns a token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.data.token).toBe('string');
    expect(response.body.data.user.email).toBe(EMAIL);
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
