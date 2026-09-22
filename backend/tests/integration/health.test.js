import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/health', () => {
  it('reports that the API is running', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'API is running' });
  });
});

describe('GET /api/v1/health/db', () => {
  it('reports that the database is reachable', async () => {
    const response = await request(app).get('/api/v1/health/db');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe('unknown routes', () => {
  it('returns a 404 in the standard error shape', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(typeof response.body.message).toBe('string');
  });
});
