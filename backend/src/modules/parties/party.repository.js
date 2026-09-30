import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

// All Prisma access for parties. Every method is company scoped: a party id on
// its own never finds anything.

const ROLE_FIELDS = {
  id: true,
  name: true,
  isActive: true,
  openingBalance: true,
  creditLimit: true,
  creditDays: true,
  gstRegistrationType: true,
};

export const PARTY_FIELDS = {
  id: true,
  companyId: true,
  name: true,
  contactPerson: true,
  phone: true,
  alternatePhone: true,
  email: true,
  address: true,
  city: true,
  stateCode: true,
  pincode: true,
  country: true,
  gstin: true,
  pan: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: ROLE_FIELDS },
  supplier: { select: ROLE_FIELDS },
};

export function findByIdAndCompany(id, companyId, client = prisma) {
  return client.party.findFirst({ where: { id, companyId }, select: PARTY_FIELDS });
}

/**
 * Locks one party row for the rest of the transaction.
 *
 * Two people editing the same party at once would otherwise each copy their
 * own name onto the customer and supplier rows, and the party could end up
 * called one thing on the sales side and another on the purchase side. With the
 * lock the second edit waits and then applies cleanly on top of the first.
 *
 * @returns {Promise<boolean>} false when no such party exists in this company
 */
export async function lockByIdAndCompany(tx, id, companyId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "parties" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`,
  );
  return rows.length > 0;
}

function relationshipWhere(relationship) {
  switch (relationship) {
    case 'CUSTOMER':
      return { customer: { isNot: null } };
    case 'SUPPLIER':
      return { supplier: { isNot: null } };
    case 'BOTH':
      return { customer: { isNot: null }, supplier: { isNot: null } };
    default:
      return {};
  }
}

export async function findManyByCompany(companyId, { skip, take, search, relationship, isActive }) {
  const where = { companyId, ...relationshipWhere(relationship) };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { alternatePhone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { gstin: { contains: search, mode: 'insensitive' } },
      { contactPerson: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.party.findMany({ where, select: PARTY_FIELDS, orderBy: { name: 'asc' }, skip, take }),
    prisma.party.count({ where }),
  ]);

  return { items, total };
}

/** How many parties of each kind. "Customers" includes parties that are both. */
export async function countByRelationship(companyId) {
  const [total, customers, suppliers, both] = await Promise.all([
    prisma.party.count({ where: { companyId } }),
    prisma.party.count({ where: { companyId, ...relationshipWhere('CUSTOMER') } }),
    prisma.party.count({ where: { companyId, ...relationshipWhere('SUPPLIER') } }),
    prisma.party.count({ where: { companyId, ...relationshipWhere('BOTH') } }),
  ]);
  return { total, customers, suppliers, both };
}

/** Just enough of every party to look for duplicates. One query. */
export function findAllForMatching(companyId) {
  return prisma.party.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      phone: true,
      alternatePhone: true,
      email: true,
      gstin: true,
      isActive: true,
      customer: { select: { id: true } },
      supplier: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 5000,
  });
}

export function create(data, client = prisma) {
  return client.party.create({ data, select: PARTY_FIELDS });
}

export function updateById(id, data, client = prisma) {
  return client.party.update({ where: { id }, data, select: PARTY_FIELDS });
}

export function deleteById(id, client = prisma) {
  return client.party.delete({ where: { id } });
}

// --- the customer and supplier rows a party owns ----------------------------

export function findRoleByNameAndCompany(role, name, companyId, client = prisma) {
  return client[role].findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, partyId: true },
  });
}

export function findRoleByIdAndCompany(role, id, companyId, client = prisma) {
  return client[role].findFirst({
    where: { id, companyId },
    select: { id: true, name: true, partyId: true },
  });
}

export function createRole(role, data, client = prisma) {
  return client[role].create({ data, select: { id: true } });
}

export function updateRole(role, id, companyId, data, client = prisma) {
  return client[role].updateMany({ where: { id, companyId }, data });
}

// --- activity, read from the sub-ledgers that own it -------------------------

/** The most recent ledger date per customer. */
export function lastCustomerActivity(companyId, customerIds) {
  if (customerIds.length === 0) return [];
  return prisma.customerLedgerEntry.groupBy({
    by: ['customerId'],
    where: { companyId, customerId: { in: customerIds } },
    _max: { entryDate: true },
  });
}

/** The most recent ledger date per supplier. */
export function lastSupplierActivity(companyId, supplierIds) {
  if (supplierIds.length === 0) return [];
  return prisma.supplierLedgerEntry.groupBy({
    by: ['supplierId'],
    where: { companyId, supplierId: { in: supplierIds } },
    _max: { entryDate: true },
  });
}

/**
 * Overdue on one customer: unpaid invoices whose due date has passed. The same
 * rule the dashboard and credit book use - no due date, never overdue.
 */
export function overdueForCustomer(companyId, customerId, asOfDate) {
  return prisma.customerReceivable.aggregate({
    where: { companyId, customerId, outstandingAmount: { gt: 0 }, dueDate: { not: null, lt: asOfDate } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

/** The supplier-side mirror. */
export function overdueForSupplier(companyId, supplierId, asOfDate) {
  return prisma.supplierPayable.aggregate({
    where: { companyId, supplierId, outstandingAmount: { gt: 0 }, dueDate: { not: null, lt: asOfDate } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}
