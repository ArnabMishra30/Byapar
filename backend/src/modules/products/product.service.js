import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString } from '../../utils/money.js';
import * as productRepository from './product.repository.js';
import * as comboService from './combo.service.js';
import { withTransaction } from '../../config/transaction.js';
import * as categoryRepository from '../categories/category.repository.js';
import * as unitRepository from '../units/unit.repository.js';
import * as taxRepository from '../taxes/tax.repository.js';
import * as taxClassificationRepository from '../tax/tax-classification.repository.js';
import * as storageLocationRepository from '../storage-locations/storage-location.repository.js';

// Business rules for products.
//
// The important rule in this module: a product may only reference a category,
// unit or tax that belongs to the SAME company. Those checks live here, in the
// service, because a foreign key alone cannot express "and the same tenant".

export function toPublicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    // Money and quantities are serialized as strings, never as JavaScript numbers.
    purchasePrice: toMoneyString(product.purchasePrice),
    sellingPrice: toMoneyString(product.sellingPrice),
    reorderLevel: toMoneyString(product.reorderLevel, 3),
    category: product.category ? { id: product.category.id, name: product.category.name } : null,
    unit: product.unit
      ? { id: product.unit.id, name: product.unit.name, shortCode: product.unit.shortCode }
      : null,
    // The HSN/SAC a document line will snapshot from this product.
    taxClassification: product.taxClassification
      ? {
          id: product.taxClassification.id,
          code: product.taxClassification.code,
          kind: product.taxClassification.kind,
          isActive: product.taxClassification.isActive,
        }
      : null,
    tax: product.tax
      ? { id: product.tax.id, name: product.tax.name, rate: toMoneyString(product.tax.rate, 2) }
      : null,
    // Where it is usually kept, and in which warehouse that spot is.
    isCombo: Boolean(product.isCombo),
    isAdHoc: Boolean(product.isAdHoc),
    components: product.isCombo ? comboService.toPublicComponents(product) : [],
    storageLocationId: product.storageLocationId ?? null,
    storageLocation: product.storageLocation
      ? {
          id: product.storageLocation.id,
          name: product.storageLocation.name,
          code: product.storageLocation.code,
          type: product.storageLocation.type,
          warehouse: product.storageLocation.warehouse ?? null,
        }
      : null,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, categoryId, unitId, taxId, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await productRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    categoryId,
    unitId,
    taxId,
    isActive,
    kind: query.kind,
  });

  return {
    products: await Promise.all(
      items.map((item) => withAvailability(currentUser.companyId, toPublicProduct(item), item)),
    ),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const product = await productRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!product) throw ApiError.notFound('Product not found');
  return withAvailability(currentUser.companyId, toPublicProduct(product), product);
}

/** For a combo: how many can be made from its contents' stock, per warehouse. */
async function withAvailability(companyId, publicProduct, product) {
  if (!product.isCombo) return publicProduct;
  return { ...publicProduct, availability: await comboService.availability(companyId, product.comboComponents) };
}

export async function create(currentUser, input) {
  const { companyId } = currentUser;

  await assertRelationsBelongToCompany(companyId, input);
  await assertSkuAndBarcodeAvailable(companyId, input);

  if (input.isCombo) return createCombo(currentUser, input);

  const product = await productRepository.create({
    name: input.name,
    sku: input.sku ?? null,
    barcode: input.barcode ?? null,
    description: input.description ?? null,
    purchasePrice: input.purchasePrice ?? '0',
    sellingPrice: input.sellingPrice ?? '0',
    reorderLevel: input.reorderLevel ?? '0',
    categoryId: input.categoryId,
    unitId: input.unitId,
    taxId: input.taxId ?? null,
    taxClassificationId: input.taxClassificationId ?? null,
    storageLocationId: input.storageLocationId ?? null,
    companyId,
  });

  return toPublicProduct(product);
}

export async function update(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await productRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.notFound('Product not found');

  await assertRelationsBelongToCompany(companyId, input);
  await assertSkuAndBarcodeAvailable(companyId, input, existing);

  const { components, ...fields } = input;
  if (components && !existing.isCombo) {
    throw ApiError.badRequest('Only a combo has contents', [
      { field: 'body.components', message: 'This product is not a combo' },
    ]);
  }
  if (components) {
    await withTransaction(async (tx) => {
      const clean = await comboService.validateComponents(tx, companyId, components, id);
      await comboService.replaceComponents(tx, companyId, id, clean);
    });
  }
  if (Object.keys(fields).length > 0) await productRepository.updateByIdAndCompany(id, companyId, fields);
  return getById(currentUser, id);
}

