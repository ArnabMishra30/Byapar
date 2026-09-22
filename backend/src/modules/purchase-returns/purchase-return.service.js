import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, subtract, multiply, round, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as purchaseReturnRepository from './purchase-return.repository.js';
import * as purchaseRepository from '../purchases/purchase.repository.js';
import * as inventoryRepository from '../inventory/inventory.repository.js';
import * as inventoryService from '../inventory/inventory.service.js';
import * as supplierPayableService from '../supplier-payables/supplier-payable.service.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';
import * as gstContextService from '../tax/gst-context.service.js';
import {
  calculateGstAmounts,
  sumGstComponents,
  assertGstTotalsConsistent,
} from '../tax/gst.calculator.js';

// Purchase return business rules. No Prisma calls here.
//
// THE RULES THAT MATTER:
//   1. A return references a POSTED purchase and never modifies it.
//   2. The cost is taken from the original purchase line. The client cannot send
//      a cost, and the product master price is irrelevant.
//   3. The warehouse is the purchase's warehouse. Stock goes back out of where
//      it came in; the client cannot redirect it.
//   4. You cannot return more than was bought, minus what has already been
//      returned, and never more than is physically in stock.

export const PURCHASE_RETURN_REFERENCE_TYPE = 'PURCHASE_RETURN';

const QUANTITY_DP = 6;
const MONEY_DP = 4;

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toPublicItem(item) {
  return {
    id: item.id,
    lineNumber: item.lineNumber,
    purchaseItemId: item.purchaseItemId,
    productId: item.productId,
    productName: item.productNameSnapshot,
    sku: item.skuSnapshot,
    quantity: toMoneyString(item.quantity, 3),
    unitCost: toMoneyString(item.unitCost, 4),
    lineTotal: toMoneyString(item.lineTotal, 2),
    taxAmount: toMoneyString(item.taxAmount, 2),
    taxRate: item.taxRateSnapshot === null ? null : toMoneyString(item.taxRateSnapshot, 2),
    hsn: item.hsnCodeSnapshot,
    taxTreatment: item.taxTreatmentSnapshot,
    cgstRate: item.cgstRateSnapshot === null ? null : toMoneyString(item.cgstRateSnapshot, 2),
    sgstRate: item.sgstRateSnapshot === null ? null : toMoneyString(item.sgstRateSnapshot, 2),
    igstRate: item.igstRateSnapshot === null ? null : toMoneyString(item.igstRateSnapshot, 2),
    cessRate: item.cessRateSnapshot === null ? null : toMoneyString(item.cessRateSnapshot, 2),
    cgstAmount: toMoneyString(item.cgstAmount, 2),
    sgstAmount: toMoneyString(item.sgstAmount, 2),
    igstAmount: toMoneyString(item.igstAmount, 2),
    cessAmount: toMoneyString(item.cessAmount, 2),
  };
}

