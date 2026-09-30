import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString, toDecimal } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as partyRepository from './party.repository.js';
import * as creditRepository from '../credit/credit.repository.js';
import * as companySettingsRepository from '../company-settings/company-settings.repository.js';
import * as customerReceivableService from '../customer-receivables/customer-receivable.service.js';
import * as supplierPayableService from '../supplier-payables/supplier-payable.service.js';
import * as statementService from '../credit/statement.service.js';
import { todayIn, toBusinessDate, toDateString } from '../reports/period.js';
import { findPossibleMatches } from './party-matching.js';

// THE PARTY MASTER.
//
// A party is the real person or business. It is MASTER DATA and nothing else:
//
//   Party
//     ├── Customer  (sales, receivables, customer ledger, money received)
//     └── Supplier  (purchases, payables, supplier ledger, money paid)
//
// A party that both buys from us and sells to us has one of each, and the two
// balances stay apart. Nothing here nets a receivable against a payable, and
// nothing here writes a journal entry: creating, editing, linking or switching
// off a party is not an accounting event. Every balance shown below is read
// from the sub-ledger that already owns it.
//
// The customer and supplier rows keep their own ids, so every posted document,
// ledger line and payment allocation still points exactly where it did.

/** Copied from the party onto its customer and supplier rows. */
const ROLE_COMMON_KEYS = ['name', 'phone', 'email', 'address', 'gstin', 'stateCode'];

/** Everything a party record holds besides its identity and status. */
const PARTY_KEYS = [
  'name',
  'contactPerson',
  'phone',
  'alternatePhone',
  'email',
  'address',
  'city',
  'stateCode',
  'pincode',
  'country',
  'gstin',
  'pan',
  'notes',
];

const ROLE = {
  CUSTOMER: 'customer',
  SUPPLIER: 'supplier',
};

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

const money = (value) => toMoneyString(value ?? 0, 2);

export function relationshipOf(party) {
  if (party.customer && party.supplier) return 'BOTH';
  if (party.customer) return 'CUSTOMER';
  if (party.supplier) return 'SUPPLIER';
  return 'NONE';
}

export function toPublicParty(party, extras = {}) {
  return {
    id: party.id,
    name: party.name,
    contactPerson: party.contactPerson ?? null,
    phone: party.phone ?? null,
    alternatePhone: party.alternatePhone ?? null,
    email: party.email ?? null,
    address: party.address ?? null,
    city: party.city ?? null,
    stateCode: party.stateCode ?? null,
    pincode: party.pincode ?? null,
    country: party.country ?? null,
    gstin: party.gstin ?? null,
    pan: party.pan ?? null,
    notes: party.notes ?? null,
    isActive: party.isActive,
    relationship: relationshipOf(party),
    isCustomer: Boolean(party.customer),
    isSupplier: Boolean(party.supplier),
    customerId: party.customer?.id ?? null,
    supplierId: party.supplier?.id ?? null,
    createdAt: party.createdAt,
    updatedAt: party.updatedAt,
    ...extras,
  };
}

function toPublicTerms(role) {
  return {
    id: role.id,
    isActive: role.isActive,
    openingBalance: money(role.openingBalance),
    creditLimit: money(role.creditLimit),
    // Zero means unlimited, as it does everywhere else in the app.
    isUnlimited: toDecimal(role.creditLimit ?? 0).isZero(),
    creditDays: role.creditDays ?? null,
    gstRegistrationType: role.gstRegistrationType,
  };
}

async function businessToday(companyId) {
  const settings = await companySettingsRepository.findByCompany(companyId);
  return toBusinessDate(todayIn(settings?.timezone ?? 'UTC'));
}

