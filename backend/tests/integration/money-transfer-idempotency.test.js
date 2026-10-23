import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// Regression coverage for QA finding M2.
//
// A money transfer used a fresh random sourceId on every call, so a retry or a
// double-click created a SECOND transfer and the per-account balances moved
// twice. A client now sends an `idempotencyKey`; the same key must resolve to
// the same transfer. Two genuinely-distinct transfers (different keys, even
// with identical amounts) must still both go through.

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let company;
let owner;
let drawerId;
let sbiId;

beforeAll(async () => {
  await resetDatabase();
  company = await createCompanyWithUsers('xfer-idem');
  owner = await login(app, company.admin.email, company.adminPassword);

  const drawer = await request(app)
    .post('/api/v1/money-accounts')
    .set(auth(owner))
    .send({ name: 'Idem Drawer', kind: 'CASH', openingBalance: '100000' });
  const sbi = await request(app)
    .post('/api/v1/money-accounts')
    .set(auth(owner))
    .send({ name: 'Idem SBI', kind: 'BANK' });

  drawerId = drawer.body.data.account.id;
  sbiId = sbi.body.data.account.id;
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

const transfer = (body) =>
  request(app).post('/api/v1/money-accounts/transfers').set(auth(owner)).send(body);

const transferCount = () =>
  prisma.journalEntry.count({
    where: { companyId: company.company.id, sourceType: 'MONEY_TRANSFER' },
  });

const body = (overrides = {}) => ({
  fromAccountId: drawerId,
  toAccountId: sbiId,
  amount: '500',
  date: '2026-10-10',
  ...overrides,
});

describe('M2 — money transfer idempotency', () => {
  it('records a transfer once no matter how many times the same key is submitted', async () => {
    const idempotencyKey = randomUUID();
    const payload = body({ amount: '500', idempotencyKey });

    const first = await transfer(payload);
    expect(first.status).toBe(201);

    const before = await transferCount();

    // A retry / double-click with the SAME key.
    const second = await transfer(payload);
    expect(second.status).toBe(201);
    expect(second.body.data.transfer.id).toBe(first.body.data.transfer.id);

    // No second transfer was written.
    expect(await transferCount()).toBe(before);
  });

  it('creates exactly one transfer under concurrent duplicate submissions', async () => {
    const idempotencyKey = randomUUID();
    const payload = body({ amount: '300', idempotencyKey });

    const before = await transferCount();

    const results = await Promise.all([transfer(payload), transfer(payload), transfer(payload)]);
    results.forEach((r) => expect(r.status).toBe(201));

    // All three responses point at the one transfer that was actually written.
    const ids = new Set(results.map((r) => r.body.data.transfer.id));
    expect(ids.size).toBe(1);
    expect(await transferCount()).toBe(before + 1);
  });

  it('lets two genuinely-distinct transfers through even when their amounts are identical', async () => {
    const before = await transferCount();

    const a = await transfer(body({ amount: '150', idempotencyKey: randomUUID() }));
    const b = await transfer(body({ amount: '150', idempotencyKey: randomUUID() }));

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.transfer.id).not.toBe(b.body.data.transfer.id);
    expect(await transferCount()).toBe(before + 2);
  });

  it('preserves legacy behaviour when no key is sent (each submit is its own transfer)', async () => {
    const before = await transferCount();

    const a = await transfer(body({ amount: '77' }));
    const b = await transfer(body({ amount: '77' }));

    expect(a.body.data.transfer.id).not.toBe(b.body.data.transfer.id);
    expect(await transferCount()).toBe(before + 2);
  });

  it('rejects a malformed idempotency key', async () => {
    const res = await transfer(body({ amount: '10', idempotencyKey: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });
});
