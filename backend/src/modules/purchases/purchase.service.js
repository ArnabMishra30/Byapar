import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { toMoneyString, round } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import { calculateLine, calculateTotals } from './purchase.calculator.js';
import * as purchaseRepository from './purchase.repository.js';
import * as supplierRepository from '../suppliers/supplier.repository.js';
import * as warehouseRepository from '../warehouses/warehouse.repository.js';
import * as productRepository from '../products/product.repository.js';
import * as taxRepository from '../taxes/tax.repository.js';
import * as inventoryService from '../inventory/inventory.service.js';
import * as supplierPayableService from '../supplier-payables/supplier-payable.service.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import * as gstContextService from '../tax/gst-context.service.js';
import { assertGstTotalsConsistent } from '../tax/gst.calculator.js';
import {
  buildLineGst,
  buildLineTaxSnapshot,
  assertLineTaxUsable,
} from '../tax/gst-line.js';
import {
  nextDocumentNumber,
  DOCUMENT_TYPE,
} from '../document-numbers/document-number.service.js';

// Purchase business rules. No Prisma calls here.
//
// THE CENTRAL RULE OF THIS MODULE:
//   Creating or editing a purchase NEVER touches inventory.
//   Only posting does, and posting happens in one transaction with the stock
//   movements it causes.
//
// Money is Decimal throughout; see purchase.calculator.js for the rounding policy.

export const PURCHASE_REFERENCE_TYPE = 'PURCHASE';

// --- serialization ---------------------------------------------------------

