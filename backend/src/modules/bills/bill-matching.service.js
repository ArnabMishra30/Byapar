import * as productRepository from '../products/product.repository.js';
import * as supplierRepository from '../suppliers/supplier.repository.js';
import * as customerRepository from '../customers/customer.repository.js';

// MATCHING WHAT WAS READ TO WHAT THE SHOP ALREADY HAS.
//
// A bill says "Sharma General Store" and "Basmati Rice 5kg". Posting needs a
// supplier id and a product id. This module is the bridge, and it is deliberately
// CONSERVATIVE: it offers a match only when it is genuinely confident, and says
// nothing at all otherwise.
//
// WHY NOT FUZZY. A wrong match is worse than no match: it silently books a
// purchase against the wrong supplier's ledger, or moves stock of the wrong
// product, and the shop finds out at stocktaking. A missed match costs one tap
// in a dropdown. So: identifiers first, then exact names, then one unambiguous
// containment - and never a "best guess" when two candidates are close.
//
// Nothing here writes anything, and every lookup is scoped to the caller's own
// company by the repositories it calls.

/**
 * A name reduced to what two humans would agree is "the same thing".
 *
 * Case, punctuation and spacing vary between a printed bill and a typed record
 * ("ABC Traders Pvt. Ltd." against "abc traders pvt ltd"), and none of that
 * variation is meaningful.
 */
export function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Digits only, so "+91 98765 43210" and "9876543210" are the same phone. */
function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/** The single candidate containing (or contained by) the text, if there is exactly one. */
function uniqueContainment(candidates, wanted) {
  if (wanted.length < 4) return null;

  const hits = candidates.filter((candidate) => {
    const name = normalise(candidate.name);
    if (name.length < 4) return false;
    return name.includes(wanted) || wanted.includes(name);
  });

  return hits.length === 1 ? hits[0] : null;
}

/**
 * The supplier or customer this bill is with.
 *
 * @param {'IN'|'OUT'} direction  IN means a supplier's bill, OUT means a customer's
 * @returns {Promise<{ id: string, name: string, matchedBy: string } | null>}
 */
export async function matchParty(companyId, direction, extracted) {
  const repository = direction === 'IN' ? supplierRepository : customerRepository;
  const candidates = await repository.findAllForMatching(companyId);
  if (candidates.length === 0) return null;

  // A GSTIN identifies a business in law. If it matches, nothing else matters.
  const gstin = normalise(extracted?.partyGstin).replace(/\s+/g, '');
  if (gstin.length === 15) {
    const byGstin = candidates.find(
      (candidate) => normalise(candidate.gstin).replace(/\s+/g, '') === gstin,
    );
    if (byGstin) return { id: byGstin.id, name: byGstin.name, matchedBy: 'gstin' };
  }

  const phone = digitsOnly(extracted?.partyPhone);
  if (phone.length >= 10) {
    const byPhone = candidates.find((candidate) => {
      const stored = digitsOnly(candidate.phone);
      return stored.length >= 10 && stored.slice(-10) === phone.slice(-10);
    });
    if (byPhone) return { id: byPhone.id, name: byPhone.name, matchedBy: 'phone' };
  }

  const name = normalise(extracted?.partyName);
  if (!name) return null;

  const exact = candidates.find((candidate) => normalise(candidate.name) === name);
  if (exact) return { id: exact.id, name: exact.name, matchedBy: 'name' };

  const similar = uniqueContainment(candidates, name);
  return similar ? { id: similar.id, name: similar.name, matchedBy: 'similar-name' } : null;
}

/**
 * A product for each line, where one can be found with confidence.
 *
 * @returns {Promise<Array<{ index: number, productId: string, productName: string, matchedBy: string } | { index: number, productId: null }>>}
 */
export async function matchLines(companyId, lines = []) {
  if (lines.length === 0) return [];

  const candidates = await productRepository.findAllForMatching(companyId);

  return lines.map((line, index) => {
    const description = normalise(line?.description);
    if (!description || candidates.length === 0) return { index, productId: null };

    // A code printed on the bill beats any amount of name similarity.
    const printedCode = normalise(line?.hsnCode);
    if (printedCode) {
      const byCode = candidates.find(
        (candidate) =>
          (candidate.sku && normalise(candidate.sku) === printedCode) ||
          (candidate.barcode && normalise(candidate.barcode) === printedCode),
      );
      if (byCode) {
        return { index, productId: byCode.id, productName: byCode.name, matchedBy: 'code' };
      }
    }

    const exact = candidates.find(
      (candidate) =>
        normalise(candidate.name) === description ||
        (candidate.sku && normalise(candidate.sku) === description),
    );
    if (exact) {
      return { index, productId: exact.id, productName: exact.name, matchedBy: 'name' };
    }

    const similar = uniqueContainment(candidates, description);
    if (similar) {
      return { index, productId: similar.id, productName: similar.name, matchedBy: 'similar-name' };
    }

    return { index, productId: null };
  });
}

/**
 * Everything the review screen needs to pre-fill itself.
 *
 * @returns {Promise<{ party: object|null, lines: Array<object> }>}
 */
export async function suggestMatches(companyId, direction, extracted) {
  const [party, lines] = await Promise.all([
    matchParty(companyId, direction, extracted),
    matchLines(companyId, extracted?.lines ?? []),
  ]);

  return { party, lines };
}
