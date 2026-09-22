import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import {
  add,
  subtract,
  multiply,
  divide,
  round,
  toDecimal,
  toMoneyString,
  isGreaterThan,
  isZero,
} from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as salesReturnRepository from './sales-return.repository.js';
import * as salesRepository from '../sales/sales.repository.js';
import * as inventoryService from '../inventory/inventory.service.js';
import * as customerReceivableService from '../customer-receivables/customer-receivable.service.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import * as gstContextService from '../tax/gst-context.service.js';
import { sumGstComponents, assertGstTotalsConsistent } from '../tax/gst.calculator.js';
import { calculateLineTax } from '../purchases/purchase.calculator.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';

// Sales return / credit note business rules. No Prisma calls here.
//
// THE RULES THAT MATTER:
//   1. A return references a POSTED sales invoice and never modifies it.
//   2. Stock comes back at the COGS cost FROZEN on the original invoice line -
//      never at today's moving average, never recomputed.
//   3. The credit is recomputed from the original line's price, discount and tax,
//      prorated to the returned quantity. The client cannot send amounts.
//   4. The warehouse is the invoice's warehouse. Stock returns to where it left.
//   5. You cannot return more than was sold, minus what has already been returned.

export const SALES_RETURN_REFERENCE_TYPE = 'SALES_RETURN';

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
    salesInvoiceItemId: item.salesInvoiceItemId,
    productId: item.productId,
    productName: item.productNameSnapshot,
    sku: item.skuSnapshot,
    taxName: item.taxNameSnapshot,
    taxRate: item.taxRateSnapshot === null ? null : toMoneyString(item.taxRateSnapshot, 2),
    quantity: toMoneyString(item.quantity, 3),
    unitPrice: toMoneyString(item.unitPrice, 4),
    discountAmount: toMoneyString(item.discountAmount, 2),
    taxableAmount: toMoneyString(item.taxableAmount, 2),
    taxAmount: toMoneyString(item.taxAmount, 2),
    lineTotal: toMoneyString(item.lineTotal, 2),
    // The frozen cost the stock returns at.
    cogsUnitCost: toMoneyString(item.cogsUnitCost, 4),
    cogsAmount: toMoneyString(item.cogsAmount, 2),
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

export function toPublicSalesReturn(salesReturn) {
  return {
    id: salesReturn.id,
    returnNumber: salesReturn.returnNumber,
    status: salesReturn.status,
    returnDate: toBusinessDate(salesReturn.returnDate),
    reason: salesReturn.reason,
    notes: salesReturn.notes,
    salesInvoice: {
      id: salesReturn.salesInvoice.id,
      invoiceNumber: salesReturn.salesInvoice.invoiceNumber,
      invoiceDate: toBusinessDate(salesReturn.salesInvoice.invoiceDate),
      status: salesReturn.salesInvoice.status,
    },
    customer: { id: salesReturn.customer.id, name: salesReturn.customerNameSnapshot },
    warehouse: {
      id: salesReturn.warehouse.id,
      name: salesReturn.warehouse.name,
      code: salesReturn.warehouse.code,
    },
    subtotal: toMoneyString(salesReturn.subtotal, 2),
    discountTotal: toMoneyString(salesReturn.discountTotal, 2),
    taxTotal: toMoneyString(salesReturn.taxTotal, 2),
    grandTotal: toMoneyString(salesReturn.grandTotal, 2),
    cogsTotal: toMoneyString(salesReturn.cogsTotal, 2),
    gst: gstContextService.toPublicGstBlock(salesReturn),
    taxBreakup: {
      cgst: toMoneyString(salesReturn.cgstTotal, 2),
      sgst: toMoneyString(salesReturn.sgstTotal, 2),
      igst: toMoneyString(salesReturn.igstTotal, 2),
      cess: toMoneyString(salesReturn.cessTotal, 2),
    },
    items: salesReturn.items ? salesReturn.items.map(toPublicItem) : undefined,
    createdBy: salesReturn.createdBy
      ? { id: salesReturn.createdBy.id, name: salesReturn.createdBy.name }
      : null,
    postedBy: salesReturn.postedBy
      ? { id: salesReturn.postedBy.id, name: salesReturn.postedBy.name }
      : null,
    postedAt: salesReturn.postedAt,
    cancelledBy: salesReturn.cancelledBy
      ? { id: salesReturn.cancelledBy.id, name: salesReturn.cancelledBy.name }
      : null,
    cancelledAt: salesReturn.cancelledAt,
    createdAt: salesReturn.createdAt,
    updatedAt: salesReturn.updatedAt,
  };
}

