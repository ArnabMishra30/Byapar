import * as productService from '../products/product.service.js';
import * as productRepository from '../products/product.repository.js';
import * as supplierService from '../suppliers/supplier.service.js';
import * as supplierRepository from '../suppliers/supplier.repository.js';
import * as customerService from '../customers/customer.service.js';
import * as customerRepository from '../customers/customer.repository.js';
import * as categoryService from '../categories/category.service.js';
import * as categoryRepository from '../categories/category.repository.js';
import * as unitRepository from '../units/unit.repository.js';
import * as warehouseService from '../warehouses/warehouse.service.js';
import * as warehouseRepository from '../warehouses/warehouse.repository.js';
import { ApiError } from '../../utils/api-error.js';

// ADDING WHAT THE BILL MENTIONS BUT THE SHOP DOES NOT HAVE YET.
//
// A new supplier or a new product created here is created THROUGH THE ORDINARY
// SERVICES - the same validation, the same duplicate checks, the same defaults a
// typed form gets. This module only fills in the two things a bill line cannot
// know: which category and which unit a product belongs to.
//
// NOTHING IS CREATED WITHOUT A PERSON ASKING. The review screen shows what is
// about to be added and the shop owner confirms it; a misread "Suger 1kg" is
// corrected before it becomes a permanent record, not after.

/** Where products created from a bill go when the shop has no category for them. */
const FALLBACK_CATEGORY_NAME = 'Uncategorised';

/** Shop wording for a unit, mapped to the short codes seeded for every company. */
const UNIT_ALIASES = {
  kg: 'KG',
  kgs: 'KG',
  kilo: 'KG',
  kilos: 'KG',
  kilogram: 'KG',
  kilograms: 'KG',
  g: 'G',
  gm: 'G',
  gms: 'G',
  gram: 'G',
  grams: 'G',
  l: 'L',
  lt: 'L',
  ltr: 'L',
  litre: 'L',
  litres: 'L',
  liter: 'L',
  ml: 'ML',
  box: 'BOX',
  boxes: 'BOX',
  pack: 'PACK',
  packet: 'PACK',
  packets: 'PACK',
  pkt: 'PACK',
  doz: 'DOZ',
  dozen: 'DOZ',
  pc: 'PCS',
  pcs: 'PCS',
  piece: 'PCS',
  pieces: 'PCS',
  nos: 'PCS',
  no: 'PCS',
  unit: 'PCS',
  units: 'PCS',
};

/** The category to file a new product under: an existing one, or one we add. */
async function resolveCategoryId(currentUser) {
  const { companyId } = currentUser;

  const existing = await categoryRepository.findByNameAndCompany(FALLBACK_CATEGORY_NAME, companyId);
  if (existing) return existing.id;

  // Any category the shop already uses is better than inventing another one.
  const { items } = await categoryRepository.findManyByCompany(companyId, {
    skip: 0,
    take: 1,
    isActive: true,
  });
  if (items.length > 0) return items[0].id;

  const created = await categoryService.create(currentUser, { name: FALLBACK_CATEGORY_NAME });
  return created.id;
}

