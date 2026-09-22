import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString, toDecimal } from '../../utils/money.js';
import * as customerRepository from './customer.repository.js';

// Business rules for customers. Master data only in this phase:
// receivables, sales and customer payments are later phases.
// openingBalance is simply recorded, it does not post to any ledger yet.

export function toPublicCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    gstin: customer.gstin,
    stateCode: customer.stateCode ?? null,
    gstRegistrationType: customer.gstRegistrationType,
    // Money is always serialized as a string. See docs/architecture.md.
    openingBalance: toMoneyString(customer.openingBalance),
    creditLimit: toMoneyString(customer.creditLimit),
    // A limit of zero means UNLIMITED - it is the default every customer
    // carries, so reading it as "no credit" would refuse every existing sale.
    isUnlimited: toDecimal(customer.creditLimit ?? 0).isZero(),
    creditDays: customer.creditDays ?? null,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await customerRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    isActive,
  });

  return {
    customers: items.map(toPublicCustomer),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const customer = await customerRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!customer) throw ApiError.notFound('Customer not found');
  return toPublicCustomer(customer);
}

export async function create(currentUser, input) {
  const duplicate = await customerRepository.findByNameAndCompany(input.name, currentUser.companyId);
  if (duplicate) throw new ApiError(409, 'A customer with this name already exists');

  const customer = await customerRepository.create({
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
  });

  return toPublicCustomer(customer);
}

export async function update(currentUser, id, input) {
  const existing = await customerRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Customer not found');

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await customerRepository.findByNameAndCompany(input.name, currentUser.companyId);
    if (duplicate) throw new ApiError(409, 'A customer with this name already exists');
  }

  const customer = await customerRepository.updateByIdAndCompany(id, currentUser.companyId, input);
  return toPublicCustomer(customer);
}

export async function updateStatus(currentUser, id, isActive) {
  const existing = await customerRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Customer not found');

  const customer = await customerRepository.updateByIdAndCompany(id, currentUser.companyId, { isActive });
  return toPublicCustomer(customer);
}