// --- pure calculation ------------------------------------------------------

/**
 * How much of an invoice line may still be returned.
 * Exported so it can be unit tested without a database.
 */
export function remainingReturnable(soldQuantity, alreadyReturnedQuantity) {
  const remaining = subtract(soldQuantity, alreadyReturnedQuantity ?? 0);
  // Should never be negative; clamp defensively.
  return isGreaterThan(0, remaining) ? toDecimal(0) : remaining;
}

/**
 * The credit for one returned line, rebuilt from the ORIGINAL invoice line.
 *
 * The discount is prorated by quantity rather than re-deriving it from the
 * discount type. Proration is exact for both PERCENTAGE and FIXED discounts, and
 * a full return therefore credits exactly what was originally charged.
 *
 * Exported for unit testing.
 *
 * @param {object} params
 * @param {string} params.returnQuantity
 * @param {string} params.soldQuantity          quantity on the original line
 * @param {string} params.unitPrice             price on the original line
 * @param {string} params.originalDiscountAmount discount on the whole original line
 * @param {string|null} params.taxRate
 */
export function calculateReturnLine({
  returnQuantity,
  soldQuantity,
  unitPrice,
  originalDiscountAmount,
  taxRate,
  gst,
}) {
  const gross = round(multiply(returnQuantity, unitPrice), MONEY_DP);

  const discountAmount = isZero(soldQuantity)
    ? toDecimal(0)
    : round(
        multiply(originalDiscountAmount, divide(returnQuantity, soldQuantity)),
        MONEY_DP,
      );

  const taxableAmount = round(subtract(gross, discountAmount), MONEY_DP);

  // The same tax rules the invoice line used, driven by that line's frozen
  // rates. Today's tax master is never consulted.
  const { taxAmount, cgstAmount, sgstAmount, igstAmount, cessAmount } = calculateLineTax({
    taxableAmount,
    taxRate,
    gst,
  });

  const lineTotal = round(add(taxableAmount, taxAmount), MONEY_DP);

  return {
    gross,
    discountAmount,
    taxableAmount,
    taxAmount,
    lineTotal,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessAmount,
  };
}

/** Totals a set of already-calculated return lines. */
export function calculateReturnTotals(lines) {
  return lines.reduce(
    (totals, line) => ({
      subtotal: add(totals.subtotal, line.gross),
      discountTotal: add(totals.discountTotal, line.discountAmount),
      taxTotal: add(totals.taxTotal, line.taxAmount),
      grandTotal: add(totals.grandTotal, line.lineTotal),
      cgstTotal: add(totals.cgstTotal, line.cgstAmount ?? 0),
      sgstTotal: add(totals.sgstTotal, line.sgstAmount ?? 0),
      igstTotal: add(totals.igstTotal, line.igstAmount ?? 0),
      cessTotal: add(totals.cessTotal, line.cessAmount ?? 0),
    }),
    {
      subtotal: toDecimal(0),
      discountTotal: toDecimal(0),
      taxTotal: toDecimal(0),
      grandTotal: toDecimal(0),
      cgstTotal: toDecimal(0),
      sgstTotal: toDecimal(0),
      igstTotal: toDecimal(0),
      cessTotal: toDecimal(0),
    },
  );
}

// --- shared validation -----------------------------------------------------

/**
 * Resolves the invoice and every referenced line, and checks the return
 * quantities against what is still returnable.
 *
 * Used at draft time for immediate feedback AND again at posting, because other
 * returns may have been posted in between. Posting is the authoritative check.
 */