/** Business dates are dates, not timestamps: "2026-08-28", never an ISO instant. */
function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toPublicItem(item) {
  return {
    id: item.id,
    lineNumber: item.lineNumber,
    productId: item.productId,
    productName: item.productNameSnapshot,
    sku: item.skuSnapshot,
    unitName: item.unitNameSnapshot,
    taxId: item.taxId,
    taxName: item.taxNameSnapshot,
    taxRate: item.taxRateSnapshot === null ? null : toMoneyString(item.taxRateSnapshot, 2),
    quantity: toMoneyString(item.quantity, 3),
    unitCost: toMoneyString(item.unitCost, 4),
    discountType: item.discountType,
    discountValue: toMoneyString(item.discountValue, 4),
    discountAmount: toMoneyString(item.discountAmount, 2),
    taxableAmount: toMoneyString(item.taxableAmount, 2),
    taxAmount: toMoneyString(item.taxAmount, 2),
    lineTotal: toMoneyString(item.lineTotal, 2),
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

export function toPublicPurchase(purchase) {
  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    invoiceNumber: purchase.invoiceNumber,
    status: purchase.status,
    supplier: {
      id: purchase.supplier.id,
      // The snapshot, so an old bill keeps the name it was entered with.
      name: purchase.supplierNameSnapshot,
      currentName: purchase.supplier.name,
    },
    warehouse: {
      id: purchase.warehouse.id,
      name: purchase.warehouse.name,
      code: purchase.warehouse.code,
    },
    invoiceDate: toBusinessDate(purchase.invoiceDate),
    dueDate: toBusinessDate(purchase.dueDate),
    subtotal: toMoneyString(purchase.subtotal, 2),
    discountTotal: toMoneyString(purchase.discountTotal, 2),
    taxTotal: toMoneyString(purchase.taxTotal, 2),
    grandTotal: toMoneyString(purchase.grandTotal, 2),
    gst: gstContextService.toPublicGstBlock(purchase),
    taxBreakup: {
      cgst: toMoneyString(purchase.cgstTotal, 2),
      sgst: toMoneyString(purchase.sgstTotal, 2),
      igst: toMoneyString(purchase.igstTotal, 2),
      cess: toMoneyString(purchase.cessTotal, 2),
    },
    notes: purchase.notes,
    items: purchase.items ? purchase.items.map(toPublicItem) : undefined,
    createdBy: purchase.createdBy ? { id: purchase.createdBy.id, name: purchase.createdBy.name } : null,
    postedBy: purchase.postedBy ? { id: purchase.postedBy.id, name: purchase.postedBy.name } : null,
    postedAt: purchase.postedAt,
    cancelledBy: purchase.cancelledBy
      ? { id: purchase.cancelledBy.id, name: purchase.cancelledBy.name }
      : null,
    cancelledAt: purchase.cancelledAt,
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt,
  };
}

// --- validation ------------------------------------------------------------

/**
 * Loads and checks every master record a purchase refers to.
 *
 * Runs at draft creation, at draft update AND again at posting, because a
 * supplier, warehouse, product or tax can be deactivated in between. Posting a
 * bill against a deactivated product must fail rather than quietly succeed.
 */
/**
 * The due date a bill carries: the explicit date if given, otherwise derived
 * from the supplier's payment terms, otherwise none.
 *
 * Identical rule to the sales side. An undated bill is outstanding but never
 * overdue.
 */
export function resolveDueDate({ invoiceDate, dueDate, creditDays }) {
  if (dueDate) return dueDate;
  if (creditDays === null || creditDays === undefined) return null;

  const derived = new Date(invoiceDate);
  derived.setUTCDate(derived.getUTCDate() + creditDays);
  return derived;
}

async function loadAndValidateReferences(companyId, input) {
  const [supplier, warehouse] = await Promise.all([
    supplierRepository.findByIdAndCompany(input.supplierId, companyId),
    warehouseRepository.findByIdAndCompany(input.warehouseId, companyId),
  ]);

  // Another company's id is reported exactly like a non-existent one.
  if (!supplier) throw ApiError.business(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  if (!supplier.isActive) {
    throw ApiError.business(422, 'SUPPLIER_INACTIVE', `Supplier "${supplier.name}" is inactive`);
  }
  if (!warehouse) throw ApiError.business(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');
  if (!warehouse.isActive) {
    throw ApiError.business(422, 'WAREHOUSE_INACTIVE', `Warehouse "${warehouse.name}" is inactive`);
  }

  const resolvedItems = [];

  for (const [index, item] of input.items.entries()) {
    const product = await productRepository.findByIdAndCompany(item.productId, companyId);

    if (!product) {
      throw ApiError.business(404, 'PRODUCT_NOT_FOUND', `Item ${index + 1}: product not found`);
    }
    if (!product.isActive) {
      throw ApiError.business(
        422,
        'PRODUCT_INACTIVE',
        `Item ${index + 1}: product "${product.name}" is inactive`,
      );
    }

    let tax = null;
    if (item.taxId) {
      tax = await taxRepository.findByIdAndCompany(item.taxId, companyId);
      if (!tax) {
        throw ApiError.business(404, 'TAX_NOT_FOUND', `Item ${index + 1}: tax not found`);
      }
      if (!tax.isActive) {
        throw ApiError.business(
          422,
          'TAX_INACTIVE',
          `Item ${index + 1}: tax "${tax.name}" is inactive`,
        );
      }
    }

    // The rate's effective window and the product's HSN/SAC, both checked
    // against the bill's own date rather than against today.
    assertLineTaxUsable(product, tax, input.invoiceDate, `Item ${index + 1}`);

    resolvedItems.push({ input: item, product, tax, index });
  }

  return { supplier, warehouse, resolvedItems };
}

/**
 * Turns validated input into the rows to store, with totals and snapshots.
 *
 * @param {object} gstContext resolved once for the whole document; decides
 *   whether each line is taxed as CGST+SGST, as IGST, or not split at all.
 */
function buildItemRows(resolvedItems, gstContext) {
  const calculated = resolvedItems.map(({ input, product, tax, index }) => {
    const taxRate = tax ? tax.rate.toString() : null;
    const gst = buildLineGst(tax, gstContext);

    const amounts = calculateLine({
      quantity: input.quantity,
      unitCost: input.unitCost,
      discountType: input.discountType,
      discountValue: input.discountValue,
      taxRate,
      index,
      gst,
    });

    return {
      row: {
        lineNumber: index + 1,
        productId: product.id,
        taxId: tax ? tax.id : null,
        quantity: round(input.quantity, 6),
        unitCost: round(input.unitCost, 4),
        discountType: input.discountType,
        discountValue: round(input.discountValue ?? 0, 4),
        discountAmount: amounts.discountAmount,
        taxableAmount: amounts.taxableAmount,
        taxAmount: amounts.taxAmount,
        lineTotal: amounts.lineTotal,
        // Snapshots: this bill must still print correctly after the product is
        // renamed or the tax rate is changed.
        productNameSnapshot: product.name,
        skuSnapshot: product.sku,
        unitNameSnapshot: product.unit.shortCode,
        taxNameSnapshot: tax ? tax.name : null,
        taxRateSnapshot: tax ? tax.rate : null,
        ...buildLineTaxSnapshot(product, tax, gst, amounts),
      },
      amounts,
    };
  });

  return {
    rows: calculated.map((entry) => entry.row),
    totals: calculateTotals(calculated.map((entry) => entry.amounts)),
  };
}

async function assertInvoiceNumberIsFree(companyId, supplierId, invoiceNumber, excludePurchaseId) {
  const existing = await purchaseRepository.findBySupplierInvoiceNumber(
    companyId,
    supplierId,
    invoiceNumber,
  );

  if (existing && existing.id !== excludePurchaseId) {
    throw ApiError.business(
      409,
      'DUPLICATE_INVOICE_NUMBER',
      `This supplier already has a bill with invoice number "${invoiceNumber}" (${existing.purchaseNumber})`,
    );
  }
}

// --- writes ----------------------------------------------------------------

/**
 * Creates a DRAFT. Deliberately has NO inventory effect: a draft is a document
 * being prepared, and the stock it describes has not been accepted yet.
 */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  const { supplier, warehouse, resolvedItems } = await loadAndValidateReferences(companyId, input);
  await assertInvoiceNumberIsFree(companyId, input.supplierId, input.invoiceNumber);

  // Who supplied us, from which state, into which state. Resolved once and
  // frozen onto the document - a later change to the supplier's state must not
  // rewrite the tax on a bill we have already entered.
  const gstContext = await gstContextService.resolvePurchaseContext(currentUser, {
    supplier,
    warehouse,
  });
  const { rows, totals } = buildItemRows(resolvedItems, gstContext);

  const purchase = await withRetryableTransaction(async (tx) => {
    const purchaseNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.PURCHASE,
      prefix: 'PUR',
      date: input.invoiceDate,
    });

    return purchaseRepository.createDraft(tx, {
      purchase: {
        companyId,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        purchaseNumber,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: resolveDueDate({
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          creditDays: supplier.creditDays,
        }),
        status: 'DRAFT',
        supplierNameSnapshot: supplier.name,
        notes: input.notes ?? null,
        createdById: currentUser.id,
        ...gstContextService.toDocumentColumns(gstContext),
        ...totals,
      },
      items: rows,
    });
  });

  return toPublicPurchase(purchase);
}

