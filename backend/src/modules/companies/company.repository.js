import { prisma } from '../../config/prisma.js';

// All database access for companies. Services never call Prisma directly.

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  gstin: true,
  legalName: true,
  stateCode: true,
  registeredAddress: true,
  gstRegistrationType: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Just the tax-relevant fields, for the hot path: every posting resolves the
 * company's GST profile, and it has no business loading timestamps to do it.
 */
const GST_PROFILE_FIELDS = {
  id: true,
  name: true,
  legalName: true,
  gstin: true,
  stateCode: true,
  registeredAddress: true,
  gstRegistrationType: true,
};

export function findGstProfile(companyId, client = prisma) {
  return client.company.findUnique({ where: { id: companyId }, select: GST_PROFILE_FIELDS });
}

export function findById(id, client = prisma) {
  return client.company.findUnique({ where: { id }, select: PUBLIC_FIELDS });
}

export function findByName(name, client = prisma) {
  return client.company.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: PUBLIC_FIELDS,
  });
}

export function findByGstin(gstin, client = prisma) {
  return client.company.findUnique({ where: { gstin }, select: PUBLIC_FIELDS });
}

/** @param {{ name: string, gstin?: string|null }} data */
export function create(data, client = prisma) {
  return client.company.create({ data, select: PUBLIC_FIELDS });
}

export function update(id, data, client = prisma) {
  return client.company.update({ where: { id }, data, select: PUBLIC_FIELDS });
}

export { PUBLIC_FIELDS, GST_PROFILE_FIELDS };