export function toPublicPurchaseReturn(purchaseReturn) {
  return {
    id: purchaseReturn.id,
    returnNumber: purchaseReturn.returnNumber,
    status: purchaseReturn.status,
    returnDate: toBusinessDate(purchaseReturn.returnDate),
    reason: purchaseReturn.reason,
    notes: purchaseReturn.notes,
    taxableTotal: toMoneyString(purchaseReturn.taxableTotal, 2),
    taxTotal: toMoneyString(purchaseReturn.taxTotal, 2),
    grandTotal: toMoneyString(purchaseReturn.grandTotal, 2),
    gst: gstContextService.toPublicGstBlock(purchaseReturn),
    taxBreakup: {
      cgst: toMoneyString(purchaseReturn.cgstTotal, 2),
      sgst: toMoneyString(purchaseReturn.sgstTotal, 2),
      igst: toMoneyString(purchaseReturn.igstTotal, 2),
      cess: toMoneyString(purchaseReturn.cessTotal, 2),
    },
    purchase: {
      id: purchaseReturn.purchase.id,
      purchaseNumber: purchaseReturn.purchase.purchaseNumber,
      invoiceNumber: purchaseReturn.purchase.invoiceNumber,
      status: purchaseReturn.purchase.status,
      supplier: {
        id: purchaseReturn.purchase.supplier.id,
        name: purchaseReturn.purchase.supplierNameSnapshot,
      },
    },
    warehouse: {
      id: purchaseReturn.warehouse.id,
      name: purchaseReturn.warehouse.name,
      code: purchaseReturn.warehouse.code,
    },
    items: purchaseReturn.items ? purchaseReturn.items.map(toPublicItem) : undefined,
    createdBy: purchaseReturn.createdBy
      ? { id: purchaseReturn.createdBy.id, name: purchaseReturn.createdBy.name }
      : null,
    postedBy: purchaseReturn.postedBy
      ? { id: purchaseReturn.postedBy.id, name: purchaseReturn.postedBy.name }
      : null,
    postedAt: purchaseReturn.postedAt,
    cancelledBy: purchaseReturn.cancelledBy
      ? { id: purchaseReturn.cancelledBy.id, name: purchaseReturn.cancelledBy.name }
      : null,
    cancelledAt: purchaseReturn.cancelledAt,
    createdAt: purchaseReturn.createdAt,
    updatedAt: purchaseReturn.updatedAt,
  };
}

// --- quantity arithmetic (pure) --------------------------------------------

/**
 * How much of a purchase line may still be returned.
 * Exported so it can be unit tested without a database.
 */
export function remainingReturnable(purchasedQuantity, alreadyReturnedQuantity) {
  const remaining = subtract(purchasedQuantity, alreadyReturnedQuantity ?? 0);
  // Should never be negative; clamp defensively so a data problem can never
  // present itself as "you may return a negative amount".
  return isGreaterThan(0, remaining) ? toDecimal(0) : remaining;
}

/** quantity * unitCost, rounded once at the stored precision. */
export function calculateLineTotal(quantity, unitCost) {
  return round(multiply(quantity, unitCost), MONEY_DP);
}

// --- shared validation ------------------------------------------------------

/**
 * Resolves the purchase and every referenced line, and checks the return
 * quantities against what is still returnable.
 *
 * Used at draft time for immediate feedback AND again at posting, because other
 * returns may have been posted in between. Posting is the authoritative check.
 *
 * @param {object} options
 * @param {string} [options.excludeReturnId] the return being posted or edited
 */
