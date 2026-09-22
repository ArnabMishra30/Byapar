import { prisma } from '../../config/prisma.js';

// All Prisma access for company settings. Exactly one row per company.

const FIELDS = {
  id: true,
  companyId: true,
  currency: true,
  timezone: true,
  dateFormat: true,
  invoicePrefix: true,
  purchasePrefix: true,
  financialYearStartMonth: true,
  createdAt: true,
  updatedAt: true,
};

export function findByCompany(companyId, client = prisma) {
  return client.companySettings.findUnique({ where: { companyId }, select: FIELDS });
}

export function create(companyId, data = {}, client = prisma) {
  return client.companySettings.create({ data: { companyId, ...data }, select: FIELDS });
}

export function updateByCompany(companyId, data) {
  return prisma.companySettings.update({ where: { companyId }, data, select: FIELDS });
}