/** The customer or supplier row a party would get, built from the party. */
function roleRowData(companyId, party, terms = {}) {
  return {
    companyId,
    partyId: party.id,
    name: party.name,
    phone: party.phone ?? null,
    email: party.email ?? null,
    address: party.address ?? null,
    gstin: party.gstin ?? null,
    stateCode: party.stateCode ?? null,
    // A party with a GSTIN is a registered business unless the shop says
    // otherwise; one without is unregistered. Either can be changed later.
    gstRegistrationType: terms.gstRegistrationType ?? (party.gstin ? 'REGULAR' : 'UNREGISTERED'),
    openingBalance: terms.openingBalance ?? '0',
    creditLimit: terms.creditLimit ?? '0',
    creditDays: terms.creditDays ?? null,
    isActive: party.isActive ?? true,
  };
}

/**
 * Customer and supplier names are unique per company - every picker, report and
 * CSV import relies on that. A party's name lands on both tables, so it has to
 * be free on each side it uses.
 */
async function assertRoleNameFree(client, role, name, companyId, ownRoleId = null) {
  const existing = await partyRepository.findRoleByNameAndCompany(role, name, companyId, client);
  if (existing && existing.id !== ownRoleId) {
    throw ApiError.business(
      409,
      role === 'customer' ? 'CUSTOMER_NAME_TAKEN' : 'SUPPLIER_NAME_TAKEN',
      `Another ${role} is already called "${name}". Use a different name, or link that ${role} to this party instead.`,
    );
  }
}

async function requireParty(client, id, companyId) {
  const party = await partyRepository.findByIdAndCompany(id, companyId, client);
  // Another company's party is reported exactly like one that does not exist.
  if (!party) throw ApiError.business(404, 'PARTY_NOT_FOUND', 'Party not found');
  return party;
}

async function lockParty(tx, id, companyId) {
  const found = await partyRepository.lockByIdAndCompany(tx, id, companyId);
  if (!found) throw ApiError.business(404, 'PARTY_NOT_FOUND', 'Party not found');
  return requireParty(tx, id, companyId);
}

// --- reads -------------------------------------------------------------------

export async function list(currentUser, query) {
  const { companyId } = currentUser;
  const { page, limit, search, isActive, relationship } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await partyRepository.findManyByCompany(companyId, {
    skip,
    take,
    search,
    isActive,
    relationship,
  });

  const customerIds = items.map((p) => p.customer?.id).filter(Boolean);
  const supplierIds = items.map((p) => p.supplier?.id).filter(Boolean);

  // Balances for just this page, one query per side, from the sub-ledgers.
  const [receivables, payables, customerActivity, supplierActivity] = await Promise.all([
    creditRepository.customerLedgerBalances(companyId, customerIds),
    creditRepository.supplierLedgerBalances(companyId, supplierIds),
    partyRepository.lastCustomerActivity(companyId, customerIds),
    partyRepository.lastSupplierActivity(companyId, supplierIds),
  ]);

  const lastByCustomer = new Map(customerActivity.map((r) => [r.customerId, r._max.entryDate]));
  const lastBySupplier = new Map(supplierActivity.map((r) => [r.supplierId, r._max.entryDate]));

  const parties = items.map((party) => {
    const customerId = party.customer?.id;
    const supplierId = party.supplier?.id;
    const dates = [lastByCustomer.get(customerId), lastBySupplier.get(supplierId)].filter(Boolean);
    const last = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

    return toPublicParty(party, {
      // Null, not zero, for a side the party does not have: "not a customer"
      // and "owes nothing" are different things.
      receivable: customerId ? money(receivables.get(customerId)) : null,
      payable: supplierId ? money(payables.get(supplierId)) : null,
      lastTransactionDate: last ? toDateString(last) : null,
    });
  });

  return { parties, pagination: buildPagination({ page, limit, total }) };
}

export function summary(currentUser) {
  return partyRepository.countByRelationship(currentUser.companyId);
}