async function resolveAndValidate(companyId, input, { excludeReturnId, client } = {}) {
  const salesInvoice = await salesRepository.findByIdAndCompany(
    input.salesInvoiceId,
    companyId,
    client,
  );

  // Another company's invoice is reported exactly like a non-existent one.
  if (!salesInvoice) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');

  if (salesInvoice.status !== 'POSTED') {
    throw ApiError.business(
      422,
      'SALE_NOT_POSTED',
      `Only a posted sales invoice can be returned. This invoice is ${salesInvoice.status.toLowerCase()}.`,
    );
  }

  const returnedByItem = await salesReturnRepository.sumPostedReturnedQuantities(
    salesInvoice.id,
    companyId,
    { excludeReturnId },
    client,
  );

  const itemsById = new Map(salesInvoice.items.map((item) => [item.id, item]));
  const resolvedItems = [];

  input.items.forEach((line, index) => {
    const invoiceItem = itemsById.get(line.salesInvoiceItemId);

    // A line id from another invoice - or another company - looks the same as
    // one that does not exist.
    if (!invoiceItem) {
      throw ApiError.business(
        404,
        'SALE_ITEM_NOT_FOUND',
        `Item ${index + 1}: this line does not belong to invoice ${salesInvoice.invoiceNumber}`,
      );
    }

    const alreadyReturned = returnedByItem.get(invoiceItem.id) ?? toDecimal(0);
    const remaining = remainingReturnable(invoiceItem.quantity, alreadyReturned);

    if (isGreaterThan(line.quantity, remaining)) {
      throw ApiError.business(
        422,
        'SALES_RETURN_EXCEEDS_INVOICE_QTY',
        `Item ${index + 1} (${invoiceItem.productNameSnapshot}): only ${toMoneyString(remaining, 3)} of ${toMoneyString(invoiceItem.quantity, 3)} remains returnable`,
      );
    }

    const amounts = calculateReturnLine({
      returnQuantity: line.quantity,
      soldQuantity: invoiceItem.quantity,
      unitPrice: invoiceItem.unitPrice,
      originalDiscountAmount: invoiceItem.discountAmount,
      taxRate: invoiceItem.taxRateSnapshot ? invoiceItem.taxRateSnapshot.toString() : null,
      gst: {
        supplyType: salesInvoice.supplyType,
        cgstRate: invoiceItem.cgstRateSnapshot,
        sgstRate: invoiceItem.sgstRateSnapshot,
        igstRate: invoiceItem.igstRateSnapshot,
        cessRate: invoiceItem.cessRateSnapshot,
        treatment: invoiceItem.taxTreatmentSnapshot ?? undefined,
      },
    });

    resolvedItems.push({
      row: {
        lineNumber: index + 1,
        salesInvoiceItemId: invoiceItem.id,
        productId: invoiceItem.productId,
        quantity: round(line.quantity, QUANTITY_DP),
        unitPrice: round(invoiceItem.unitPrice, MONEY_DP),
        discountAmount: amounts.discountAmount,
        taxableAmount: amounts.taxableAmount,
        taxAmount: amounts.taxAmount,
        lineTotal: amounts.lineTotal,
        // The cost the stock left at, carried onto the return so posting can
        // put it back at exactly that value.
        cogsUnitCost: round(invoiceItem.cogsUnitCost, MONEY_DP),
        cogsAmount: round(multiply(line.quantity, invoiceItem.cogsUnitCost), MONEY_DP),
        productNameSnapshot: invoiceItem.productNameSnapshot,
        skuSnapshot: invoiceItem.skuSnapshot,
        taxNameSnapshot: invoiceItem.taxNameSnapshot,
        taxRateSnapshot: invoiceItem.taxRateSnapshot,
        // Straight from the invoice line: a credit note must describe the same
        // supply the invoice did.
        hsnCodeSnapshot: invoiceItem.hsnCodeSnapshot,
        taxTreatmentSnapshot: invoiceItem.taxTreatmentSnapshot,
        cgstRateSnapshot: invoiceItem.cgstRateSnapshot,
        sgstRateSnapshot: invoiceItem.sgstRateSnapshot,
        igstRateSnapshot: invoiceItem.igstRateSnapshot,
        cessRateSnapshot: invoiceItem.cessRateSnapshot,
        cgstAmount: amounts.cgstAmount,
        sgstAmount: amounts.sgstAmount,
        igstAmount: amounts.igstAmount,
        cessAmount: amounts.cessAmount,
      },
      amounts,
    });
  });

  return {
    salesInvoice,
    rows: resolvedItems.map((entry) => entry.row),
    totals: calculateReturnTotals(resolvedItems.map((entry) => entry.amounts)),
    gstContext: gstContextService.contextFromPostedDocument(salesInvoice),
  };
}

