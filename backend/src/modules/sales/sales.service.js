import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, round, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import { calculateSalesLine, calculateSalesTotals, calculateCogs } from './sales.calculator.js';
import * as salesRepository from './sales.repository.js';
import * as customerRepository from '../customers/customer.repository.js';
import * as warehouseRepository from '../warehouses/warehouse.repository.js';
import * as productRepository from '../products/product.repository.js';
import * as taxRepository from '../taxes/tax.repository.js';
import * as inventoryRepository from '../inventory/inventory.repository.js';
import * as inventoryService from '../inventory/inventory.service.js';
import * as customerReceivableService from '../customer-receivables/customer-receivable.service.js';
import * as creditRepository from '../credit/credit.repository.js';
import { assertWithinCreditLimit } from '../credit/credit-limit.service.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import * as gstContextService from '../tax/gst-context.service.js';
import { assertGstTotalsConsistent } from '../tax/gst.calculator.js';
import {
  buildLineGst,
  buildLineTaxSnapshot,
  assertLineTaxUsable,
} from '../tax/gst-line.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';

// Sales invoice business rules. No Prisma calls here.
//
// THE CENTRAL RULE, same as purchases:
//   Creating or editing an invoice NEVER touches stock or a balance.
//   Only posting does, and posting happens in ONE transaction covering the stock
//   movements, the frozen COGS, the receivable and the ledger entry.
//
// SELLING PRICE IS NOT COST. `unitPrice` is what the customer pays; COGS is the
// inventory moving average at the moment the stock left, read back from the
// movement the inventory service created and frozen onto the line forever.

export const SALES_REFERENCE_TYPE = 'SALES_INVOICE';

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
    productId: item.productId,
    productName: item.productNameSnapshot,
    sku: item.skuSnapshot,
    unitName: item.unitNameSnapshot,
    taxId: item.taxId,
    taxName: item.taxNameSnapshot,
    taxRate: item.taxRateSnapshot === null ? null : toMoneyString(item.taxRateSnapshot, 2),
    quantity: toMoneyString(item.quantity, 3),
    unitPrice: toMoneyString(item.unitPrice, 4),
    discountType: item.discountType,
    discountValue: toMoneyString(item.discountValue, 4),
    discountAmount: toMoneyString(item.discountAmount, 2),
    taxableAmount: toMoneyString(item.taxableAmount, 2),
    taxAmount: toMoneyString(item.taxAmount, 2),
    lineTotal: toMoneyString(item.lineTotal, 2),
    // Zero until the invoice is posted.
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

export function toPublicSale(sale) {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    status: sale.status,
    customer: {
      id: sale.customer.id,
      // The snapshot, so an old invoice keeps the name it was raised with.
      name: sale.customerNameSnapshot,
      currentName: sale.customer.name,
    },
    warehouse: { id: sale.warehouse.id, name: sale.warehouse.name, code: sale.warehouse.code },
    invoiceDate: toBusinessDate(sale.invoiceDate),
    dueDate: toBusinessDate(sale.dueDate),

    // Set only when an admin knowingly posted past the customer's credit limit.
    // Null on every ordinary invoice, which is almost all of them.
    creditLimitOverride: sale.creditLimitOverride
      ? {
          reason: sale.creditLimitOverrideReason,
          // What the customer owed at the moment the call was made, frozen.
          outstandingAtOverride: toMoneyString(sale.creditLimitOverrideExposure ?? 0, 2),
        }
      : null,
    subtotal: toMoneyString(sale.subtotal, 2),
    discountTotal: toMoneyString(sale.discountTotal, 2),
    taxTotal: toMoneyString(sale.taxTotal, 2),
    grandTotal: toMoneyString(sale.grandTotal, 2),
    cogsTotal: toMoneyString(sale.cogsTotal, 2),
    gst: gstContextService.toPublicGstBlock(sale),
    taxBreakup: {
      cgst: toMoneyString(sale.cgstTotal, 2),
      sgst: toMoneyString(sale.sgstTotal, 2),
      igst: toMoneyString(sale.igstTotal, 2),
      cess: toMoneyString(sale.cessTotal, 2),
    },
    // Revenue net of tax, minus what the goods cost. Derived, never stored.
    grossMargin: toMoneyString(
      toDecimal(sale.subtotal).minus(sale.discountTotal).minus(sale.cogsTotal),
      2,
    ),
    notes: sale.notes,
    items: sale.items ? sale.items.map(toPublicItem) : undefined,
    createdBy: sale.createdBy ? { id: sale.createdBy.id, name: sale.createdBy.name } : null,
    postedBy: sale.postedBy ? { id: sale.postedBy.id, name: sale.postedBy.name } : null,
    postedAt: sale.postedAt,
    cancelledBy: sale.cancelledBy ? { id: sale.cancelledBy.id, name: sale.cancelledBy.name } : null,
    cancelledAt: sale.cancelledAt,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
  };
}