export async function getById(currentUser, id) {
  const { companyId } = currentUser;
  const party = await requireParty(undefined, id, companyId);
  const today = await businessToday(companyId);

  const [receivable, customerOverdue, payable, supplierOverdue] = await Promise.all([
    party.customer ? creditRepository.customerLedgerBalance(companyId, party.customer.id) : null,
    party.customer ? partyRepository.overdueForCustomer(companyId, party.customer.id, today) : null,
    party.supplier ? creditRepository.supplierLedgerBalance(companyId, party.supplier.id) : null,
    party.supplier ? partyRepository.overdueForSupplier(companyId, party.supplier.id, today) : null,
  ]);

  return toPublicParty(party, {
    // Two sides, two numbers. Never one "net" figure: what a party owes us and
    // what we owe them are separate debts until somebody settles them.
    customer: party.customer
      ? {
          ...toPublicTerms(party.customer),
          receivable: money(receivable),
          overdue: money(customerOverdue._sum.outstandingAmount),
          overdueCount: customerOverdue._count._all,
        }
      : null,
    supplier: party.supplier
      ? {
          ...toPublicTerms(party.supplier),
          payable: money(payable),
          overdue: money(supplierOverdue._sum.outstandingAmount),
          overdueCount: supplierOverdue._count._all,
        }
      : null,
  });
}

/** Parties that might be the one being typed in. Advisory only. */
export async function possibleMatches(currentUser, wanted) {
  const candidates = await partyRepository.findAllForMatching(currentUser.companyId);
  return findPossibleMatches(wanted, candidates, { excludeId: wanted.excludeId ?? null }).map(
    ({ candidate, reasons }) => ({
      party: {
        id: candidate.id,
        name: candidate.name,
        phone: candidate.phone ?? null,
        gstin: candidate.gstin ?? null,
        email: candidate.email ?? null,
        isActive: candidate.isActive,
        relationship: relationshipOf(candidate),
        customerId: candidate.customer?.id ?? null,
        supplierId: candidate.supplier?.id ?? null,
      },
      reasons,
    }),
  );
}

export async function customerLedger(currentUser, id, query) {
  const party = await requireParty(undefined, id, currentUser.companyId);
  if (!party.customer) {
    throw ApiError.business(404, 'PARTY_NOT_A_CUSTOMER', 'This party is not a customer');
  }
  return customerReceivableService.getCustomerLedger(currentUser, party.customer.id, query);
}

export async function supplierLedger(currentUser, id, query) {
  const party = await requireParty(undefined, id, currentUser.companyId);
  if (!party.supplier) {
    throw ApiError.business(404, 'PARTY_NOT_A_SUPPLIER', 'This party is not a supplier');
  }
  return supplierPayableService.getSupplierLedger(currentUser, party.supplier.id, query);
}

/** Both statements side by side. Each is the existing statement, unchanged. */
export async function statement(currentUser, id, query) {
  const party = await requireParty(undefined, id, currentUser.companyId);
  const [customer, supplier] = await Promise.all([
    party.customer
      ? statementService.getCustomerStatement(currentUser, party.customer.id, query)
      : null,
    party.supplier
      ? statementService.getSupplierStatement(currentUser, party.supplier.id, query)
      : null,
  ]);
  return { party: toPublicParty(party), customer, supplier };
}

// --- writes (master data only: none of these touches the ledger) -------------

function duplicateError(matches) {
  return new ApiError(
    409,
    'A similar party already exists',
    matches.map((match) => ({
      field: 'party',
      message: `${match.party.name} (same ${match.reasons.join(', ')})`,
      ...match.party,
      reasons: match.reasons,
    })),
    'PARTY_POSSIBLE_DUPLICATE',
  );
}

export async function create(currentUser, input) {
  const { companyId } = currentUser;
  const { relationship, customer: customerTerms, supplier: supplierTerms, allowDuplicate } = input;
  const fields = pick(input, PARTY_KEYS);

  // Never create a second copy of somebody silently. The shop is shown what
  // looks similar and decides; only then does allowDuplicate come back true.
  if (!allowDuplicate) {
    const matches = await possibleMatches(currentUser, fields);
    if (matches.length > 0) throw duplicateError(matches);
  }

  const wantsCustomer = relationship !== 'SUPPLIER';
  const wantsSupplier = relationship !== 'CUSTOMER';

  const partyId = await withRetryableTransaction(async (tx) => {
    if (wantsCustomer) await assertRoleNameFree(tx, ROLE.CUSTOMER, fields.name, companyId);
    if (wantsSupplier) await assertRoleNameFree(tx, ROLE.SUPPLIER, fields.name, companyId);

    const party = await partyRepository.create({ ...fields, companyId }, tx);

    if (wantsCustomer) {
      await partyRepository.createRole(ROLE.CUSTOMER, roleRowData(companyId, party, customerTerms), tx);
    }
    if (wantsSupplier) {
      await partyRepository.createRole(ROLE.SUPPLIER, roleRowData(companyId, party, supplierTerms), tx);
    }
    return party.id;
  });

  return getById(currentUser, partyId);
}