/**
 * Replaces a draft's contents. Only DRAFT purchases can be edited: a posted bill
 * is a historical document.
 */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await purchaseRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  assertIsDraft(existing);

  const { supplier, warehouse, resolvedItems } = await loadAndValidateReferences(companyId, input);
  await assertInvoiceNumberIsFree(companyId, input.supplierId, input.invoiceNumber, id);

  const gstContext = await gstContextService.resolvePurchaseContext(currentUser, {
    supplier,
    warehouse,
  });
  const { rows, totals } = buildItemRows(resolvedItems, gstContext);

  const purchase = await withRetryableTransaction(async (tx) =>
    purchaseRepository.updateDraft(tx, {
      id,
      companyId,
      purchase: {
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: resolveDueDate({
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          creditDays: supplier.creditDays,
        }),
        supplierNameSnapshot: supplier.name,
        notes: input.notes ?? null,
        ...gstContextService.toDocumentColumns(gstContext),
        ...totals,
      },
      items: rows,
    }),
  );

  // updateDraft only matches rows still in DRAFT, so null means it was posted or
  // cancelled between our read and our write.
  if (!purchase) {
    throw ApiError.business(409, 'PURCHASE_NOT_DRAFT', 'Only a draft purchase can be edited');
  }

  return toPublicPurchase(purchase);
}

/**
 * Posts the purchase: the one place where a purchase affects stock.
 *
 * Everything below happens in ONE transaction - the status change, every stock
 * movement and every balance update. If any single item fails, the whole thing
 * rolls back and the purchase stays a draft with no inventory effect.
 */
