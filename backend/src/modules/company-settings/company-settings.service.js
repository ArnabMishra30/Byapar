import * as companySettingsRepository from './company-settings.repository.js';

// Business rules for company settings. Exactly one row per company, created
// automatically when the company is created (see company.service.js).

export function toPublicSettings(settings) {
  return {
    currency: settings.currency,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
    invoicePrefix: settings.invoicePrefix,
    purchasePrefix: settings.purchasePrefix,
    financialYearStartMonth: settings.financialYearStartMonth,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

/**
 * Companies created before this feature existed have no settings row, so read
 * creates one with the schema defaults instead of returning 404. That keeps the
 * endpoint total: a company always has settings.
 */
export async function getForCompany(currentUser) {
  const existing = await companySettingsRepository.findByCompany(currentUser.companyId);
  if (existing) return toPublicSettings(existing);

  const created = await companySettingsRepository.create(currentUser.companyId);
  return toPublicSettings(created);
}

export async function update(currentUser, input) {
  // Ensures the row exists before updating it.
  await getForCompany(currentUser);

  const settings = await companySettingsRepository.updateByCompany(currentUser.companyId, input);
  return toPublicSettings(settings);
}
