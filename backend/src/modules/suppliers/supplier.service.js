import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString, toDecimal } from '../../utils/money.js';
import * as supplierRepository from './supplier.repository.js';
import * as partyService from '../parties/party.service.js';
import { withTransaction } from '../../config/transaction.js';

// Business rules for suppliers. Master data only in this phase:
// payables, purchases and supplier payments are later phases.
// openingBalance is simply recorded, it does not post to any ledger yet.

export function toPublicSupplier(supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    gstin: supplier.gstin,
    stateCode: supplier.stateCode ?? null,
    gstRegistrationType: supplier.gstRegistrationType,
    // Money is always serialized as a string. See docs/architecture.md.
    openingBalance: toMoneyString(supplier.openingBalance),
    creditLimit: toMoneyString(supplier.creditLimit),
    // A limit of zero means UNLIMITED - it is the default every supplier
    // carries, so reading it as "no credit" would refuse every existing sale.
    isUnlimited: toDecimal(supplier.creditLimit ?? 0).isZero(),
    creditDays: supplier.creditDays ?? null,
    isActive: supplier.isActive,
    // The party (person or business) this supplier is one side of.
    partyId: supplier.partyId ?? null,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await supplierRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    isActive,
  });

  return {
    suppliers: items.map(toPublicSupplier),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const supplier = await supplierRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!supplier) throw ApiError.notFound('Supplier not found');
  return toPublicSupplier(supplier);
}

export async function create(currentUser, input) {
  const duplicate = await supplierRepository.findByNameAndCompany(input.name, currentUser.companyId);
  if (duplicate) throw new ApiError(409, 'A supplier with this name already exists');

  // Every customer and supplier belongs to a party, created alongside it so the
  // two can never exist apart. Master data only: nothing is posted.
  const supplier = await withTransaction(async (tx) => {
    const partyId = await partyService.createPartyForRole(tx, currentUser.companyId, input);
    return supplierRepository.create(
      {
        partyId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        gstin: input.gstin ?? null,
        stateCode: input.stateCode ?? null,
        gstRegistrationType: input.gstRegistrationType ?? 'UNREGISTERED',
        openingBalance: input.openingBalance ?? '0',
        creditLimit: input.creditLimit ?? '0',
        creditDays: input.creditDays ?? null,
        companyId: currentUser.companyId,
      },
      tx,
    );
  });

  return toPublicSupplier(supplier);
}

export async function update(currentUser, id, input) {
  const existing = await supplierRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Supplier not found');

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await supplierRepository.findByNameAndCompany(input.name, currentUser.companyId);
    if (duplicate) throw new ApiError(409, 'A supplier with this name already exists');
  }

  // Through the party, so its other side (if it has one) keeps the same name
  // and contact details.
  if (existing.partyId) {
    await partyService.updateFromRole(currentUser, existing.partyId, 'supplier', input);
    return getById(currentUser, id);
  }

  const supplier = await supplierRepository.updateByIdAndCompany(id, currentUser.companyId, input);
  return toPublicSupplier(supplier);
}

export async function updateStatus(currentUser, id, isActive) {
  const existing = await supplierRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Supplier not found');

  const supplier = await supplierRepository.updateByIdAndCompany(id, currentUser.companyId, { isActive });
  return toPublicSupplier(supplier);
}
