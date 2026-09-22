import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

let companyA;
let companyB;
let adminAToken;
let staffAToken;

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('alpha', '27AAPFU0939F1ZV');
  companyB = await createCompanyWithUsers('beta');

  adminAToken = await login(app, companyA.admin.email, companyA.adminPassword);
  staffAToken = await login(app, companyA.staff.email, companyA.staffPassword);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('GET /api/v1/companies/me', () => {
  it('returns the current company for an admin', async () => {
    const response = await request(app).get('/api/v1/companies/me').set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(response.body.data.company.id).toBe(companyA.company.id);
  });

  it('returns the current company for staff as well', async () => {
    const response = await request(app).get('/api/v1/companies/me').set(auth(staffAToken));

    expect(response.status).toBe(200);
    expect(response.body.data.company.id).toBe(companyA.company.id);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/companies/me');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/companies/:id', () => {
  it('returns the admin own company', async () => {
    const response = await request(app)
      .get(`/api/v1/companies/${companyA.company.id}`)
      .set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(response.body.data.company.name).toBe(companyA.company.name);
  });

  it('returns 404 for another company', async () => {
    const response = await request(app)
      .get(`/api/v1/companies/${companyB.company.id}`)
      .set(auth(adminAToken));

    expect(response.status).toBe(404);
  });

  it('returns 403 for staff', async () => {
    const response = await request(app)
      .get(`/api/v1/companies/${companyA.company.id}`)
      .set(auth(staffAToken));

    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/v1/companies/:id', () => {
  it('updates the admin own company', async () => {
    const response = await request(app)
      .patch(`/api/v1/companies/${companyA.company.id}`)
      .set(auth(adminAToken))
      .send({ name: 'Alpha Renamed' });

    expect(response.status).toBe(200);
    expect(response.body.data.company.name).toBe('Alpha Renamed');
  });

  it('returns 404 when updating another company, and changes nothing', async () => {
    const response = await request(app)
      .patch(`/api/v1/companies/${companyB.company.id}`)
      .set(auth(adminAToken))
      .send({ name: 'Hijacked' });

    expect(response.status).toBe(404);

    const untouched = await prisma.company.findUnique({ where: { id: companyB.company.id } });
    expect(untouched.name).toBe(companyB.company.name);
  });

  it('rejects an invalid GSTIN', async () => {
    const response = await request(app)
      .patch(`/api/v1/companies/${companyA.company.id}`)
      .set(auth(adminAToken))
      .send({ gstin: 'NOT-A-GSTIN' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.gstin');
  });

  it('returns 403 for staff', async () => {
    const response = await request(app)
      .patch(`/api/v1/companies/${companyA.company.id}`)
      .set(auth(staffAToken))
      .send({ name: 'Staff Rename' });

    expect(response.status).toBe(403);
  });
});

describe('POST /api/v1/companies', () => {
  it('creates a company together with its first admin', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(auth(adminAToken))
      .send({
        name: 'Gamma Pharma',
        gstin: '29AAGCB1286Q1ZP',
        admin: { email: 'admin@gamma.test', password: 'password123', name: 'Gamma Admin' },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.company.name).toBe('Gamma Pharma');
    expect(response.body.data.admin.role).toBe('ADMIN');
    expect(response.body.data.admin.companyId).toBe(response.body.data.company.id);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('password123');
  });

  it('lets the new admin log in and see only their own company users', async () => {
    const token = await login(app, 'admin@gamma.test', 'password123');

    const response = await request(app).get('/api/v1/users').set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe('admin@gamma.test');
  });

  it('rejects a duplicate company name', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(auth(adminAToken))
      .send({
        name: 'Gamma Pharma',
        admin: { email: 'other@gamma.test', password: 'password123', name: 'Other Admin' },
      });

    expect(response.status).toBe(409);
  });

  it('rejects a duplicate GSTIN', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(auth(adminAToken))
      .send({
        name: 'Delta Pharma',
        gstin: '29AAGCB1286Q1ZP',
        admin: { email: 'admin@delta.test', password: 'password123', name: 'Delta Admin' },
      });

    expect(response.status).toBe(409);
  });

  it('rejects a duplicate admin email and creates no company', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(auth(adminAToken))
      .send({
        name: 'Epsilon Pharma',
        admin: { email: companyA.admin.email, password: 'password123', name: 'Epsilon Admin' },
      });

    expect(response.status).toBe(409);
    expect(await prisma.company.findFirst({ where: { name: 'Epsilon Pharma' } })).toBeNull();
  });

  it('rejects missing admin details', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(auth(adminAToken))
      .send({ name: 'No Admin Pharma' });

    expect(response.status).toBe(400);
    expect(await prisma.company.findFirst({ where: { name: 'No Admin Pharma' } })).toBeNull();
  });

  it('returns 403 for staff', async () => {
    const response = await request(app)
      .post('/api/v1/companies')
      .set(auth(staffAToken))
      .send({
        name: 'Staff Pharma',
        admin: { email: 'admin@staffco.test', password: 'password123', name: 'Staff Co Admin' },
      });

    expect(response.status).toBe(403);
  });
});