/** The unit the bill printed, if the shop has it; otherwise its default piece unit. */
async function resolveUnitId(companyId, unitHint) {
  const cleaned = String(unitHint ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

  const shortCode = UNIT_ALIASES[cleaned];

  if (shortCode) {
    const byCode = await unitRepository.findByShortCodeAndCompany(shortCode, companyId);
    if (byCode) return byCode.id;
  }

  if (cleaned) {
    const byName = await unitRepository.findByNameAndCompany(unitHint, companyId);
    if (byName) return byName.id;
  }

  const pieces = await unitRepository.findByShortCodeAndCompany('PCS', companyId);
  if (pieces) return pieces.id;

  const { items } = await unitRepository.findManyByCompany(companyId, {
    skip: 0,
    take: 1,
    isActive: true,
  });
  if (items.length > 0) return items[0].id;

  // Every company is seeded with units, so this means something is badly wrong.
  throw ApiError.business(
    422,
    'NO_UNIT_AVAILABLE',
    'Add a unit (such as Piece) in your settings before adding products from a bill.',
  );
}

/** A short code the shop has not used yet, derived from the name. */
async function availableCode(companyId, preferred) {
  const base =
    String(preferred ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16) || 'STORE';

  if (!(await warehouseRepository.findByCodeAndCompany(base, companyId))) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base.slice(0, 14)}${suffix}`;
    if (!(await warehouseRepository.findByCodeAndCompany(candidate, companyId))) return candidate;
  }

  throw ApiError.business(
    422,
    'NO_STORE_CODE_AVAILABLE',
    'Could not name a new store. Add one in Settings and choose it here.',
  );
}

/**
 * Which store this bill's stock belongs to, without asking when there is no
 * question to ask.
 *
 * A shop with one store never needs to pick it, and a shop with none is offered
 * one on the review screen. A shop with several IS asked, because putting stock
 * in the wrong godown is a real error that only the shop can prevent.
 *
 * @param {{ name?: string, code?: string }|null} newWarehouse  create this one, if given
 * @returns {Promise<string|null>} null when the shop must choose for itself
 */
export async function resolveWarehouseId(currentUser, newWarehouse) {
  const { companyId } = currentUser;

  if (newWarehouse) {
    const name = String(newWarehouse.name ?? '').trim() || 'Main Store';

    // Asked to add one that already exists - use it rather than refusing.
    const existing = await warehouseRepository.findByNameAndCompany(name, companyId);
    if (existing) return existing.id;

    const created = await warehouseService.create(currentUser, {
      name,
      code: await availableCode(companyId, newWarehouse.code || name),
    });
    return created.id;
  }

  const { items } = await warehouseRepository.findManyByCompany(companyId, {
    skip: 0,
    take: 2,
    isActive: true,
  });

  return items.length === 1 ? items[0].id : null;
}

/**
 * Creates the party this bill is with.
 *
 * @param {'IN'|'OUT'} direction
 * @returns {Promise<string>} the new supplier's or customer's id
 */
export async function createPartyFromBill(currentUser, direction, party) {
  const { companyId } = currentUser;
  const service = direction === 'IN' ? supplierService : customerService;
  const repository = direction === 'IN' ? supplierRepository : customerRepository;

  // ALREADY THERE IS A SUCCESS, NOT A CONFLICT.
  //
  // A confirm that created this party and then failed at posting - a closed
  // period, a timeout - leaves it behind. Refusing the retry with "already
  // exists" would strand the shop with a bill it can never record, so the
  // existing record is used, which is what the shop asked for in the first place.
  const existing = await repository.findByNameAndCompany(party.name, companyId);
  if (existing) return existing.id;

  try {
    const created = await service.create(currentUser, {
      name: party.name,
      ...(party.phone ? { phone: party.phone } : {}),
      ...(party.gstin ? { gstin: party.gstin } : {}),
      ...(party.address ? { address: party.address } : {}),
    });
    return created.id;
  } catch (error) {
    // Lost a race, or the name differs only by case. Use whatever is there now.
    const raced = await repository.findByNameAndCompany(party.name, companyId);
    if (raced) return raced.id;
    throw error;
  }
}

/**
 * Creates the products the bill mentions that the shop does not have.
 *
 * @param {Array<{ index: number, name: string, unit?: string|null, price?: string|null }>} products
 * @returns {Promise<Map<number, string>>} line index -> new product id
 */
export async function createProductsFromBill(currentUser, products = []) {
  const created = new Map();
  if (products.length === 0) return created;

  const categoryId = await resolveCategoryId(currentUser);

  for (const product of products) {
    // Same rule as the party: one that already exists is used, not refused.
    const existing = await productRepository.findByNameAndCompany(
      product.name,
      currentUser.companyId,
    );
    if (existing) {
      created.set(product.index, existing.id);
      continue;
    }

    const unitId = await resolveUnitId(currentUser.companyId, product.unit);

    try {
      const record = await productService.create(currentUser, {
        name: product.name,
        categoryId,
        unitId,
        // The price off the bill is a starting point the shop can correct later.
        ...(product.price ? { purchasePrice: product.price } : {}),
      });
      created.set(product.index, record.id);
    } catch (error) {
      const raced = await productRepository.findByNameAndCompany(
        product.name,
        currentUser.companyId,
      );
      if (!raced) throw error;
      created.set(product.index, raced.id);
    }
  }

  return created;
}
