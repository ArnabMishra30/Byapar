import { describe, it, expect, beforeAll } from 'vitest';
import { prisma, resetDatabase, createCompany } from '../helpers/db.js';
import {
  initializeCompanyDefaults,
  DEFAULT_WAREHOUSES,
  DEFAULT_UNITS,
} from '../../src/modules/companies/company-defaults.js';
import { ensureDefaults } from '../../prisma/ensure-defaults.js';

// WHAT A SHOP STARTS WITH.
//
// A warehouse is not a nicety: every purchase, sale and stock movement must name
// one, so a company without a warehouse cannot record anything at all. These
// tests pin down that one is always there, that repairing an older company adds
// the missing one, and - the part that matters most - that repairing never
// disturbs what a shop has already set up itself.

beforeAll(async () => {
  await resetDatabase();
});

describe('initializeCompanyDefaults', () => {
  it('gives a new company somewhere to keep stock', async () => {
    const company = await createCompany({ name: 'Fresh Shop' });
    await initializeCompanyDefaults(company.id);

    const warehouses = await prisma.warehouse.findMany({ where: { companyId: company.id } });

    expect(warehouses).toHaveLength(DEFAULT_WAREHOUSES.length);
    expect(warehouses[0].name).toBe('Main Store');
    expect(warehouses[0].isActive).toBe(true);
  });

  it('adds nothing a second time', async () => {
    const company = await createCompany({ name: 'Twice Shop' });
    await initializeCompanyDefaults(company.id);
    await initializeCompanyDefaults(company.id);

    expect(await prisma.warehouse.count({ where: { companyId: company.id } })).toBe(1);
    expect(await prisma.unit.count({ where: { companyId: company.id } })).toBe(DEFAULT_UNITS.length);
  });
});

describe('ensureDefaults', () => {
  it('repairs a company created before the default existed', async () => {
    const old = await createCompany({ name: 'Old Shop' });
    // No defaults at all: exactly the state of a company from an earlier version.
    expect(await prisma.warehouse.count({ where: { companyId: old.id } })).toBe(0);

    await ensureDefaults();

    const warehouses = await prisma.warehouse.findMany({ where: { companyId: old.id } });
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].name).toBe('Main Store');
  });

  it('leaves a shop that renamed its store, or added others, exactly as it is', async () => {
    const company = await createCompany({ name: 'Two Godown Shop' });
    await initializeCompanyDefaults(company.id);

    await prisma.warehouse.update({
      where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
      data: { name: 'Front Shop' },
    });
    await prisma.warehouse.create({
      data: { companyId: company.id, name: 'Back Godown', code: 'BACK' },
    });

    await ensureDefaults();

    const warehouses = await prisma.warehouse.findMany({
      where: { companyId: company.id },
      orderBy: { code: 'asc' },
    });

    // Still two, still named what the shop called them.
    expect(warehouses.map((warehouse) => warehouse.name)).toEqual(['Back Godown', 'Front Shop']);
  });
});
