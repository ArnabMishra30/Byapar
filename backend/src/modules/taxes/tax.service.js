import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString } from '../../utils/money.js';
import * as taxRepository from './tax.repository.js';
import {
  deriveComponentRates,
  assertComponentRatesConsistent,
} from '../tax/gst.calculator.js';

// Tax master data: the headline rate AND how it splits into GST components.
//
// The split is derived from the rate unless it is given explicitly, and is always
// checked: cgst + sgst must equal the rate, and igst must equal the rate. A tax
// master that fails that check cannot be saved, which is what stops a
// half-configured rate from silently mis-taxing every invoice that uses it.
//
// Choosing WHICH components apply to a document is not decided here - that
// depends on the two states, and lives in the tax module's calculator.

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toPublicTax(tax) {
  return {
    id: tax.id,
    name: tax.name,
    // Decimal is serialized as a string, like every other numeric value in this API.
    rate: toMoneyString(tax.rate, 2),
    type: tax.type,
    // How the rate splits. Which of these actually applies to a document is
    // decided by the place of supply, never stored here.
    cgstRate: toMoneyString(tax.cgstRate, 2),
    sgstRate: toMoneyString(tax.sgstRate, 2),
    igstRate: toMoneyString(tax.igstRate, 2),
    cessRate: toMoneyString(tax.cessRate, 2),
    treatment: tax.treatment,
    effectiveFrom: toBusinessDate(tax.effectiveFrom),
    effectiveTo: toBusinessDate(tax.effectiveTo),
    isActive: tax.isActive,
    createdAt: tax.createdAt,
    updatedAt: tax.updatedAt,
  };
}

export async function list(currentUser, query) {
  const { page, limit, search, isActive, type } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await taxRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    isActive,
    type,
  });

  return { taxes: items.map(toPublicTax), pagination: buildPagination({ page, limit, total }) };
}

export async function getById(currentUser, id) {
  const tax = await taxRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!tax) throw ApiError.notFound('Tax not found');
  return toPublicTax(tax);
}

export async function create(currentUser, input) {
  const duplicate = await taxRepository.findByNameAndCompany(input.name, currentUser.companyId);
  if (duplicate) throw new ApiError(409, 'A tax with this name already exists');

  const tax = await taxRepository.create({
    name: input.name,
    rate: input.rate,
    type: input.type,
    companyId: currentUser.companyId,
    ...resolveComponents(input),
    treatment: input.treatment ?? 'TAXABLE',
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
  });

  return toPublicTax(tax);
}

export async function update(currentUser, id, input) {
  const existing = await taxRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Tax not found');

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await taxRepository.findByNameAndCompany(input.name, currentUser.companyId);
    if (duplicate) throw new ApiError(409, 'A tax with this name already exists');
  }

  // The rate and its components move together: changing one without the other
  // would leave a tax master whose parts do not add up.
  const rate = input.rate ?? existing.rate.toString();
  const data = { ...input };

  if (
    input.rate !== undefined ||
    input.cgstRate !== undefined ||
    input.sgstRate !== undefined ||
    input.igstRate !== undefined
  ) {
    Object.assign(
      data,
      resolveComponents({
        rate,
        cgstRate: input.cgstRate ?? (input.rate !== undefined ? undefined : existing.cgstRate.toString()),
        sgstRate: input.sgstRate ?? (input.rate !== undefined ? undefined : existing.sgstRate.toString()),
        igstRate: input.igstRate ?? (input.rate !== undefined ? undefined : existing.igstRate.toString()),
      }),
    );
  }

  const tax = await taxRepository.updateByIdAndCompany(id, currentUser.companyId, data);
  return toPublicTax(tax);
}

/**
 * Fills in the component rates, then proves they agree with the headline rate.
 *
 * Omitting them derives the standard split. Supplying them keeps whatever the
 * business intends - a rate is not always halved evenly - but never without the
 * check.
 */
function resolveComponents(input) {
  const hasExplicitSplit =
    input.cgstRate !== undefined || input.sgstRate !== undefined || input.igstRate !== undefined;

  const components = hasExplicitSplit
    ? {
        cgstRate: input.cgstRate ?? '0',
        sgstRate: input.sgstRate ?? '0',
        igstRate: input.igstRate ?? input.rate,
      }
    : deriveComponentRates(input.rate);

  assertComponentRatesConsistent({ rate: input.rate, ...components });

  return {
    cgstRate: components.cgstRate.toString(),
    sgstRate: components.sgstRate.toString(),
    igstRate: components.igstRate.toString(),
    ...(input.cessRate !== undefined ? { cessRate: input.cessRate } : {}),
  };
}

export async function updateStatus(currentUser, id, isActive) {
  const existing = await taxRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.notFound('Tax not found');

  const tax = await taxRepository.updateByIdAndCompany(id, currentUser.companyId, { isActive });
  return toPublicTax(tax);
}