/**
 * The party a customer or supplier created through the old endpoints belongs
 * to. Called inside that create's transaction so the two never exist apart.
 *
 * @returns {Promise<string>} the new party's id
 */
export async function createPartyForRole(tx, companyId, roleFields) {
  const party = await partyRepository.create(
    { companyId, ...pick(roleFields, ROLE_COMMON_KEYS) },
    tx,
  );
  return party.id;
}

export async function update(currentUser, id, input) {
  const { companyId } = currentUser;
  const { customer: customerTerms, supplier: supplierTerms } = input;
  const fields = pick(input, PARTY_KEYS);

  await withRetryableTransaction(async (tx) => {
    // Locked first, so a concurrent edit waits and then sees this one.
    const party = await lockParty(tx, id, companyId);

    if (customerTerms && !party.customer) {
      throw ApiError.business(409, 'PARTY_NOT_A_CUSTOMER', 'This party is not a customer yet');
    }
    if (supplierTerms && !party.supplier) {
      throw ApiError.business(409, 'PARTY_NOT_A_SUPPLIER', 'This party is not a supplier yet');
    }

    if (fields.name) {
      if (party.customer) {
        await assertRoleNameFree(tx, ROLE.CUSTOMER, fields.name, companyId, party.customer.id);
      }
      if (party.supplier) {
        await assertRoleNameFree(tx, ROLE.SUPPLIER, fields.name, companyId, party.supplier.id);
      }
    }

    if (Object.keys(fields).length > 0) await partyRepository.updateById(id, fields, tx);

    // The same contact details on every side, so a sale and a purchase never
    // show the same business under two different names.
    const roleCommon = pick(fields, ROLE_COMMON_KEYS);
    const customerChanges = { ...roleCommon, ...(customerTerms ?? {}) };
    const supplierChanges = { ...roleCommon, ...(supplierTerms ?? {}) };

    if (party.customer && Object.keys(customerChanges).length > 0) {
      await partyRepository.updateRole(ROLE.CUSTOMER, party.customer.id, companyId, customerChanges, tx);
    }
    if (party.supplier && Object.keys(supplierChanges).length > 0) {
      await partyRepository.updateRole(ROLE.SUPPLIER, party.supplier.id, companyId, supplierChanges, tx);
    }
  });

  return getById(currentUser, id);
}

/**
 * An edit made through the old /customers or /suppliers endpoint, applied to
 * the whole party so its other side stays in step.
 *
 * @param {'customer'|'supplier'} role
 */
export function updateFromRole(currentUser, partyId, role, input) {
  const common = pick(input, ROLE_COMMON_KEYS);
  const terms = pick(input, ['openingBalance', 'creditLimit', 'creditDays', 'gstRegistrationType']);
  return update(currentUser, partyId, {
    ...common,
    ...(Object.keys(terms).length > 0 ? { [role]: terms } : {}),
  });
}

export async function setStatus(currentUser, id, isActive) {
  const { companyId } = currentUser;

  await withRetryableTransaction(async (tx) => {
    const party = await lockParty(tx, id, companyId);
    await partyRepository.updateById(id, { isActive }, tx);
    // Switching a party off takes it out of both pickers. Its history, balances
    // and statements are untouched.
    if (party.customer) {
      await partyRepository.updateRole(ROLE.CUSTOMER, party.customer.id, companyId, { isActive }, tx);
    }
    if (party.supplier) {
      await partyRepository.updateRole(ROLE.SUPPLIER, party.supplier.id, companyId, { isActive }, tx);
    }
  });

  return getById(currentUser, id);
}