// --- validation ------------------------------------------------------------

/**
 * Loads and checks every master record the invoice refers to.
 *
 * Runs at draft creation, at draft update AND again at posting, because a
 * customer, warehouse, product or tax can be deactivated in between.
 */
// --- credit terms ----------------------------------------------------------

/**
 * The due date an invoice carries.
 *
 * An explicit date always wins: someone typed it, and terms are a default, not a
 * rule. Otherwise, if the customer has payment terms recorded, the date is
 * derived from them - which is what lets a business stop typing a date on every
 * invoice and still get honest overdue reporting.
 *
 * With neither, the invoice stays undated. An undated invoice is outstanding but
 * never overdue: nobody agreed a date, so nothing has been missed.
 */
export function resolveDueDate({ invoiceDate, dueDate, creditDays }) {
  if (dueDate) return dueDate;
  if (creditDays === null || creditDays === undefined) return null;

  const derived = new Date(invoiceDate);
  derived.setUTCDate(derived.getUTCDate() + creditDays);
  return derived;
}

async function loadAndValidateReferences(companyId, input) {
  const [customer, warehouse] = await Promise.all([
    customerRepository.findByIdAndCompany(input.customerId, companyId),
    warehouseRepository.findByIdAndCompany(input.warehouseId, companyId),
  ]);

  // Another company's id is reported exactly like a non-existent one.
  if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  if (!customer.isActive) {
    throw ApiError.business(422, 'CUSTOMER_INACTIVE', `Customer "${customer.name}" is inactive`);
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
      if (!tax) throw ApiError.business(404, 'TAX_NOT_FOUND', `Item ${index + 1}: tax not found`);
      if (!tax.isActive) {
        throw ApiError.business(422, 'TAX_INACTIVE', `Item ${index + 1}: tax "${tax.name}" is inactive`);
      }
    }

    // The rate's effective window and the product's HSN/SAC, checked against the
    // invoice's own date rather than against today.
    assertLineTaxUsable(product, tax, input.invoiceDate, `Item ${index + 1}`);

    resolvedItems.push({ input: item, product, tax, index });
  }

  return { customer, warehouse, resolvedItems };
}

/**
 * Turns validated input into the rows to store, with totals and snapshots.
 *
 * @param {object} gstContext resolved once for the whole invoice; decides
 *   whether each line is taxed as CGST+SGST or as IGST.
 */
