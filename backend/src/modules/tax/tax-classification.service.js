import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString } from '../../utils/money.js';
import * as taxClassificationRepository from './tax-classification.repository.js';
import * as taxRepository from '../taxes/tax.repository.js';

// HSN / SAC classification. No Prisma calls here.
//
// WHY THIS IS NOT A SHIPPED CATALOGUE
//   The government HSN list runs to tens of thousands of codes and changes every
//   budget. Shipping it would be a liability: a stale copy that quietly
//   misclassifies goods is worse than no copy. A business uses a handful of
//   codes, so it stores the ones it actually uses and keeps them current itself.
//
// A classification is never hard-deleted once a product uses it, and the code a
// document froze onto its lines keeps working after the classification is
// retired - history has to stay readable.

export function toPublicClassification(classification) {
  return {
    id: classification.id,
    kind: classification.kind,
    code: classification.code,
    description: classification.description,
    defaultTax: classification.defaultTax
      ? {
          id: classification.defaultTax.id,
          name: classification.defaultTax.name,
          rate: toMoneyString(classification.defaultTax.rate, 2),
        }
      : null,
    isActive: classification.isActive,
    createdAt: classification.createdAt,
    updatedAt: classification.updatedAt,
  };
}

async function loadOwn(companyId, id) {
  const classification = await taxClassificationRepository.findByIdAndCompany(id, companyId);
  // Another company's classification is reported exactly like a missing one.
  if (!classification) {
    throw ApiError.business(404, 'TAX_CLASSIFICATION_NOT_FOUND', 'HSN/SAC code not found');
  }
  return classification;
}

/** A default tax must exist in THIS company. */
async function assertDefaultTax(companyId, taxId) {
  if (!taxId) return;

  const tax = await taxRepository.findByIdAndCompany(taxId, companyId);
  if (!tax) throw ApiError.business(404, 'TAX_NOT_FOUND', 'Default tax not found');
  if (!tax.isActive) {
    throw ApiError.business(
      422,
      'TAX_INACTIVE',
      `Tax "${tax.name}" is inactive and cannot be a default`,
    );
  }
}

export async function create(currentUser, input) {
  const { companyId } = currentUser;

  const duplicate = await taxClassificationRepository.findByCodeAndCompany(input.code, companyId);
  if (duplicate) {
    throw ApiError.business(
      409,
      'TAX_CLASSIFICATION_CODE_TAKEN',
      `${input.code} is already in this company's HSN/SAC list`,
    );
  }

  await assertDefaultTax(companyId, input.defaultTaxId);

  const classification = await taxClassificationRepository.create({
    companyId,
    kind: input.kind,
    code: input.code,
    description: input.description ?? null,
    defaultTaxId: input.defaultTaxId ?? null,
    isActive: input.isActive ?? true,
  });

  return toPublicClassification(classification);
}

/**
 * The code itself never changes - it is what documents froze onto their lines,
 * and rewriting it would silently reclassify history. Everything else may be
 * edited.
 */
export async function update(currentUser, id, input) {
  const { companyId } = currentUser;
  await loadOwn(companyId, id);
  await assertDefaultTax(companyId, input.defaultTaxId);

  const data = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.description !== undefined) data.description = input.description;
  if (input.defaultTaxId !== undefined) data.defaultTaxId = input.defaultTaxId;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const classification = await taxClassificationRepository.update(id, companyId, data);
  if (!classification) {
    throw ApiError.business(404, 'TAX_CLASSIFICATION_NOT_FOUND', 'HSN/SAC code not found');
  }

  return toPublicClassification(classification);
}

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await taxClassificationRepository.findManyByCompany(
    currentUser.companyId,
    { skip, take, ...filters },
  );

  return {
    classifications: items.map(toPublicClassification),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const classification = await loadOwn(currentUser.companyId, id);

  return {
    ...toPublicClassification(classification),
    productCount: await taxClassificationRepository.countProducts(id, currentUser.companyId),
  };
}
