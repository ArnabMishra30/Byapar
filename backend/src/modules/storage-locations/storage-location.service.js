import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import * as locationRepository from './storage-location.repository.js';
import * as warehouseRepository from '../warehouses/warehouse.repository.js';

// STORAGE LOCATIONS: the racks, shelves, drawers and fridges inside a warehouse.
//
// Each shop sets up its own layout once, and then everybody follows the same
// names: a product says where it is usually kept, and every stock movement is
// tagged with where the stock went or came from.
//
// A location is a TAG, not a bin with its own stock count. Quantities and
// average cost stay per product per warehouse, exactly as before, so nothing
// about valuation, posting or the general ledger changes. Splitting a balance
// across bins would be a separate, much larger change.

/**
 * A sensible starting layout for a small shop. Offered, never forced: the shop
 * applies it with one tap, then renames, adds or switches off whatever it likes.
 */
export const STARTER_LOCATIONS = [
  { name: 'Rack 1', type: 'RACK', code: 'R1', sortOrder: 10 },
  { name: 'Rack 2', type: 'RACK', code: 'R2', sortOrder: 20 },
  { name: 'Counter', type: 'COUNTER', code: 'CTR', sortOrder: 30 },
  { name: 'Drawer 1', type: 'DRAWER', code: 'D1', sortOrder: 40 },
  { name: 'Fridge', type: 'FRIDGE', code: 'FRG', sortOrder: 50 },
  { name: 'Back store', type: 'OTHER', code: 'BS', sortOrder: 60 },
];

export function toPublicLocation(location) {
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    warehouse: location.warehouse
      ? { id: location.warehouse.id, name: location.warehouse.name, code: location.warehouse.code }
      : null,
    name: location.name,
    type: location.type,
    code: location.code ?? null,
    notes: location.notes ?? null,
    sortOrder: location.sortOrder,
    isActive: location.isActive,
    productCount: location._count?.products ?? 0,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}

const notFound = () => ApiError.business(404, 'LOCATION_NOT_FOUND', 'Location not found');

async function requireWarehouse(companyId, warehouseId) {
  const warehouse = await warehouseRepository.findByIdAndCompany(warehouseId, companyId);
  if (!warehouse) {
    throw ApiError.badRequest('Warehouse not found', [
      { field: 'body.warehouseId', message: 'Warehouse does not exist in this company' },
    ]);
  }
  return warehouse;
}

async function assertNameFree(companyId, warehouseId, name, ownId = null) {
  const clash = await locationRepository.findByNameInWarehouse(companyId, warehouseId, name);
  if (clash && clash.id !== ownId) {
    throw ApiError.business(409, 'LOCATION_NAME_TAKEN', `"${name}" already exists in this warehouse`);
  }
}

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });
  const { items, total } = await locationRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });
  return { locations: items.map(toPublicLocation), pagination: buildPagination({ page, limit, total }) };
}

export async function getById(currentUser, id) {
  const location = await locationRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!location) throw notFound();
  return toPublicLocation(location);
}

export async function create(currentUser, input) {
  const { companyId } = currentUser;
  await requireWarehouse(companyId, input.warehouseId);
  await assertNameFree(companyId, input.warehouseId, input.name);

  const location = await locationRepository.create({
    companyId,
    warehouseId: input.warehouseId,
    name: input.name,
    type: input.type ?? 'RACK',
    code: input.code ?? null,
    notes: input.notes ?? null,
    sortOrder: input.sortOrder ?? 0,
  });
  return toPublicLocation(location);
}

export async function update(currentUser, id, input) {
  const { companyId } = currentUser;
  const existing = await locationRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw notFound();
  if (input.name) await assertNameFree(companyId, existing.warehouseId, input.name, id);

  const location = await locationRepository.updateByIdAndCompany(id, companyId, input);
  return toPublicLocation(location);
}

/** Switching one off hides it from pickers. Past movements keep their tag. */
export async function updateStatus(currentUser, id, isActive) {
  const { companyId } = currentUser;
  const existing = await locationRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw notFound();
  const location = await locationRepository.updateByIdAndCompany(id, companyId, { isActive });
  return toPublicLocation(location);
}

/**
 * Adds the starter layout to a warehouse. Idempotent: a name that already
 * exists there is skipped, so applying it twice creates no duplicates.
 */
export async function addStarterLocations(currentUser, warehouseId) {
  const { companyId } = currentUser;
  await requireWarehouse(companyId, warehouseId);
  await locationRepository.createMany(
    STARTER_LOCATIONS.map((location) => ({ ...location, companyId, warehouseId })),
  );
  return list(currentUser, { page: 1, limit: 100, warehouseId });
}

/**
 * Checks a location belongs to this company and this warehouse. Another
 * company's location and a location in a different godown get the same answer,
 * so no other tenant's id is ever confirmed to exist.
 *
 * @returns {Promise<string|null>} the id, or null when none was given
 */
export async function assertLocationInWarehouse(companyId, warehouseId, storageLocationId, client) {
  if (!storageLocationId) return null;
  const location = await locationRepository.findByIdAndCompany(storageLocationId, companyId, client);
  if (!location || location.warehouseId !== warehouseId) {
    throw ApiError.badRequest('Location not found', [
      { field: 'body.storageLocationId', message: 'This location is not in the chosen warehouse' },
    ]);
  }
  return location.id;
}