function buildItemRows(resolvedItems, gstContext) {
  const calculated = resolvedItems.map(({ input, product, tax, index }) => {
    const taxRate = tax ? tax.rate.toString() : null;
    const gst = buildLineGst(tax, gstContext);

    const amounts = calculateSalesLine({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
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
        quantity: round(input.quantity, QUANTITY_DP),
        unitPrice: round(input.unitPrice, MONEY_DP),
        discountType: input.discountType,
        discountValue: round(input.discountValue ?? 0, MONEY_DP),
        discountAmount: amounts.discountAmount,
        taxableAmount: amounts.taxableAmount,
        taxAmount: amounts.taxAmount,
        lineTotal: amounts.lineTotal,
        // COGS is resolved at posting, from the inventory movement.
        cogsUnitCost: 0,
        cogsAmount: 0,
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
    totals: calculateSalesTotals(calculated.map((entry) => entry.amounts)),
  };
}

function assertIsDraft(sale) {
  if (sale.status === 'POSTED') {
    throw ApiError.business(
      409,
      'SALE_ALREADY_POSTED',
      'A posted sales invoice is a historical document and cannot be changed',
    );
  }
  if (sale.status !== 'DRAFT') {
    throw ApiError.business(409, 'SALE_NOT_DRAFT', `This invoice is ${sale.status.toLowerCase()}`);
  }
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT. Deliberately has NO stock, receivable or ledger effect. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  const { customer, warehouse, resolvedItems } = await loadAndValidateReferences(companyId, input);

  // Where we are supplying from and to. Frozen onto the invoice: a customer who
  // moves state next year must not change the tax on this year's invoice.
  const gstContext = await gstContextService.resolveSalesContext(currentUser, {
    customer,
    warehouse,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode ?? null,
  });
  const { rows, totals } = buildItemRows(resolvedItems, gstContext);

  const sale = await withRetryableTransaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.SALES_INVOICE,
      prefix: 'INV',
      date: input.invoiceDate,
    });

    return salesRepository.createDraft(tx, {
      salesInvoice: {
        companyId,
        customerId: input.customerId,
        warehouseId: input.warehouseId,
        invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: resolveDueDate({
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          creditDays: customer.creditDays,
        }),
        status: 'DRAFT',
        customerNameSnapshot: customer.name,
        notes: input.notes ?? null,
        createdById: currentUser.id,
        ...gstContextService.toDocumentColumns(gstContext),
        ...totals,
      },
      items: rows,
    });
  });

  return toPublicSale(sale);
}

/** Replaces a draft's contents. Only DRAFT invoices can be edited. */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await salesRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
  assertIsDraft(existing);

  const { customer, warehouse, resolvedItems } = await loadAndValidateReferences(companyId, input);
  const gstContext = await gstContextService.resolveSalesContext(currentUser, {
    customer,
    warehouse,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode ?? null,
  });
  const { rows, totals } = buildItemRows(resolvedItems, gstContext);

  const sale = await withRetryableTransaction(async (tx) =>
    salesRepository.updateDraft(tx, {
      id,
      companyId,
      salesInvoice: {
        customerId: input.customerId,
        warehouseId: input.warehouseId,
        invoiceDate: input.invoiceDate,
        dueDate: resolveDueDate({
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          creditDays: customer.creditDays,
        }),
        customerNameSnapshot: customer.name,
        notes: input.notes ?? null,
        ...gstContextService.toDocumentColumns(gstContext),
        ...totals,
      },
      items: rows,
    }),
  );

  if (!sale) {
    throw ApiError.business(409, 'SALE_NOT_DRAFT', 'Only a draft sales invoice can be edited');
  }

  return toPublicSale(sale);
}

/**
 * Posts the invoice: the one place a sale affects stock and balances.
 *
 * One transaction covers all of it. Lock order is invoice -> inventory balances
 * (in line order) -> receivable, the same outward order purchases use, so the
 * two document types cannot deadlock against each other.
 */
