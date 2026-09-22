import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import * as categoryRepository from './category.repository.js';

// Business rules for categories. No Prisma calls here.
// The company always comes from currentUser, never from the request payload.

/** Response shape. Raw Prisma records are never returned directly. */
export function toPublicCategory(category) {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await categoryRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    isActive,
  });

  return {
    categories: items.map(toPublicCategory),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const category = await categoryRepository.findByIdAndCompany(id, currentUser.companyId);
  // Another company's record must be indistinguishable from one that does not exist.
  if (!category) throw ApiError.notFound('Category not found');
  return toPublicCategory(category);
}

export async function create(currentUser, input) {
  const duplicate = await categoryRepository.findByNameAndCompany(input.name, currentUser.companyId);
  if (duplicate) throw new ApiError(409, 'A category with this name already exists');

  const category = await categoryRepository.create({
    name: input.name,
    description: input.description ?? null,
    companyId: currentUser.companyId,
  });

  return toPublicCategory(category);
}

export async function update(currentUser, id, input) {
  const existing = await categoryRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Category not found');

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await categoryRepository.findByNameAndCompany(input.name, currentUser.companyId);
    if (duplicate) throw new ApiError(409, 'A category with this name already exists');
  }

  const category = await categoryRepository.updateByIdAndCompany(id, currentUser.companyId, input);
  return toPublicCategory(category);
}

/** Master data is never hard deleted - it is deactivated. See docs/architecture.md. */
export async function updateStatus(currentUser, id, isActive) {
  const existing = await categoryRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Category not found');

  const category = await categoryRepository.updateByIdAndCompany(id, currentUser.companyId, { isActive });
  return toPublicCategory(category);
}