async function resolveAndValidate(companyId, input, { excludeReturnId, client } = {}) {
  const purchase = await purchaseRepository.findByIdAndCompany(input.purchaseId, companyId, client);

  // Another company's purchase is reported exactly like a non-existent one.
  if (!purchase) throw ApiError.business(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');

  if (purchase.status !== 'POSTED') {
    throw ApiError.business(
      422,
      'PURCHASE_NOT_POSTED',
      `Only a posted purchase can be returned. This purchase is ${purchase.status.toLowerCase()}.`,
    );
  }

  const returnedByItem = await purchaseReturnRepository.sumPostedReturnedQuantities(
    purchase.id,
    companyId,
    { excludeReturnId },
    client,
  );

  const itemsById = new Map(purchase.items.map((item) => [item.id, item]));
  const resolvedItems = [];

  input.items.forEach((line, index) => {
    const purchaseItem = itemsById.get(line.purchaseItemId);

    // A purchase item id from another purchase - or another company - looks the
    // same as one that does not exist.
    if (!purchaseItem) {
      throw ApiError.business(
        404,
        'PURCHASE_ITEM_NOT_FOUND',
        `Item ${index + 1}: this line does not belong to purchase ${purchase.purchaseNumber}`,
      );
    }

    const alreadyReturned = returnedByItem.get(purchaseItem.id) ?? toDecimal(0);
    const remaining = remainingReturnable(purchaseItem.quantity, alreadyReturned);

    if (isGreaterThan(line.quantity, remaining)) {
      throw ApiError.business(
        422,
        'PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY',
        `Item ${index + 1} (${purchaseItem.productNameSnapshot}): only ${toMoneyString(remaining, 3)} of ${toMoneyString(purchaseItem.quantity, 3)} remains returnable`,
      );
    }

    const lineTotal = calculateLineTotal(line.quantity, purchaseItem.unitCost);

    // The input credit is handed back at the rates the ORIGINAL bill was taxed
    // at, taken from that line's frozen snapshot. Today's tax master is never
    // consulted, so a rate change cannot alter a debit note against an old bill.
    const tax = calculateGstAmounts({
      taxableAmount: lineTotal,
      cgstRate: purchaseItem.cgstRateSnapshot,
      sgstRate: purchaseItem.sgstRateSnapshot,
      igstRate: purchaseItem.igstRateSnapshot,
      cessRate: purchaseItem.cessRateSnapshot,
      supplyType: purchase.supplyType,
      treatment: purchaseItem.taxTreatmentSnapshot ?? undefined,
    });

    resolvedItems.push({
      lineNumber: index + 1,
      purchaseItemId: purchaseItem.id,
      productId: purchaseItem.productId,
      quantity: round(line.quantity, QUANTITY_DP),
      // The cost the supplier charged, copied from the original line.
      unitCost: round(purchaseItem.unitCost, MONEY_DP),
      lineTotal,
      taxAmount: tax.taxAmount,
      productNameSnapshot: purchaseItem.productNameSnapshot,
      skuSnapshot: purchaseItem.skuSnapshot,
      // The original line's classification and rates travel onto the debit note.
      taxRateSnapshot: purchaseItem.taxRateSnapshot,
      hsnCodeSnapshot: purchaseItem.hsnCodeSnapshot,
      taxTreatmentSnapshot: purchaseItem.taxTreatmentSnapshot,
      cgstRateSnapshot: purchaseItem.cgstRateSnapshot,
      sgstRateSnapshot: purchaseItem.sgstRateSnapshot,
      igstRateSnapshot: purchaseItem.igstRateSnapshot,
      cessRateSnapshot: purchaseItem.cessRateSnapshot,
      cgstAmount: tax.cgstAmount,
      sgstAmount: tax.sgstAmount,
      igstAmount: tax.igstAmount,
      cessAmount: tax.cessAmount,
    });
  });

  const taxableTotal = resolvedItems.reduce(
    (total, item) => add(total, item.lineTotal),
    toDecimal(0),
  );
  const taxTotal = resolvedItems.reduce((total, item) => add(total, item.taxAmount), toDecimal(0));
  // What the supplier actually credits: the goods plus the tax on them. Without
  // GST the tax is zero, so this is the cost-only figure it has always been.
  const grandTotal = add(taxableTotal, taxTotal);

  return {
    purchase,
    resolvedItems,
    taxableTotal,
    taxTotal,
    grandTotal,
    componentTotals: sumGstComponents(resolvedItems),
    gstContext: gstContextService.contextFromPostedDocument(purchase),
  };
}

function assertIsDraft(purchaseReturn) {
  if (purchaseReturn.status === 'POSTED') {
    throw ApiError.business(
      409,
      'PURCHASE_RETURN_ALREADY_POSTED',
      'A posted purchase return is a historical document and cannot be changed',
    );
  }
  if (purchaseReturn.status !== 'DRAFT') {
    throw ApiError.business(
      409,
      'PURCHASE_RETURN_NOT_POSTABLE',
      `This purchase return is ${purchaseReturn.status.toLowerCase()}`,
    );
  }
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT return. No inventory effect. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  const { purchase, resolvedItems, taxableTotal, taxTotal, grandTotal, componentTotals, gstContext } =
    await resolveAndValidate(companyId, input);

  const created = await withRetryableTransaction(async (tx) => {
    const returnNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.PURCHASE_RETURN,
      prefix: 'PR',
      date: input.returnDate,
    });

    return purchaseReturnRepository.createDraft(tx, {
      purchaseReturn: {
        companyId,
        returnNumber,
        purchaseId: purchase.id,
        // Always the purchase's warehouse - never a client-supplied one.
        warehouseId: purchase.warehouse.id,
        returnDate: input.returnDate,
        status: 'DRAFT',
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        taxableTotal,
        taxTotal,
        grandTotal,
        ...gstContextService.toDocumentColumns(gstContext),
        ...componentTotals,
        createdById: currentUser.id,
      },
      items: resolvedItems,
    });
  });

  return toPublicPurchaseReturn(created);
}

