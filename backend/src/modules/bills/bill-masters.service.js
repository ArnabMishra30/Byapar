import * as productService from '../products/product.service.js';
import * as supplierService from '../suppliers/supplier.service.js';
import * as customerService from '../customers/customer.service.js';
import * as categoryService from '../categories/category.service.js';
import * as categoryRepository from '../categories/category.repository.js';
import * as unitRepository from '../units/unit.repository.js';
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

/**
 * Creates the party this bill is with.
 *
 * @param {'IN'|'OUT'} direction
 * @returns {Promise<string>} the new supplier's or customer's id
 */
export async function createPartyFromBill(currentUser, direction, party) {
  const service = direction === 'IN' ? supplierService : customerService;

  const created = await service.create(currentUser, {
    name: party.name,
    ...(party.phone ? { phone: party.phone } : {}),
    ...(party.gstin ? { gstin: party.gstin } : {}),
    ...(party.address ? { address: party.address } : {}),
  });

  return created.id;
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
    const unitId = await resolveUnitId(currentUser.companyId, product.unit);

    const record = await productService.create(currentUser, {
      name: product.name,
      categoryId,
      unitId,
      // The price off the bill is a starting point the shop can correct later.
      ...(product.price ? { purchasePrice: product.price } : {}),
    });

    created.set(product.index, record.id);
  }

  return created;
}
