import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { prisma, resetDatabase, createCompany } from '../helpers/db.js';

// THE MIGRATION'S BACKFILL, run for real against rows that predate parties.
//
// Customers and suppliers created before the party master have no partyId. The
// backfill must give each one its own party, be safe to run twice, and never
// decide on its own that a customer and a supplier are the same business.

const migration = readFileSync(
  new URL('../../prisma/migrations/20260930090000_party_master/migration.sql', import.meta.url),
  'utf8',
);
const backfill = migration.slice(migration.indexOf('-- BACKFILL'));

async function runBackfill() {
  // One statement at a time: Prisma's raw executor takes a single statement.
  const statements = backfill
    .split(/;\s*\n/)
    .map((sql) => sql.replace(/--[^\n]*\n/g, '').trim())
    .filter(Boolean);
  for (const sql of statements) await prisma.$executeRawUnsafe(sql);
}

let company;
let other;

beforeAll(async () => {
  await resetDatabase();
  company = await createCompany({ name: 'Backfill Co' });
  other = await createCompany({ name: 'Other Co' });

  // Legacy rows, written directly as an old version of the app would have.
  await prisma.customer.create({
    data: { companyId: company.id, name: 'XYZ Traders', phone: '9876543210', gstin: '19ABCDE1234F1Z5' },
  });
  await prisma.supplier.create({
    data: { companyId: company.id, name: 'XYZ Traders', phone: '9876543210', gstin: '19ABCDE1234F1Z5' },
  });
  await prisma.customer.create({ data: { companyId: other.id, name: 'Elsewhere' } });
});

describe('party backfill', () => {
  it('gives every legacy customer and supplier its own party, in its own company', async () => {
    await runBackfill();

    const customers = await prisma.customer.findMany({ include: { party: true } });
    const suppliers = await prisma.supplier.findMany({ include: { party: true } });

    for (const row of [...customers, ...suppliers]) {
      expect(row.partyId).not.toBeNull();
      expect(row.party.companyId).toBe(row.companyId);
      expect(row.party.name).toBe(row.name);
    }
  });

  it('does not merge a look-alike customer and supplier', async () => {
    const customer = await prisma.customer.findFirst({ where: { companyId: company.id, name: 'XYZ Traders' } });
    const supplier = await prisma.supplier.findFirst({ where: { companyId: company.id, name: 'XYZ Traders' } });
    expect(customer.partyId).not.toBe(supplier.partyId);
  });

  it('is safe to run again: nothing is duplicated or reassigned', async () => {
    const before = await prisma.party.count();
    const links = await prisma.customer.findMany({ select: { id: true, partyId: true }, orderBy: { id: 'asc' } });

    await runBackfill();

    expect(await prisma.party.count()).toBe(before);
    expect(
      await prisma.customer.findMany({ select: { id: true, partyId: true }, orderBy: { id: 'asc' } }),
    ).toEqual(links);
  });
});