/** Replaces a draft. The referenced purchase may not be swapped. */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await purchaseReturnRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'PURCHASE_RETURN_NOT_FOUND', 'Purchase return not found');
  }
  assertIsDraft(existing);

  if (input.purchaseId !== existing.purchase.id) {
    throw ApiError.business(
      422,
      'PURCHASE_RETURN_PURCHASE_IMMUTABLE',
      'A return cannot be moved to a different purchase. Cancel it and create a new one.',
    );
  }

  const { resolvedItems, taxableTotal, taxTotal, grandTotal, componentTotals, gstContext } =
    await resolveAndValidate(companyId, input, { excludeReturnId: id });

  const updated = await withRetryableTransaction(async (tx) =>
    purchaseReturnRepository.updateDraft(tx, {
      id,
      companyId,
      purchaseReturn: {
        returnDate: input.returnDate,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        taxableTotal,
        taxTotal,
        grandTotal,
        ...gstContextService.toDocumentColumns(gstContext),
        ...componentTotals,
      },
      items: resolvedItems,
    }),
  );

  if (!updated) {
    throw ApiError.business(
      409,
      'PURCHASE_RETURN_NOT_POSTABLE',
      'Only a draft purchase return can be edited',
    );
  }

  return toPublicPurchaseReturn(updated);
}

/**
 * Posts the return: the only place a return touches stock.
 *
 * One transaction covers the lock, the re-validation, every stock movement and
 * the status change.
 *
 * Lock order is deliberately the same as purchase posting - purchase row, then
 * inventory balance rows in item order - so the two can never deadlock.
 */
export async function post(currentUser, id) {
  const { companyId } = currentUser;

  const posted = await withRetryableTransaction(async (tx) => {
    const locked = await purchaseReturnRepository.lockForPosting(tx, id, companyId);

    if (!locked) {
      throw ApiError.business(404, 'PURCHASE_RETURN_NOT_FOUND', 'Purchase return not found');
    }
    if (locked.status === 'POSTED') {
      throw ApiError.business(
        409,
        'PURCHASE_RETURN_ALREADY_POSTED',
        'This purchase return has already been posted',
      );
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(
        409,
        'PURCHASE_RETURN_NOT_POSTABLE',
        'Only a draft purchase return can be posted',
      );
    }
    if (locked.items.length === 0) {
      throw ApiError.business(
        422,
        'PURCHASE_RETURN_HAS_NO_ITEMS',
        'A purchase return must have at least one item',
      );
    }

    // Locking the parent purchase serialises every return against it, so two
    // returns competing for the same remaining quantity cannot both pass the
    // check below.
    await purchaseRepository.lockForPosting(tx, locked.purchaseId, companyId);

    // Re-check quantities against what is returnable RIGHT NOW, and re-read the
    // unit cost from the original purchase rather than trusting the draft.
    const { resolvedItems } = await resolveAndValidate(
      companyId,
      {
        purchaseId: locked.purchaseId,
        items: locked.items.map((item) => ({
          purchaseItemId: item.purchaseItemId,
          quantity: item.quantity,
        })),
      },
      { excludeReturnId: id, client: tx },
    );

    // Components must add up to the tax being reversed, and a debit note may
    // never carry CGST/SGST and IGST together. Failing here rolls back the
    // whole return.
    assertGstTotalsConsistent(locked);

    // Kept so the journal is valued at what actually left inventory.
    const movements = [];

    for (const item of resolvedItems) {
      // Lock the balance first so the stock check and the deduction cannot be
      // separated by another transaction, and so the failure carries a
      // return-specific error code rather than the generic inventory one.
      const balance = await inventoryRepository.lockBalance(
        tx,
        companyId,
        item.productId,
        locked.warehouseId,
      );

      const available = balance ? balance.quantity : toDecimal(0);

      if (isGreaterThan(item.quantity, available)) {
        throw ApiError.business(
          422,
          'PURCHASE_RETURN_INSUFFICIENT_STOCK',
          `${item.productNameSnapshot}: only ${toMoneyString(available, 3)} in stock, ${toMoneyString(item.quantity, 3)} requested`,
        );
      }

      const movement = await inventoryService.applyStockOutWithinTransaction(tx, {
        currentUser,
        productId: item.productId,
        warehouseId: locked.warehouseId,
        quantity: item.quantity,
        // Goods leave at what the supplier charged, not at today's average.
        outUnitCostOverride: item.unitCost,
        referenceType: PURCHASE_RETURN_REFERENCE_TYPE,
        referenceId: locked.id,
        notes: `Purchase return ${locked.returnNumber}`,
      });

      movements.push(movement);
    }

    // Credit the supplier for the returned goods, in this same transaction.
    // This reduces the payable raised by the original purchase - it never
    // creates a new one.
    await supplierPayableService.recordPurchaseReturnPosted(tx, currentUser, locked);

    // The general ledger entry, last and in this same transaction. The inventory
    // credit is the sum of the movements above, so the GL cannot disagree with
    // the stock ledger about what the returned goods were worth.
    await glPostingService.recordPurchaseReturnPosted(tx, currentUser, locked, movements);

    const updated = await purchaseReturnRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'POSTED', postedById: currentUser.id, postedAt: new Date() },
    });

    if (!updated) {
      throw ApiError.business(
        409,
        'PURCHASE_RETURN_NOT_POSTABLE',
        'Only a draft purchase return can be posted',
      );
    }

    return updated;
  });

  return toPublicPurchaseReturn(posted);
}