function assertIsDraft(salesReturn) {
  if (salesReturn.status === 'POSTED') {
    throw ApiError.business(
      409,
      'SALES_RETURN_ALREADY_POSTED',
      'A posted sales return is a historical document and cannot be changed',
    );
  }
  if (salesReturn.status !== 'DRAFT') {
    throw ApiError.business(
      409,
      'SALES_RETURN_NOT_POSTABLE',
      `This sales return is ${salesReturn.status.toLowerCase()}`,
    );
  }
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT return. No stock and no receivable effect. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  const { salesInvoice, rows, totals, gstContext } = await resolveAndValidate(companyId, input);

  const created = await withRetryableTransaction(async (tx) => {
    const returnNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.SALES_RETURN,
      prefix: 'SR',
      date: input.returnDate,
    });

    return salesReturnRepository.createDraft(tx, {
      salesReturn: {
        companyId,
        returnNumber,
        salesInvoiceId: salesInvoice.id,
        // Both copied from the invoice - never from the request.
        customerId: salesInvoice.customer.id,
        warehouseId: salesInvoice.warehouse.id,
        returnDate: input.returnDate,
        status: 'DRAFT',
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        customerNameSnapshot: salesInvoice.customerNameSnapshot,
        createdById: currentUser.id,
        ...gstContextService.toDocumentColumns(gstContext),
        ...totals,
      },
      items: rows,
    });
  });

  return toPublicSalesReturn(created);
}

/** Replaces a draft. The referenced invoice may not be swapped. */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await salesReturnRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'SALES_RETURN_NOT_FOUND', 'Sales return not found');
  }
  assertIsDraft(existing);

  if (input.salesInvoiceId !== existing.salesInvoice.id) {
    throw ApiError.business(
      422,
      'SALES_RETURN_INVOICE_IMMUTABLE',
      'A return cannot be moved to a different invoice. Cancel it and create a new one.',
    );
  }

  const { rows, totals, gstContext } = await resolveAndValidate(companyId, input, {
    excludeReturnId: id,
  });

  const updated = await withRetryableTransaction(async (tx) =>
    salesReturnRepository.updateDraft(tx, {
      id,
      companyId,
      salesReturn: {
        returnDate: input.returnDate,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        ...gstContextService.toDocumentColumns(gstContext),
        ...totals,
      },
      items: rows,
    }),
  );

  if (!updated) {
    throw ApiError.business(
      409,
      'SALES_RETURN_NOT_POSTABLE',
      'Only a draft sales return can be edited',
    );
  }

  return toPublicSalesReturn(updated);
}

/**
 * Posts the return: the only place it touches stock or a balance.
 *
 * Lock order is return -> invoice -> inventory balances (line order) ->
 * receivable, the same outward order sales posting uses, so the two can never
 * deadlock against each other.
 */