export async function post(currentUser, id) {
  const { companyId } = currentUser;

  const purchase = await withRetryableTransaction(async (tx) => {
    // Locks the row. A second concurrent post waits here, then sees POSTED below.
    const locked = await purchaseRepository.lockForPosting(tx, id, companyId);

    if (!locked) throw ApiError.business(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
    if (locked.status === 'POSTED') {
      throw ApiError.business(409, 'PURCHASE_ALREADY_POSTED', 'This purchase has already been posted');
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(409, 'PURCHASE_NOT_DRAFT', 'Only a draft purchase can be posted');
    }
    if (locked.items.length === 0) {
      throw ApiError.business(422, 'PURCHASE_HAS_NO_ITEMS', 'A purchase must have at least one item');
    }

    // Master data may have been deactivated since the draft was created.
    await loadAndValidateReferences(companyId, {
      supplierId: locked.supplierId,
      warehouseId: locked.warehouseId,
      invoiceDate: locked.invoiceDate,
      items: locked.items.map((item) => ({ productId: item.productId, taxId: item.taxId })),
    });

    // The GST invariants, checked inside the transaction: components must add up
    // to the tax charged, and a document may never carry CGST/SGST and IGST at
    // the same time. A violation rolls the whole posting back.
    assertGstTotalsConsistent(locked);

    // Stock in, one movement per line, through the inventory service so the
    // moving weighted average lives in exactly one place. Each movement is kept
    // so the journal entry can be valued at what actually entered inventory,
    // rather than at a figure recomputed from the document.
    const movements = [];

    for (const item of locked.items) {
      const movement = await inventoryService.applyStockInWithinTransaction(tx, {
        currentUser,
        productId: item.productId,
        warehouseId: locked.warehouseId,
        quantity: item.quantity,
        // The price on the supplier's bill, not Product.purchasePrice.
        unitCost: item.unitCost,
        referenceType: PURCHASE_REFERENCE_TYPE,
        referenceId: locked.id,
        notes: `Purchase ${locked.purchaseNumber}`,
      });

      movements.push(movement);
    }

    // Raise what we now owe the supplier, in this same transaction. The unique
    // constraint on SupplierPayable.purchaseId makes a duplicate impossible.
    await supplierPayableService.recordPurchasePosted(tx, currentUser, locked);

    // The general ledger entry, LAST and in this same transaction. Writing it
    // last gives every document type the same lock order, so two different
    // postings can never deadlock; and if it fails, the stock movements and the
    // payable roll back with it.
    await glPostingService.recordPurchasePosted(tx, currentUser, locked, movements);

    const updated = await purchaseRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'POSTED', postedById: currentUser.id, postedAt: new Date() },
    });

    if (!updated) {
      throw ApiError.business(409, 'PURCHASE_NOT_DRAFT', 'Only a draft purchase can be posted');
    }

    return updated;
  });

  return toPublicPurchase(purchase);
}

/**
 * Cancels a DRAFT.
 *
 * A POSTED purchase cannot be cancelled in this phase: undoing it would require
 * reversing stock (which may already have been sold) and, later, reversing
 * accounting entries. That belongs to Purchase Returns.
 */
export async function cancel(currentUser, id) {
  const { companyId } = currentUser;

  const existing = await purchaseRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');

  if (existing.status === 'POSTED') {
    throw ApiError.business(
      409,
      'PURCHASE_ALREADY_POSTED',
      'A posted purchase cannot be cancelled. Use a purchase return instead.',
    );
  }
  assertIsDraft(existing);

  const purchase = await withRetryableTransaction(async (tx) =>
    purchaseRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!purchase) {
    throw ApiError.business(409, 'PURCHASE_NOT_DRAFT', 'Only a draft purchase can be cancelled');
  }

  return toPublicPurchase(purchase);
}

function assertIsDraft(purchase) {
  if (purchase.status === 'POSTED') {
    throw ApiError.business(
      409,
      'PURCHASE_ALREADY_POSTED',
      'A posted purchase is a historical document and cannot be changed',
    );
  }
  if (purchase.status !== 'DRAFT') {
    throw ApiError.business(409, 'PURCHASE_NOT_DRAFT', `This purchase is ${purchase.status.toLowerCase()}`);
  }
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await purchaseRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    purchases: items.map(toPublicPurchase),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const purchase = await purchaseRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!purchase) throw ApiError.business(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  return toPublicPurchase(purchase);
}
