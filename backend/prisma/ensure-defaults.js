import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import { initializeCompanyDefaults } from '../src/modules/companies/company-defaults.js';

/**
 * Gives every existing company the defaults a new one gets.
 *
 * WHY THIS EXISTS. Defaults are created when a company is created, so a shop
 * that predates a new default - the Main Store warehouse, the chart of accounts
 * before it existed - is left without it, and discovers the gap as an empty
 * dropdown it cannot fill. This closes that gap.
 *
 * SAFE TO RUN, INCLUDING AGAINST PRODUCTION, AND SAFE TO RUN AGAIN. It only
 * inserts what is missing: every write underneath is either skipDuplicates
 * against a unique constraint or a create-if-absent. Nothing is renamed,
 * nothing is deactivated, and nothing a shop has edited is overwritten.
 *
 * Run with: npm run defaults:ensure       (your local database)
 *           npm run defaults:ensure:prod  (the database in .env.production)
 */
export async function ensureDefaults() {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const repaired = [];

  for (const company of companies) {
    const before = await prisma.warehouse.count({ where: { companyId: company.id } });
    await initializeCompanyDefaults(company.id);
    const after = await prisma.warehouse.count({ where: { companyId: company.id } });

    repaired.push({ name: company.name, warehousesAdded: after - before });
  }

  return repaired;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('ensure-defaults.js');

if (isDirectRun) {
  ensureDefaults()
    .then((repaired) => {
      if (repaired.length === 0) {
        console.log('No companies found.');
        return;
      }
      for (const company of repaired) {
        const added = company.warehousesAdded > 0 ? `${company.warehousesAdded} store added` : 'already complete';
        console.log(`  ${company.name}: ${added}`);
      }
      console.log(`\nChecked ${repaired.length} compan${repaired.length === 1 ? 'y' : 'ies'}.`);
    })
    .catch((error) => {
      console.error('Could not apply defaults:', error.message);
      process.exitCode = 1;
    })
    .finally(disconnectPrisma);
}