export async function post(currentUser, id) {
  const { companyId } = currentUser;

  const posted = await withRetryableTransaction(async (tx) => {
    const locked = await salesReturnRepository.lockForPosting(tx, id, companyId);

    if (!locked) throw ApiError.business(404, 'SALES_RETURN_NOT_FOUND', 'Sales return not found');
    if (locked.status === 'POSTED') {
      throw ApiError.business(
        409,
        'SALES_RETURN_ALREADY_POSTED',
        'This sales return has already been posted',
      );
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(
        409,
        'SALES_RETURN_NOT_POSTABLE',
        'Only a draft sales return can be posted',
      );
    }
    if (locked.items.length === 0) {
      throw ApiError.business(
        422,
        'SALES_RETURN_HAS_NO_ITEMS',
        'A sales return must have at least one item',
      );
    }

    // Locking the parent invoice serialises every return against it, so two
    // returns competing for the same remaining quantity cannot both pass.
    await salesRepository.lockForPosting(tx, locked.salesInvoiceId, companyId);

    // Re-check quantities against what is returnable RIGHT NOW, and re-read the
    // prices and frozen COGS from the invoice rather than trusting the draft.
    const { rows, totals } = await resolveAndValidate(
      companyId,
      {
        salesInvoiceId: locked.salesInvoiceId,
        items: locked.items.map((item) => ({
          salesInvoiceItemId: item.salesInvoiceItemId,
          quantity: item.quantity,
        })),
      },
      { excludeReturnId: id, client: tx },
    );

    // Components must add up to the tax being credited, and a credit note may
    // never carry CGST/SGST and IGST together.
    assertGstTotalsConsistent({ ...totals, supplyType: locked.supplyType });

    let cogsTotal = toDecimal(0);
    // Kept so the journal debits inventory with exactly what re-entered it.
    const movements = [];

    for (const row of rows) {
      // Stock comes back at the FROZEN cost from the original sale, so the
      // valuation the sale removed is restored exactly.
      const movement = await inventoryService.applyStockInWithinTransaction(tx, {
        currentUser,
        productId: row.productId,
        warehouseId: locked.warehouseId,
        quantity: row.quantity,
        unitCost: row.cogsUnitCost,
        referenceType: SALES_RETURN_REFERENCE_TYPE,
        referenceId: locked.id,
        notes: `Sales return ${locked.returnNumber}`,
      });

      cogsTotal = add(cogsTotal, row.cogsAmount);
      movements.push(movement);
    }

    // Credit the customer, in this same transaction. This reduces the receivable
    // raised by the original invoice - it never creates a new one.
    await customerReceivableService.recordSalesReturnPosted(tx, currentUser, {
      id: locked.id,
      salesInvoiceId: locked.salesInvoiceId,
      returnNumber: locked.returnNumber,
      returnDate: locked.returnDate,
      grandTotal: totals.grandTotal,
    });

    // The general ledger entry, last and in this same transaction: contra-revenue
    // and the receivable credit, plus stock back into inventory against COGS at
    // the frozen cost the sale used.
    await glPostingService.recordSalesReturnPosted(
      tx,
      currentUser,
      {
        id: locked.id,
        returnNumber: locked.returnNumber,
        returnDate: locked.returnDate,
        grandTotal: totals.grandTotal,
        taxTotal: totals.taxTotal,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        cessTotal: totals.cessTotal,
      },
      movements,
    );

    const updated = await salesReturnRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: {
        status: 'POSTED',
        postedById: currentUser.id,
        postedAt: new Date(),
        cogsTotal: round(cogsTotal, MONEY_DP),
      },
    });

    if (!updated) {
      throw ApiError.business(
        409,
        'SALES_RETURN_NOT_POSTABLE',
        'Only a draft sales return can be posted',
      );
    }

    return updated;
  });

  return toPublicSalesReturn(posted);
}

/** Cancels a DRAFT. A posted return cannot be undone in this phase. */
export async function cancel(currentUser, id) {
  const { companyId } = currentUser;

  const existing = await salesReturnRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'SALES_RETURN_NOT_FOUND', 'Sales return not found');
  }
  assertIsDraft(existing);

  const cancelled = await withRetryableTransaction(async (tx) =>
    salesReturnRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!cancelled) {
    throw ApiError.business(
      409,
      'SALES_RETURN_NOT_POSTABLE',
      'Only a draft sales return can be cancelled',
    );
  }

  return toPublicSalesReturn(cancelled);
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await salesReturnRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    salesReturns: items.map(toPublicSalesReturn),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const salesReturn = await salesReturnRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!salesReturn) {
    throw ApiError.business(404, 'SALES_RETURN_NOT_FOUND', 'Sales return not found');
  }
  return toPublicSalesReturn(salesReturn);
}

/**
 * What is still returnable on each line of an invoice. This is what a UI needs
 * to render a credit note form, derived from persisted data.
 */
export async function getReturnableLines(currentUser, salesInvoiceId) {
  const { companyId } = currentUser;

  const salesInvoice = await salesRepository.findByIdAndCompany(salesInvoiceId, companyId);
  if (!salesInvoice) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');

  const returnedByItem = await salesReturnRepository.sumPostedReturnedQuantities(
    salesInvoice.id,
    companyId,
  );

  return {
    salesInvoiceId: salesInvoice.id,
    invoiceNumber: salesInvoice.invoiceNumber,
    status: salesInvoice.status,
    customer: { id: salesInvoice.customer.id, name: salesInvoice.customerNameSnapshot },
    warehouse: { id: salesInvoice.warehouse.id, name: salesInvoice.warehouse.name },
    lines: salesInvoice.items.map((item) => {
      const alreadyReturned = returnedByItem.get(item.id) ?? toDecimal(0);
      return {
        salesInvoiceItemId: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        sku: item.skuSnapshot,
        unitPrice: toMoneyString(item.unitPrice, 4),
        cogsUnitCost: toMoneyString(item.cogsUnitCost, 4),
        soldQuantity: toMoneyString(item.quantity, 3),
        returnedQuantity: toMoneyString(alreadyReturned, 3),
        remainingQuantity: toMoneyString(remainingReturnable(item.quantity, alreadyReturned), 3),
      };
    }),
  };
}
