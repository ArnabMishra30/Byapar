import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

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

describe('GET /api/v1/company-settings', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/company-settings');
    expect(response.status).toBe(401);
  });

  it('returns defaults for a company that has no settings row yet', async () => {
    // These companies were created directly in the database, without settings.
    const response = await request(app).get('/api/v1/company-settings').set(auth(adminAToken));

    expect(response.status).toBe(200);
    expect(response.body.data.settings).toMatchObject({
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      invoicePrefix: 'INV',
      purchasePrefix: 'PUR',
      financialYearStartMonth: 4,
    });
  });

  it('creates exactly one settings row, even when read repeatedly', async () => {
    await request(app).get('/api/v1/company-settings').set(auth(adminAToken));
    await request(app).get('/api/v1/company-settings').set(auth(adminAToken));

    const count = await prisma.companySettings.count({ where: { companyId: companyA.company.id } });
    expect(count).toBe(1);
  });

  it('lets STAFF read the settings', async () => {
    const response = await request(app).get('/api/v1/company-settings').set(auth(staffAToken));
    expect(response.status).toBe(200);
  });

  it('does not expose companyId or the internal id', async () => {
    const response = await request(app).get('/api/v1/company-settings').set(auth(adminAToken));

    expect(response.body.data.settings.companyId).toBeUndefined();
    expect(response.body.data.settings.id).toBeUndefined();
  });
});

describe('PATCH /api/v1/company-settings', () => {
  it('lets an ADMIN update settings', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ currency: 'usd', invoicePrefix: 'inv-a', financialYearStartMonth: 1 });

    expect(response.status).toBe(200);
    expect(response.body.data.settings.currency).toBe('USD');
    expect(response.body.data.settings.invoicePrefix).toBe('INV-A');
    expect(response.body.data.settings.financialYearStartMonth).toBe(1);
  });

  it('forbids STAFF from updating settings', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(staffAToken))
      .send({ currency: 'EUR' });

    expect(response.status).toBe(403);
  });

  it('requires authentication', async () => {
    const response = await request(app).patch('/api/v1/company-settings').send({ currency: 'EUR' });
    expect(response.status).toBe(401);
  });

  it('rejects an empty update', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({});

    expect(response.status).toBe(400);
  });

  it('rejects an invalid currency code', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ currency: 'RUPEES' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.currency');
  });

  it('rejects an invalid timezone', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ timezone: 'Mars/Olympus' });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.timezone');
  });

  it('accepts a valid non-default timezone', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ timezone: 'America/New_York' });

    expect(response.status).toBe(200);
    expect(response.body.data.settings.timezone).toBe('America/New_York');
  });

  it('rejects an unsupported date format', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ dateFormat: 'DD.MM.YY' });

    expect(response.status).toBe(400);
  });

  it('rejects a financial year month outside 1-12', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ financialYearStartMonth: 13 });

    expect(response.status).toBe(400);
  });

  it('rejects a prefix with invalid characters', async () => {
    const response = await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ invoicePrefix: 'INV/2026' });

    expect(response.status).toBe(400);
  });
});

describe('company settings tenant isolation', () => {
  it('keeps each company settings separate', async () => {
    await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminBToken))
      .send({ currency: 'GBP', invoicePrefix: 'BILL' });

    const settingsA = await request(app).get('/api/v1/company-settings').set(auth(adminAToken));
    const settingsB = await request(app).get('/api/v1/company-settings').set(auth(adminBToken));

    expect(settingsB.body.data.settings.currency).toBe('GBP');
    expect(settingsB.body.data.settings.invoicePrefix).toBe('BILL');

    // Company A is untouched by company B's update.
    expect(settingsA.body.data.settings.currency).toBe('USD');
    expect(settingsA.body.data.settings.invoicePrefix).toBe('INV-A');
  });

  it('has no endpoint that accepts a companyId', async () => {
    await request(app)
      .patch('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ currency: 'INR', companyId: companyB.company.id });

    const settingsB = await request(app).get('/api/v1/company-settings').set(auth(adminBToken));

    // Company B still has its own currency: the injected companyId was ignored.
    expect(settingsB.body.data.settings.currency).toBe('GBP');
  });

  it('does not expose a POST endpoint', async () => {
    const response = await request(app)
      .post('/api/v1/company-settings')
      .set(auth(adminAToken))
      .send({ currency: 'INR' });

    expect(response.status).toBe(404);
  });
});

describe('company creation initializes defaults', () => {
  it('creates settings, default units and default taxes with a new company', async () => {
    const created = await request(app)
      .post('/api/v1/companies')
      .set(auth(adminAToken))
      .send({
        name: 'Initialized Pharma',
        admin: { email: 'admin@initialized.test', password: 'password123', name: 'Init Admin' },
      });

    expect(created.status).toBe(201);

    const token = await login(app, 'admin@initialized.test', 'password123');

    const settings = await request(app).get('/api/v1/company-settings').set(auth(token));
    const units = await request(app).get('/api/v1/units?limit=100').set(auth(token));
    const taxes = await request(app).get('/api/v1/taxes?limit=100').set(auth(token));

    expect(settings.body.data.settings.currency).toBe('INR');
    expect(units.body.pagination.total).toBe(8);
    expect(taxes.body.pagination.total).toBe(5);
    expect(units.body.data.map((u) => u.shortCode)).toContain('PCS');
    expect(taxes.body.data.map((t) => t.name)).toContain('GST 18%');
  });

  it('gives the new company its own copies, not shared records', async () => {
    const token = await login(app, 'admin@initialized.test', 'password123');

    const unitsNew = await request(app).get('/api/v1/units?limit=100').set(auth(token));
    const unitsA = await request(app).get('/api/v1/units?limit=100').set(auth(adminAToken));

    const newIds = unitsNew.body.data.map((u) => u.id);
    const aIds = unitsA.body.data.map((u) => u.id);

    expect(newIds.some((id) => aIds.includes(id))).toBe(false);
  });
});