/** A saved combo: the product and its contents, together or not at all. */
async function createCombo(currentUser, input) {
  const { companyId } = currentUser;
  await assertSkuAndBarcodeAvailable(companyId, input);
  const id = await withTransaction(async (tx) => {
    const components = await comboService.validateComponents(tx, companyId, input.components);
    const defaults = await comboService.defaultsFor(tx, companyId);
    const product = await tx.product.create({
      data: {
        companyId,
        name: input.name,
        sku: input.sku ?? null,
        barcode: input.barcode ?? null,
        description: input.description ?? null,
        sellingPrice: input.sellingPrice ?? '0',
        categoryId: input.categoryId ?? defaults.categoryId,
        unitId: input.unitId ?? defaults.unitId,
        taxId: input.taxId ?? null,
        taxClassificationId: input.taxClassificationId ?? null,
        isCombo: true,
      },
      select: { id: true },
    });
    await comboService.replaceComponents(tx, companyId, product.id, components);
    return product.id;
  });
  return getById(currentUser, id);
}

/** A combo made while billing; returned ready to put on the bill line. */
export async function createOnTheSpotCombo(currentUser, input) {
  const id = await comboService.createOnTheSpot(currentUser, input);
  return getById(currentUser, id);
}

export async function updateStatus(currentUser, id, isActive) {
  const existing = await productRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Product not found');

  const product = await productRepository.updateByIdAndCompany(id, currentUser.companyId, {
    isActive,
  });
  return toPublicProduct(product);
}

/**
 * Rejects a category, unit or tax that does not exist OR belongs to another company.
 * Both cases produce the same message, so the API never confirms that some other
 * company owns that id.
 */
async function assertRelationsBelongToCompany(companyId, input) {
  if (input.categoryId) {
    const category = await categoryRepository.findByIdAndCompany(input.categoryId, companyId);
    if (!category) throw ApiError.badRequest('Category not found', [
      { field: 'body.categoryId', message: 'Category does not exist in this company' },
    ]);
  }

  if (input.unitId) {
    const unit = await unitRepository.findByIdAndCompany(input.unitId, companyId);
    if (!unit) throw ApiError.badRequest('Unit not found', [
      { field: 'body.unitId', message: 'Unit does not exist in this company' },
    ]);
  }

  // taxId is optional. null clears it; a value must resolve inside this company.
  if (input.taxId) {
    const tax = await taxRepository.findByIdAndCompany(input.taxId, companyId);
    if (!tax) throw ApiError.badRequest('Tax not found', [
      { field: 'body.taxId', message: 'Tax does not exist in this company' },
    ]);
  }

  // Same rule for the HSN/SAC, plus one more: a retired classification may not be
  // put on a product, because new documents would then freeze a dead code.
  if (input.taxClassificationId) {
    const classification = await taxClassificationRepository.findByIdAndCompany(
      input.taxClassificationId,
      companyId,
    );
    if (!classification) {
      throw ApiError.badRequest('HSN/SAC not found', [
        {
          field: 'body.taxClassificationId',
          message: 'HSN/SAC does not exist in this company',
        },
      ]);
    }
    if (!classification.isActive) {
      throw ApiError.business(
        422,
        'TAX_CLASSIFICATION_INACTIVE',
        `HSN/SAC ${classification.code} is inactive`,
      );
    }
  }

  // The usual storage spot must be one of this company's own, and switched on.
  if (input.storageLocationId) {
    const location = await storageLocationRepository.findByIdAndCompany(input.storageLocationId, companyId);
    if (!location || !location.isActive) {
      throw ApiError.badRequest('Location not found', [
        { field: 'body.storageLocationId', message: 'Location does not exist in this company' },
      ]);
    }
  }
}

/** SKU and barcode are each unique within a company when present. */
async function assertSkuAndBarcodeAvailable(companyId, input, existing = null) {
  if (input.sku && input.sku.toLowerCase() !== existing?.sku?.toLowerCase()) {
    const duplicate = await productRepository.findBySkuAndCompany(input.sku, companyId);
    if (duplicate) throw new ApiError(409, 'A product with this SKU already exists');
  }

  if (input.barcode && input.barcode !== existing?.barcode) {
    const duplicate = await productRepository.findByBarcodeAndCompany(input.barcode, companyId);
    if (duplicate) throw new ApiError(409, 'A product with this barcode already exists');
  }
}
