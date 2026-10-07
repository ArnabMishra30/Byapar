import { ApiError } from '../../utils/api-error.js';
import * as offerService from '../offers/offer.service.js';
import { ownRecordsFilter, hasShopPermission } from '../users/shop-permissions.js';
import { assertLocationInWarehouse } from '../storage-locations/storage-location.service.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, multiply, round, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
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
    storageLocationId: item.storageLocationId ?? null,
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
    // Set when the line went out at a price other than the product's own.
    listPrice: item.listPriceSnapshot == null ? null : toMoneyString(item.listPriceSnapshot, 2),
    // A free line, and whether a saved offer gave it.
    isFree: Boolean(item.isFree),
    offer: item.offer ? { id: item.offer.id, name: item.offer.name } : null,
    priceChanged:
      !item.isFree &&
      item.listPriceSnapshot != null && !toDecimal(item.listPriceSnapshot).equals(toDecimal(item.unitPrice).toDecimalPlaces(MONEY_DP)),
    // What a combo line took out of stock (empty for ordinary lines and drafts).
    components: (item.components ?? []).map((c) => ({
      productId: c.productId,
      name: c.productNameSnapshot,
      quantityPerUnit: toMoneyString(c.quantityPerUnit, 3),
      quantity: toMoneyString(c.quantity, 3),
    })),
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
/**
 * A discount, or a price below the product's selling price, needs the
 * SALES_DISCOUNT permission. The owner always has it; a cashier only if given.
 */