export async function post(currentUser, id, options = {}) {
  const { companyId } = currentUser;

  const sale = await withRetryableTransaction(async (tx) => {
    const locked = await salesRepository.lockForPosting(tx, id, companyId);

    if (!locked) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
    if (locked.status === 'POSTED') {
      throw ApiError.business(409, 'SALE_ALREADY_POSTED', 'This invoice has already been posted');
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(409, 'SALE_NOT_DRAFT', 'Only a draft sales invoice can be posted');
    }
    if (locked.items.length === 0) {
      throw ApiError.business(422, 'SALE_HAS_NO_ITEMS', 'A sales invoice must have at least one item');
    }

    // Master data may have been deactivated since the draft was created.
    await loadAndValidateReferences(companyId, {
      customerId: locked.customerId,
      warehouseId: locked.warehouseId,
      invoiceDate: locked.invoiceDate,
      items: locked.items.map((item) => ({ productId: item.productId, taxId: item.taxId })),
    });

    // The GST invariants, inside the transaction. A violation rolls back the
    // stock movements and the receivable along with the invoice.
    assertGstTotalsConsistent(locked);

    // THE CREDIT LIMIT, checked under a lock on the customer row.
    //
    // The lock is what makes the rule hold: without it two invoices for the same
    // customer posting at once would both read the same balance, both find room
    // under the limit, and both commit - leaving the customer over their limit
    // with neither posting individually at fault.
    //
    // Taken here, BEFORE any inventory lock, so the order across every sales
    // posting is total: invoice -> customer -> stock -> journal. No other flow
    // locks a customer row, so no cycle with another document type is possible.
    const lockedCustomer = await creditRepository.lockCustomerForCredit(
      tx,
      locked.customerId,
      companyId,
    );

    if (!lockedCustomer) {
      throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const credit = await assertWithinCreditLimit(tx, {
      companyId,
      customer: lockedCustomer,
      invoiceTotal: locked.grandTotal,
      invoiceNumber: locked.invoiceNumber,
      override: options.creditLimitOverride === true,
    });

    let cogsTotal = toDecimal(0);
    // Kept so the journal is valued at what actually left inventory - the same
    // frozen cost written onto the invoice line, never a recomputed average.
    const movements = [];

    for (const item of locked.items) {
      // Lock the balance before checking it, so the check and the deduction
      // cannot be separated by another transaction, and so the failure carries a
      // sales-specific error code rather than the generic inventory one.
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
          'SALE_INSUFFICIENT_STOCK',
          `${item.productNameSnapshot}: only ${toMoneyString(available, 3)} in stock, ${toMoneyString(item.quantity, 3)} requested`,
        );
      }

      // No cost override: stock leaves at the CURRENT moving average, which is
      // exactly what COGS should be.
      const movement = await inventoryService.applyStockOutWithinTransaction(tx, {
        currentUser,
        productId: item.productId,
        warehouseId: locked.warehouseId,
        quantity: item.quantity,
        referenceType: SALES_REFERENCE_TYPE,
        referenceId: locked.id,
        notes: `Sales invoice ${locked.invoiceNumber}`,
      });

      // Freeze what it actually cost, read back from the movement. Later
      // purchases will move the average; these numbers must not move with it.
      const cogs = calculateCogs(item.quantity, movement.unitCost);
      await salesRepository.setItemCogs(tx, item.id, cogs);
      cogsTotal = add(cogsTotal, cogs.cogsAmount);
      movements.push(movement);
    }

    // Raise what the customer now owes, in this same transaction.
    await customerReceivableService.recordSalePosted(tx, currentUser, locked);

    // The general ledger entry, last and in this same transaction: revenue and
    // the receivable, plus COGS against inventory at the frozen cost.
    await glPostingService.recordSalePosted(tx, currentUser, locked, movements);

    const updated = await salesRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: {
        status: 'POSTED',
        postedById: currentUser.id,
        postedAt: new Date(),
        cogsTotal: round(cogsTotal, MONEY_DP),
        // An override is a decision someone made, so it is recorded with who
        // made it and what was owed at that moment. The live balance moves
        // afterwards; what was known when the call was made must not.
        ...(credit.overridden
          ? {
              creditLimitOverride: true,
              creditLimitOverrideById: currentUser.id,
              creditLimitOverrideReason: options.creditLimitOverrideReason ?? null,
              creditLimitOverrideExposure: round(credit.position.outstanding, MONEY_DP),
            }
          : {}),
      },
    });

    if (!updated) {
      throw ApiError.business(409, 'SALE_NOT_DRAFT', 'Only a draft sales invoice can be posted');
    }

    return updated;
  });

  return toPublicSale(sale);
}

/**
 * Cancels a DRAFT.
 *
 * A POSTED invoice cannot be cancelled: the stock has gone, the customer owes
 * money and the COGS is recorded. Reversing that is a sales return, which is a
 * later phase.
 */
export async function cancel(currentUser, id) {
  const { companyId } = currentUser;

  const existing = await salesRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');

  if (existing.status === 'POSTED') {
    throw ApiError.business(
      409,
      'SALE_ALREADY_POSTED',
      'A posted sales invoice cannot be cancelled. Use a sales return instead.',
    );
  }
  assertIsDraft(existing);

  const sale = await withRetryableTransaction(async (tx) =>
    salesRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!sale) {
    throw ApiError.business(409, 'SALE_NOT_DRAFT', 'Only a draft sales invoice can be cancelled');
  }

  return toPublicSale(sale);
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await salesRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    sales: items.map(toPublicSale),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const sale = await salesRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!sale) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
  return toPublicSale(sale);
}