/**
 * Gives a party the side it does not have yet: a customer becomes a supplier
 * too, or the other way round. Idempotent - asking twice is not an error.
 *
 * @param {'CUSTOMER'|'SUPPLIER'} relationship
 */
export async function addRelationship(currentUser, id, relationship, terms = {}) {
  const { companyId } = currentUser;
  const role = ROLE[relationship];

  await withRetryableTransaction(async (tx) => {
    const party = await lockParty(tx, id, companyId);
    if (party[role]) return;

    await assertRoleNameFree(tx, role, party.name, companyId);
    await partyRepository.createRole(role, roleRowData(companyId, party, terms), tx);
  });

  return getById(currentUser, id);
}

/**
 * The customer or supplier id to use for a confirmed bill, adding that side to
 * the party first if the shop chose "use this party" for a new role.
 *
 * @param {'IN'|'OUT'} direction
 */
export async function ensureRoleForBill(currentUser, partyId, direction) {
  const party = await addRelationship(
    currentUser,
    partyId,
    direction === 'IN' ? 'SUPPLIER' : 'CUSTOMER',
  );
  return direction === 'IN' ? party.supplierId : party.customerId;
}

/**
 * Joins an existing customer or supplier record to this party - the explicit,
 * human-made merge for "these two records are the same business".
 *
 * Only master data moves. The record keeps its id, so its invoices, ledger and
 * payments are exactly as they were; nothing is re-posted and nothing is netted.
 * The emptied party it came from is removed, since nothing else points at it.
 */
export async function link(currentUser, id, { customerId, supplierId }) {
  const { companyId } = currentUser;
  const role = customerId ? ROLE.CUSTOMER : ROLE.SUPPLIER;
  const otherRole = role === ROLE.CUSTOMER ? ROLE.SUPPLIER : ROLE.CUSTOMER;
  const roleId = customerId ?? supplierId;

  await withRetryableTransaction(async (tx) => {
    const party = await lockParty(tx, id, companyId);

    const record = await partyRepository.findRoleByIdAndCompany(role, roleId, companyId, tx);
    if (!record) {
      throw ApiError.business(
        404,
        role === ROLE.CUSTOMER ? 'CUSTOMER_NOT_FOUND' : 'SUPPLIER_NOT_FOUND',
        `${role === ROLE.CUSTOMER ? 'Customer' : 'Supplier'} not found`,
      );
    }
    if (record.partyId === id) return;

    if (party[role]) {
      throw ApiError.business(
        409,
        'PARTY_ROLE_TAKEN',
        `This party already has a ${role} record. A party has at most one ${role} side.`,
      );
    }

    let source = null;
    if (record.partyId) {
      source = await lockParty(tx, record.partyId, companyId);
      // The record's current party also has the other side. Moving one half
      // would split that business in two, so refuse rather than guess.
      if (source[otherRole]) {
        throw ApiError.business(
          409,
          'PARTY_LINK_CONFLICT',
          `That ${role} belongs to "${source.name}", which is also a ${otherRole}. Open that party instead.`,
        );
      }
    }

    await assertRoleNameFree(tx, role, party.name, companyId, roleId);

    // Fill gaps in this party's details from the record being joined, never
    // overwrite what the shop already entered here.
    const fillIns = {};
    for (const key of PARTY_KEYS) {
      if (key === 'name') continue;
      if ((party[key] == null || party[key] === '') && source?.[key]) fillIns[key] = source[key];
    }
    const merged = { ...party, ...fillIns };

    await partyRepository.updateRole(
      role,
      roleId,
      companyId,
      { partyId: id, ...pick(merged, ROLE_COMMON_KEYS) },
      tx,
    );
    if (Object.keys(fillIns).length > 0) await partyRepository.updateById(id, fillIns, tx);
    if (source) await partyRepository.deleteById(source.id, tx);
  });

  return getById(currentUser, id);
}