/** Cancels a DRAFT. A posted return cannot be undone in this phase. */
export async function cancel(currentUser, id) {
  const { companyId } = currentUser;

  const existing = await purchaseReturnRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'PURCHASE_RETURN_NOT_FOUND', 'Purchase return not found');
  }
  assertIsDraft(existing);

  const cancelled = await withRetryableTransaction(async (tx) =>
    purchaseReturnRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!cancelled) {
    throw ApiError.business(
      409,
      'PURCHASE_RETURN_NOT_POSTABLE',
      'Only a draft purchase return can be cancelled',
    );
  }

  return toPublicPurchaseReturn(cancelled);
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await purchaseReturnRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    purchaseReturns: items.map(toPublicPurchaseReturn),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const purchaseReturn = await purchaseReturnRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!purchaseReturn) {
    throw ApiError.business(404, 'PURCHASE_RETURN_NOT_FOUND', 'Purchase return not found');
  }
  return toPublicPurchaseReturn(purchaseReturn);
}

/**
 * What is still returnable on each line of a purchase. This is what a UI needs
 * to render a return form, and it is derived from persisted data - never from
 * anything a client sends.
 */
export async function getReturnableLines(currentUser, purchaseId) {
  const { companyId } = currentUser;

  const purchase = await purchaseRepository.findByIdAndCompany(purchaseId, companyId);
  if (!purchase) throw ApiError.business(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');

  const returnedByItem = await purchaseReturnRepository.sumPostedReturnedQuantities(
    purchase.id,
    companyId,
  );

  return {
    purchaseId: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    status: purchase.status,
    warehouse: { id: purchase.warehouse.id, name: purchase.warehouse.name },
    lines: purchase.items.map((item) => {
      const alreadyReturned = returnedByItem.get(item.id) ?? toDecimal(0);
      return {
        purchaseItemId: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        sku: item.skuSnapshot,
        unitCost: toMoneyString(item.unitCost, 4),
        purchasedQuantity: toMoneyString(item.quantity, 3),
        returnedQuantity: toMoneyString(alreadyReturned, 3),
        remainingQuantity: toMoneyString(remainingReturnable(item.quantity, alreadyReturned), 3),
      };
    }),
  };
}
