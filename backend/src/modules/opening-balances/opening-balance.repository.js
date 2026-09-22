import { prisma } from '../../config/prisma.js';

// All Prisma access for opening balances.
//
// There is NO opening-balance table, and there should not be one. The opening
// journal entry IS the initialization record: it carries the as-of date, who
// created it, when, and the totals - and the existing
// @@unique([companyId, sourceType, sourceId]) on JournalEntry, with the
// company's own id as sourceId, makes a second one impossible.
//
// Everything read back here is read from where it actually lives: the GL, the
// two sub-ledgers, the inventory module. Nothing is stored twice.

const OPENING_SOURCE = 'OPENING_BALANCE';

/** The one opening journal entry a company may have. */
export function findOpeningEntry(companyId, client = prisma) {
  return client.journalEntry.findFirst({
    where: { companyId, sourceType: OPENING_SOURCE, sourceId: companyId },
    select: {
      id: true,
      journalNumber: true,
      entryDate: true,
      description: true,
      totalDebit: true,
      totalCredit: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });
}

export function findOpeningJournalLines(companyId, journalEntryId) {
  return prisma.journalLine.findMany({
    where: { companyId, journalEntryId },
    select: {
      id: true,
      description: true,
      debit: true,
      credit: true,
      account: { select: { id: true, code: true, name: true, type: true } },
    },
    orderBy: { lineNumber: 'asc' },
  });
}

/** The opening entries in the customer sub-ledger, one per customer. */
export function findOpeningCustomerEntries(companyId) {
  return prisma.customerLedgerEntry.findMany({
    where: { companyId, entryType: 'OPENING_BALANCE' },
    select: {
      id: true,
      debit: true,
      credit: true,
      entryDate: true,
      description: true,
      receivableId: true,
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export function findOpeningSupplierEntries(companyId) {
  return prisma.supplierLedgerEntry.findMany({
    where: { companyId, entryType: 'OPENING_BALANCE' },
    select: {
      id: true,
      debit: true,
      credit: true,
      entryDate: true,
      description: true,
      payableId: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** The stock movements the initialization wrote, keyed by the company id. */
export function findOpeningStockMovements(companyId) {
  return prisma.stockMovement.findMany({
    where: { companyId, type: 'OPENING_STOCK', referenceId: companyId },
    select: {
      id: true,
      quantity: true,
      unitCost: true,
      totalCost: true,
      createdAt: true,
      product: { select: { id: true, name: true, sku: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

// --- company-scoped reference lookups --------------------------------------
//
// Each takes a list of ids and returns only those belonging to THIS company, so
// an id from another tenant simply does not come back and the service reports it
// exactly like one that does not exist.

export function findCustomersByIds(companyId, ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.customer.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, isActive: true },
  });
}

export function findSuppliersByIds(companyId, ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.supplier.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, isActive: true },
  });
}

export function findProductsByIds(companyId, ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.product.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, sku: true, isActive: true },
  });
}

export function findWarehousesByIds(companyId, ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.warehouse.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, isActive: true },
  });
}

export function findAccountsByIds(companyId, ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.account.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, code: true, name: true, type: true, isActive: true },
  });
}

export { OPENING_SOURCE };
