import * as unitRepository from '../units/unit.repository.js';
import * as taxRepository from '../taxes/tax.repository.js';
import * as companySettingsRepository from '../company-settings/company-settings.repository.js';
import { initializeSystemAccounts } from '../accounting/account.service.js';

// What a brand new company starts with, so a user is not forced to type in eight
// units and five GST slabs before creating their first product.
//
// These are per-company rows, never global shared records - a company can rename
// or deactivate any of them without affecting anyone else.

export const DEFAULT_UNITS = [
  { name: 'Piece', shortCode: 'PCS' },
  { name: 'Kilogram', shortCode: 'KG' },
  { name: 'Gram', shortCode: 'G' },
  { name: 'Litre', shortCode: 'L' },
  { name: 'Millilitre', shortCode: 'ML' },
  { name: 'Box', shortCode: 'BOX' },
  { name: 'Pack', shortCode: 'PACK' },
  { name: 'Dozen', shortCode: 'DOZ' },
];

export const DEFAULT_TAXES = [
  { name: 'GST 0%', rate: '0.00' },
  { name: 'GST 5%', rate: '5.00' },
  { name: 'GST 12%', rate: '12.00' },
  { name: 'GST 18%', rate: '18.00' },
  { name: 'GST 28%', rate: '28.00' },
];

/**
 * Gives a company its settings row and default master data.
 *
 * Safe to run more than once: settings are only created when missing, and units
 * and taxes are inserted with skipDuplicates against the (companyId, name)
 * unique constraints. Re-running never overwrites anything a user has edited.
 *
 * @param {string} companyId
 * @param {import('@prisma/client').PrismaClient} [client] pass a transaction client to join it
 */
export async function initializeCompanyDefaults(companyId, client) {
  const existingSettings = await companySettingsRepository.findByCompany(companyId, client);
  if (!existingSettings) {
    await companySettingsRepository.create(companyId, {}, client);
  }

  await unitRepository.createMany(
    DEFAULT_UNITS.map((unit) => ({ ...unit, companyId })),
    client,
  );

  await taxRepository.createMany(
    DEFAULT_TAXES.map((tax) => ({ ...tax, companyId })),
    client,
  );

  // The chart of accounts. Also inserted with skipDuplicates, so re-running this
  // repairs a company that predates the general ledger without touching an
  // account the user has renamed.
  await initializeSystemAccounts(companyId, client);
}
