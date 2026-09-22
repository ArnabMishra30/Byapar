import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import * as unitRepository from './unit.repository.js';

// Business rules for units. No unit conversion in this phase - a unit is a label.

export function toPublicUnit(unit) {
  return {
    id: unit.id,
    name: unit.name,
    shortCode: unit.shortCode,
    isActive: unit.isActive,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await unitRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    isActive,
  });

  return { units: items.map(toPublicUnit), pagination: buildPagination({ page, limit, total }) };
}

export async function getById(currentUser, id) {
  const unit = await unitRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!unit) throw ApiError.notFound('Unit not found');
  return toPublicUnit(unit);
}

export async function create(currentUser, input) {
  await assertNameAndCodeAvailable(currentUser.companyId, input);

  const unit = await unitRepository.create({
    name: input.name,
    shortCode: input.shortCode,
    companyId: currentUser.companyId,
  });

  return toPublicUnit(unit);
}

export async function update(currentUser, id, input) {
  const existing = await unitRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Unit not found');

  await assertNameAndCodeAvailable(currentUser.companyId, input, existing);

  const unit = await unitRepository.updateByIdAndCompany(id, currentUser.companyId, input);
  return toPublicUnit(unit);
}

export async function updateStatus(currentUser, id, isActive) {
  const existing = await unitRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Unit not found');

  const unit = await unitRepository.updateByIdAndCompany(id, currentUser.companyId, { isActive });
  return toPublicUnit(unit);
}

/** Name and shortCode are each unique within a company. */
async function assertNameAndCodeAvailable(companyId, input, existing = null) {
  const nameChanged = input.name && input.name.toLowerCase() !== existing?.name.toLowerCase();
  const codeChanged =
    input.shortCode && input.shortCode.toLowerCase() !== existing?.shortCode.toLowerCase();

  if (input.name && (!existing || nameChanged)) {
    const duplicate = await unitRepository.findByNameAndCompany(input.name, companyId);
    if (duplicate) throw new ApiError(409, 'A unit with this name already exists');
  }

  if (input.shortCode && (!existing || codeChanged)) {
    const duplicate = await unitRepository.findByShortCodeAndCompany(input.shortCode, companyId);
    if (duplicate) throw new ApiError(409, 'A unit with this short code already exists');
  }
}