function assertDiscountAllowed(currentUser, resolvedItems) {
  if (hasShopPermission(currentUser, 'SALES_DISCOUNT')) return;
  for (const { input, product, index } of resolvedItems) {
    // A free item from a saved offer was the owner's decision, not the cashier's.
    if (input.isFree && input.offerId) continue;
    if (input.isFree) {
      throw ApiError.business(
        403,
        'DISCOUNT_NOT_ALLOWED',
        `Item ${index + 1}: you are not allowed to give items free. Ask the owner.`,
      );
    }
    const discounted = input.discountType && input.discountType !== 'NONE' && Number(input.discountValue ?? 0) > 0;
    const listPrice = toDecimal(product.sellingPrice ?? 0);
    const underPriced = listPrice.greaterThan(0) && toDecimal(input.unitPrice).lessThan(listPrice);
    if (discounted || underPriced) {
      throw ApiError.business(
        403,
        'DISCOUNT_NOT_ALLOWED',
        `Item ${index + 1}: you are not allowed to give a discount or sell below the price. Ask the owner.`,
      );
    }
  }
}

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

    // A rack chosen for the line must be one of this store's own.
    if (item.storageLocationId) {
      await assertLocationInWarehouse(companyId, input.warehouseId, item.storageLocationId);
    }

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
  const calculated = resolvedItems.map(({ input, product, tax: lineTax, index }) => {
    const tax = input.isFree ? null : lineTax;
    const taxRate = tax ? tax.rate.toString() : null;
    const gst = buildLineGst(tax, gstContext);

    // A free line is free: price 0, no discount, no tax.
    const free = Boolean(input.isFree);
    const amounts = calculateSalesLine({
      quantity: input.quantity,
      unitPrice: free ? '0' : input.unitPrice,
      discountType: free ? 'NONE' : input.discountType,
      discountValue: free ? undefined : input.discountValue,
      taxRate,
      index,
      gst,
    });

    return {
      row: {
        lineNumber: index + 1,
        productId: product.id,
        storageLocationId: input.storageLocationId ?? null,
        taxId: tax ? tax.id : null,
        quantity: round(input.quantity, QUANTITY_DP),
        unitPrice: free ? 0 : round(input.unitPrice, MONEY_DP),
        isFree: free,
        offerId: free ? input.offerId ?? null : null,
        // The product's own price at the time, so a changed price is visible later.
        listPriceSnapshot: round(product.sellingPrice ?? 0, MONEY_DP),
        discountType: free ? 'NONE' : input.discountType,
        discountValue: free ? 0 : round(input.discountValue ?? 0, MONEY_DP),
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


// --- combos ------------------------------------------------------------------

/** productId -> contents, for the combo products among these lines. */
async function loadComboContents(tx, companyId, items) {
  const rows = await tx.comboComponent.findMany({
    where: { companyId, comboProductId: { in: items.map((item) => item.productId) } },
    select: {
      comboProductId: true,
      quantity: true,
      component: { select: { id: true, name: true } },
    },
    orderBy: { component: { name: 'asc' } },
  });
  const byCombo = new Map();
  for (const row of rows) {
    if (!byCombo.has(row.comboProductId)) byCombo.set(row.comboProductId, []);
    byCombo.get(row.comboProductId).push(row);
  }
  return byCombo;
}

/**
 * Takes one combo line's contents out of stock and freezes what left.
 *
 * Each content is checked and moved like an ordinary line (balance locked,
 * moving-average cost), labelled with the combo so the stock ledger reads
 * "Sales invoice INV-12 - Diwali Pack". What left is written to
 * SalesInvoiceItemComponent so a return can put back exactly that, at that cost.
 */
async function postComboLine(tx, currentUser, invoice, item, contents, movements) {
  const { companyId } = currentUser;
  let lineCost = toDecimal(0);

  for (const content of contents) {
    const quantity = round(multiply(item.quantity, content.quantity), QUANTITY_DP);
    const balance = await inventoryRepository.lockBalance(tx, companyId, content.component.id, invoice.warehouseId);
    const available = balance ? balance.quantity : toDecimal(0);
    if (isGreaterThan(quantity, available)) {
      throw ApiError.business(
        422,
        'SALE_INSUFFICIENT_STOCK',
        `${content.component.name} (in ${item.productNameSnapshot}): only ${toMoneyString(available, 3)} in stock, ${toMoneyString(quantity, 3)} needed`,
      );
    }

    const movement = await inventoryService.applyStockOutWithinTransaction(tx, {
      currentUser,
      productId: content.component.id,
      warehouseId: invoice.warehouseId,
      quantity,
      referenceType: SALES_REFERENCE_TYPE,
      referenceId: invoice.id,
      notes: `Sales invoice ${invoice.invoiceNumber} - ${item.productNameSnapshot}`,
      storageLocationId: null,
    });
    movements.push(movement);
    lineCost = add(lineCost, movement.totalCost);

    await tx.salesInvoiceItemComponent.create({
      data: {
        companyId,
        salesInvoiceItemId: item.id,
        productId: content.component.id,
        productNameSnapshot: content.component.name,
        quantityPerUnit: content.quantity,
        quantity,
        cogsUnitCost: movement.unitCost,
        cogsAmount: movement.totalCost,
      },
    });
  }

  return {
    cogsUnitCost: round(toDecimal(lineCost).div(item.quantity), MONEY_DP),
    cogsAmount: round(lineCost, MONEY_DP),
  };
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT. Deliberately has NO stock, receivable or ledger effect. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  const { customer, warehouse, resolvedItems: typed } = await loadAndValidateReferences(companyId, input);
  // Saved offers add their free lines here, worked out on the server.
  const resolvedItems = await offerService.applyOffers(companyId, input.invoiceDate, typed, (id) =>
    productRepository.findByIdAndCompany(id, companyId),
  );
  assertDiscountAllowed(currentUser, resolvedItems);

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
  // A biller who sees only their own bills cannot act on anyone else's.
  if (ownRecordsFilter(currentUser)) await getById(currentUser, id);

  const existing = await salesRepository.findByIdAndCompany(id, companyId);
  if (!existing) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
  assertIsDraft(existing);

  const { customer, warehouse, resolvedItems: typed } = await loadAndValidateReferences(companyId, input);
  // Saved offers add their free lines here, worked out on the server.
  const resolvedItems = await offerService.applyOffers(companyId, input.invoiceDate, typed, (id) =>
    productRepository.findByIdAndCompany(id, companyId),
  );
  assertDiscountAllowed(currentUser, resolvedItems);
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
  // A biller who sees only their own bills cannot act on anyone else's.
  if (ownRecordsFilter(currentUser)) await getById(currentUser, id);

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

    // The contents of every combo on this invoice, read inside the transaction.
    const comboContents = await loadComboContents(tx, companyId, locked.items);

    for (const item of locked.items) {
      // A COMBO holds no stock: each of its contents leaves the stock ledger on
      // its own, and the line's cost is what those movements cost.
      const contents = comboContents.get(item.productId);
      if (contents) {
        const comboCogs = await postComboLine(tx, currentUser, locked, item, contents, movements);
        await salesRepository.setItemCogs(tx, item.id, comboCogs);
        cogsTotal = add(cogsTotal, comboCogs.cogsAmount);
        continue;
      }

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
        storageLocationId: item.storageLocationId ?? null,
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
  // A biller who sees only their own bills cannot act on anyone else's.
  if (ownRecordsFilter(currentUser)) await getById(currentUser, id);

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
    createdById: ownRecordsFilter(currentUser) ?? undefined,
  });

  return {
    sales: items.map(toPublicSale),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const sale = await salesRepository.findByIdAndCompany(id, currentUser.companyId);
  const own = ownRecordsFilter(currentUser);
  if (!sale || (own && sale.createdBy?.id !== own)) {
    throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
  }
  return toPublicSale(sale);
}
