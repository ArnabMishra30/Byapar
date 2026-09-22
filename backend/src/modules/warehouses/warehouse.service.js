import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import * as warehouseRepository from './warehouse.repository.js';

// Business rules for warehouses. Master data only - stock arrives in a later phase.

export function toPublicWarehouse(warehouse) {
  return {
    id: warehouse.id,
    name: warehouse.name,
    code: warehouse.code,
    address: warehouse.address,
    stateCode: warehouse.stateCode ?? null,
    isActive: warehouse.isActive,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await warehouseRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    isActive,
  });

  return {
    warehouses: items.map(toPublicWarehouse),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const warehouse = await warehouseRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!warehouse) throw ApiError.notFound('Warehouse not found');
  return toPublicWarehouse(warehouse);
}

export async function create(currentUser, input) {
  await assertNameAndCodeAvailable(currentUser.companyId, input);

  const warehouse = await warehouseRepository.create({
    name: input.name,
    code: input.code,
    address: input.address ?? null,
    companyId: currentUser.companyId,
  });

  return toPublicWarehouse(warehouse);
}

export async function update(currentUser, id, input) {
  const existing = await warehouseRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Warehouse not found');

  await assertNameAndCodeAvailable(currentUser.companyId, input, existing);

  const warehouse = await warehouseRepository.updateByIdAndCompany(id, currentUser.companyId, input);
  return toPublicWarehouse(warehouse);
}

export async function updateStatus(currentUser, id, isActive) {
  const existing = await warehouseRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Warehouse not found');

  const warehouse = await warehouseRepository.updateByIdAndCompany(id, currentUser.companyId, {
    isActive,
  });
  return toPublicWarehouse(warehouse);
}

/** Name and code are each unique within a company. */
async function assertNameAndCodeAvailable(companyId, input, existing = null) {
  const nameChanged = input.name && input.name.toLowerCase() !== existing?.name.toLowerCase();
  const codeChanged = input.code && input.code.toLowerCase() !== existing?.code.toLowerCase();

  if (input.name && (!existing || nameChanged)) {
    const duplicate = await warehouseRepository.findByNameAndCompany(input.name, companyId);
    if (duplicate) throw new ApiError(409, 'A warehouse with this name already exists');
  }

  if (input.code && (!existing || codeChanged)) {
    const duplicate = await warehouseRepository.findByCodeAndCompany(input.code, companyId);
    if (duplicate) throw new ApiError(409, 'A warehouse with this code already exists');
  }
}
