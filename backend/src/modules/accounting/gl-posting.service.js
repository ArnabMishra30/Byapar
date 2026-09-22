import { add, subtract, round, toDecimal, isZero, isGreaterThan } from '../../utils/money.js';
import { SYSTEM_ACCOUNT } from './system-accounts.js';
import { SOURCE_TYPE, createPostedEntryWithinTransaction } from './journal.service.js';

// DOCUMENT -> GENERAL LEDGER.
//
// One function per document type. Each is called from INSIDE that document's own
// posting transaction, as the last step, so the business operation, the stock
// movement, the sub-ledger effect and the journal entry are one atomic unit: if
// the journal fails, the document never posts.
//
// Two rules hold everywhere in this file:
//
//  1. AMOUNTS COME FROM THE SERVER, NEVER FROM THE CLIENT. Every figure is read
//     from the posted document or from the stock movement the inventory service
//     just wrote - never from a request body, never recomputed from the product
//     master, and never re-derived with a second costing algorithm.
//
//  2. INVENTORY IS VALUED AT WHAT ACTUALLY MOVED. The inventory amount on a
//     journal is the sum of the `totalCost` of the movements this posting
//     created, so the Inventory control account and the inventory ledger cannot
//     disagree by construction - not even by a rounding unit.
//
// The builders are pure and exported so the debit/credit shape of every document
// can be unit tested without a database.

const MONEY_DP = 4;

/** Sums the totalCost of the movements a posting created. */
export function sumMovementCost(movements) {
  return movements.reduce((total, movement) => add(total, movement.totalCost), toDecimal(0));
}

function line(accountCode, side, amount, description) {
  return { accountCode, [side]: round(amount, MONEY_DP), description };
}

/** Drops nothing - it only skips components that are genuinely zero. */
function nonZero(lines) {
  return lines.filter((entry) => !isZero(entry.debit ?? 0) || !isZero(entry.credit ?? 0));
}

/**
 * The tax side of a document, as GL lines.
 *
 * A document written by a GST-enabled company carries a component split, and the
 * tax goes to Input/Output CGST, SGST, IGST and Cess. A document written before
 * GST was configured carries no split, and its tax goes to the aggregate account
 * exactly as it always did - which is why enabling GST never rewrites history.
 *
 * @param {'INPUT'|'OUTPUT'} direction  input tax is ours to reclaim, output tax
 *   is ours to remit
 * @param {'debit'|'credit'} side       reversed on a return
 */
function taxLines(direction, side, document, description) {
  const isInput = direction === 'INPUT';

  const components = [
    [isInput ? SYSTEM_ACCOUNT.INPUT_CGST : SYSTEM_ACCOUNT.OUTPUT_CGST, document.cgstTotal],
    [isInput ? SYSTEM_ACCOUNT.INPUT_SGST : SYSTEM_ACCOUNT.OUTPUT_SGST, document.sgstTotal],
    [isInput ? SYSTEM_ACCOUNT.INPUT_IGST : SYSTEM_ACCOUNT.OUTPUT_IGST, document.igstTotal],
    [isInput ? SYSTEM_ACCOUNT.INPUT_CESS : SYSTEM_ACCOUNT.OUTPUT_CESS, document.cessTotal],
  ];

  const split = components.reduce((total, [, amount]) => add(total, amount ?? 0), toDecimal(0));

  if (isZero(split)) {
    const aggregate = isInput ? SYSTEM_ACCOUNT.INPUT_TAX_CREDIT : SYSTEM_ACCOUNT.TAX_PAYABLE;
    return nonZero([line(aggregate, side, document.taxTotal ?? 0, description)]);
  }

  return nonZero(components.map(([code, amount]) => line(code, side, amount ?? 0, description)));
}

/**
 * The plug that keeps a purchase-side entry balanced.
 *
 * Inventory is capitalised at the bill's line cost, but what we owe is the line
 * cost MINUS the discount PLUS tax. That gap is a real purchase price variance,
 * and the honest place for it is its own account rather than quietly inflating
 * inventory or revenue. The same line absorbs the documented Phase 5 residue,
 * where a return leaves stock at the original purchase cost while the remaining
 * stock keeps today's average.
 */
function varianceLine(debitTotal, creditTotal, description) {
  const difference = subtract(debitTotal, creditTotal);
  if (isZero(difference)) return [];

  return isGreaterThan(difference, 0)
    ? [line(SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT, 'credit', difference, description)]
    : [line(SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT, 'debit', difference.negated(), description)];
}

// --- purchase --------------------------------------------------------------

/**
 *   Dr Inventory            what the stock movements actually capitalised
 *   Dr Input Tax Credit     the tax on the bill
 *       Cr Accounts Payable the bill total, which is what the payable was raised for
 *       Cr/Dr Inventory Valuation Adjustment   the discount, as a price variance
 */
export function buildPurchaseLines({
  inventoryValue,
  taxTotal,
  grandTotal,
  purchaseNumber,
  cgstTotal,
  sgstTotal,
  igstTotal,
  cessTotal,
}) {
  const debits = [
    ...nonZero([
      line(
        SYSTEM_ACCOUNT.INVENTORY,
        'debit',
        inventoryValue,
        `Stock received on ${purchaseNumber}`,
      ),
    ]),
    // Input GST is NOT capitalised into inventory: it is recoverable, so it is
    // its own asset rather than part of what the stock cost.
    ...taxLines(
      'INPUT',
      'debit',
      { taxTotal, cgstTotal, sgstTotal, igstTotal, cessTotal },
      `Input tax on ${purchaseNumber}`,
    ),
  ];

  const credits = nonZero([
    line(SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'credit', grandTotal, `Payable for ${purchaseNumber}`),
  ]);

  const debitTotal = add(inventoryValue, taxTotal ?? 0);
  return [
    ...debits,
    ...credits,
    ...varianceLine(debitTotal, grandTotal, `Purchase price variance on ${purchaseNumber}`),
  ];
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} purchase   the LOCKED purchase being posted
 * @param {Array<{ totalCost: any }>} movements  the stock movements just created
 */
export function recordPurchasePosted(tx, currentUser, purchase, movements) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: purchase.invoiceDate,
    description: `Purchase ${purchase.purchaseNumber}`,
    sourceType: SOURCE_TYPE.PURCHASE,
    sourceId: purchase.id,
    lines: buildPurchaseLines({
      inventoryValue: sumMovementCost(movements),
      taxTotal: purchase.taxTotal,
      grandTotal: purchase.grandTotal,
      purchaseNumber: purchase.purchaseNumber,
      cgstTotal: purchase.cgstTotal,
      sgstTotal: purchase.sgstTotal,
      igstTotal: purchase.igstTotal,
      cessTotal: purchase.cessTotal,
    }),
  });
}

// --- purchase return -------------------------------------------------------

/**
 *   Dr Accounts Payable   the supplier credit, exactly what the sub-ledger used
 *       Cr Inventory      what the stock movements actually removed
 *
 * No tax is reversed: a purchase return carries no tax in the operational model.
 * See the known limitations.
 */
export function buildPurchaseReturnLines({
  inventoryValue,
  grandTotal,
  returnNumber,
  taxTotal,
  cgstTotal,
  sgstTotal,
  igstTotal,
  cessTotal,
}) {
  const lines = [
    ...nonZero([
      line(
        SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE,
        'debit',
        grandTotal,
        `Supplier credit for ${returnNumber}`,
      ),
      line(SYSTEM_ACCOUNT.INVENTORY, 'credit', inventoryValue, `Stock returned on ${returnNumber}`),
    ]),
    // The input credit we claimed on these goods is given back.
    ...taxLines(
      'INPUT',
      'credit',
      { taxTotal, cgstTotal, sgstTotal, igstTotal, cessTotal },
      `Input tax reversed on ${returnNumber}`,
    ),
  ];

  return [
    ...lines,
    ...varianceLine(
      grandTotal,
      add(inventoryValue, taxTotal ?? 0),
      `Return valuation difference on ${returnNumber}`,
    ),
  ];
}

export function recordPurchaseReturnPosted(tx, currentUser, purchaseReturn, movements) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: purchaseReturn.returnDate,
    description: `Purchase return ${purchaseReturn.returnNumber}`,
    sourceType: SOURCE_TYPE.PURCHASE_RETURN,
    sourceId: purchaseReturn.id,
    lines: buildPurchaseReturnLines({
      inventoryValue: sumMovementCost(movements),
      grandTotal: purchaseReturn.grandTotal,
      returnNumber: purchaseReturn.returnNumber,
      taxTotal: purchaseReturn.taxTotal,
      cgstTotal: purchaseReturn.cgstTotal,
      sgstTotal: purchaseReturn.sgstTotal,
      igstTotal: purchaseReturn.igstTotal,
      cessTotal: purchaseReturn.cessTotal,
    }),
  });
}

// --- supplier payment ------------------------------------------------------

/** CASH goes to Cash; every other method goes to Bank. */
export function cashOrBankAccount(paymentMethod) {
  return paymentMethod === 'CASH' ? SYSTEM_ACCOUNT.CASH : SYSTEM_ACCOUNT.BANK;
}

/**
 *   Dr Accounts Payable       what this payment settled against bills
 *   Dr Advance to Suppliers   the unallocated remainder, which is a real advance
 *       Cr Bank / Cash        the full amount that left the business
 */
export function buildSupplierPaymentLines({
  allocatedAmount,
  unallocatedAmount,
  amount,
  paymentMethod,
  paymentNumber,
}) {
  return nonZero([
    line(SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'debit', allocatedAmount, `Bills settled by ${paymentNumber}`),
    line(
      SYSTEM_ACCOUNT.ADVANCE_TO_SUPPLIERS,
      'debit',
      unallocatedAmount,
      `Advance on ${paymentNumber}`,
    ),
    line(cashOrBankAccount(paymentMethod), 'credit', amount, `Payment ${paymentNumber}`),
  ]);
}

export function recordSupplierPaymentPosted(tx, currentUser, payment) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: payment.paymentDate,
    description: `Supplier payment ${payment.paymentNumber}`,
    sourceType: SOURCE_TYPE.SUPPLIER_PAYMENT,
    sourceId: payment.id,
    lines: buildSupplierPaymentLines(payment),
  });
}

// --- sales invoice ---------------------------------------------------------

/**
 * TWO effects, ONE entry - so "exactly one journal entry per source document"
 * stays true and both halves commit together:
 *
 *   Dr Accounts Receivable    the invoice total
 *       Cr Sales Revenue      the total net of tax (= subtotal - discount)
 *       Cr Tax Payable        the tax charged
 *
 *   Dr Cost of Goods Sold     the FROZEN cost the stock actually left at
 *       Cr Inventory          the same figure
 *
 * Revenue is derived as grandTotal - taxTotal rather than as
 * subtotal - discountTotal. They are arithmetically the same number, but the
 * first form cannot drift from the receivable by a rounding unit, so the entry
 * balances by construction instead of by luck.
 */
export function buildSalesLines({
  grandTotal,
  taxTotal,
  cogsValue,
  invoiceNumber,
  cgstTotal,
  sgstTotal,
  igstTotal,
  cessTotal,
}) {
  const revenue = subtract(grandTotal, taxTotal ?? 0);

  return [
    ...nonZero([
      line(
        SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE,
        'debit',
        grandTotal,
        `Receivable for ${invoiceNumber}`,
      ),
      line(SYSTEM_ACCOUNT.SALES_REVENUE, 'credit', revenue, `Revenue on ${invoiceNumber}`),
    ]),
    // Output GST is collected on the government's behalf: a liability, never
    // revenue.
    ...taxLines(
      'OUTPUT',
      'credit',
      { taxTotal, cgstTotal, sgstTotal, igstTotal, cessTotal },
      `Output tax on ${invoiceNumber}`,
    ),
    ...nonZero([
      line(SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD, 'debit', cogsValue, `COGS on ${invoiceNumber}`),
      line(SYSTEM_ACCOUNT.INVENTORY, 'credit', cogsValue, `Stock issued on ${invoiceNumber}`),
    ]),
  ];
}

/**
 * @param {Array<{ totalCost: any }>} movements the stock-out movements just created.
 *   Their totalCost IS the frozen COGS: the inventory service valued them at the
 *   moving average of the moment, and the invoice line was frozen from the same
 *   movement. Nothing here recalculates a cost.
 */
export function recordSalePosted(tx, currentUser, sale, movements) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: sale.invoiceDate,
    description: `Sales invoice ${sale.invoiceNumber}`,
    sourceType: SOURCE_TYPE.SALES_INVOICE,
    sourceId: sale.id,
    lines: buildSalesLines({
      grandTotal: sale.grandTotal,
      taxTotal: sale.taxTotal,
      cogsValue: sumMovementCost(movements),
      invoiceNumber: sale.invoiceNumber,
      cgstTotal: sale.cgstTotal,
      sgstTotal: sale.sgstTotal,
      igstTotal: sale.igstTotal,
      cessTotal: sale.cessTotal,
    }),
  });
}

// --- sales return ----------------------------------------------------------

/**
 *   Dr Sales Returns          contra-revenue, the credit note net of tax
 *   Dr Tax Payable            the output tax being given back
 *       Cr Accounts Receivable the credit note total
 *
 *   Dr Inventory              stock back at the FROZEN cost from the sale
 *       Cr Cost of Goods Sold  the same figure
 */
export function buildSalesReturnLines({
  grandTotal,
  taxTotal,
  cogsValue,
  returnNumber,
  cgstTotal,
  sgstTotal,
  igstTotal,
  cessTotal,
}) {
  const revenueReversal = subtract(grandTotal, taxTotal ?? 0);

  return [
    ...nonZero([
      line(SYSTEM_ACCOUNT.SALES_RETURNS, 'debit', revenueReversal, `Credit note ${returnNumber}`),
    ]),
    // The output tax charged on the original invoice is handed back.
    ...taxLines(
      'OUTPUT',
      'debit',
      { taxTotal, cgstTotal, sgstTotal, igstTotal, cessTotal },
      `Output tax reversed on ${returnNumber}`,
    ),
    ...nonZero([
      line(
        SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE,
        'credit',
        grandTotal,
        `Customer credited by ${returnNumber}`,
      ),
      line(SYSTEM_ACCOUNT.INVENTORY, 'debit', cogsValue, `Stock returned on ${returnNumber}`),
      line(
        SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,
        'credit',
        cogsValue,
        `COGS reversed on ${returnNumber}`,
      ),
    ]),
  ];
}

export function recordSalesReturnPosted(tx, currentUser, salesReturn, movements) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: salesReturn.returnDate,
    description: `Sales return ${salesReturn.returnNumber}`,
    sourceType: SOURCE_TYPE.SALES_RETURN,
    sourceId: salesReturn.id,
    lines: buildSalesReturnLines({
      grandTotal: salesReturn.grandTotal,
      taxTotal: salesReturn.taxTotal,
      cogsValue: sumMovementCost(movements),
      returnNumber: salesReturn.returnNumber,
      cgstTotal: salesReturn.cgstTotal,
      sgstTotal: salesReturn.sgstTotal,
      igstTotal: salesReturn.igstTotal,
      cessTotal: salesReturn.cessTotal,
    }),
  });
}

// --- customer payment ------------------------------------------------------

/**
 *   Dr Bank / Cash               the money that arrived
 *       Cr Accounts Receivable   what it settled against invoices
 *       Cr Customer Advances     the unallocated remainder, a liability to them
 */
export function buildCustomerPaymentLines({
  allocatedAmount,
  unallocatedAmount,
  amount,
  paymentMethod,
  paymentNumber,
}) {
  return nonZero([
    line(cashOrBankAccount(paymentMethod), 'debit', amount, `Receipt ${paymentNumber}`),
    line(
      SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE,
      'credit',
      allocatedAmount,
      `Invoices settled by ${paymentNumber}`,
    ),
    line(
      SYSTEM_ACCOUNT.CUSTOMER_ADVANCES,
      'credit',
      unallocatedAmount,
      `Advance on ${paymentNumber}`,
    ),
  ]);
}

export function recordCustomerPaymentPosted(tx, currentUser, payment) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: payment.paymentDate,
    description: `Customer payment ${payment.paymentNumber}`,
    sourceType: SOURCE_TYPE.CUSTOMER_PAYMENT,
    sourceId: payment.id,
    lines: buildCustomerPaymentLines(payment),
  });
}

// --- expense ---------------------------------------------------------------

/**
 *   Dr Expense category   the amount
 *       Cr Cash / Bank    the same amount
 *
 * Two lines, always balanced, always the same figure on both sides. There is no
 * discount, no tax and no variance on an expense: it is the simplest document in
 * the system, and that is the point.
 *
 * The category line names its account by ID rather than by code, because the
 * category may be an account the business created itself. The payment line names
 * its account by ID too, so a company with a second bank account can pay from it.
 */
export function buildExpenseLines({
  amount,
  expenseAccountId,
  paymentAccountId,
  expenseNumber,
  categoryName,
}) {
  return nonZero([
    {
      accountId: expenseAccountId,
      debit: round(amount, MONEY_DP),
      description: `${categoryName} - ${expenseNumber}`,
    },
    {
      accountId: paymentAccountId,
      credit: round(amount, MONEY_DP),
      description: `Paid for ${expenseNumber}`,
    },
  ]);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} expense the LOCKED expense being posted
 */
export function recordExpensePosted(tx, currentUser, expense) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: expense.expenseDate,
    description: `Expense ${expense.expenseNumber} - ${expense.categoryNameSnapshot}`,
    sourceType: SOURCE_TYPE.EXPENSE,
    sourceId: expense.id,
    lines: buildExpenseLines({
      amount: expense.amount,
      expenseAccountId: expense.expenseAccountId,
      paymentAccountId: expense.paymentAccountId,
      expenseNumber: expense.expenseNumber,
      categoryName: expense.categoryNameSnapshot,
    }),
  });
}

/**
 * Undoes a posted expense with a NEW entry that swaps the two sides.
 *
 *   Dr Cash / Bank
 *       Cr Expense category
 *
 * The original posting is never touched. Idempotency is structural: the reversal
 * is stored as sourceType EXPENSE_REVERSAL with the expense's own id, and
 * (companyId, sourceType, sourceId) is unique - so a second reversal of the same
 * expense cannot exist even if two requests arrive together.
 */
export function recordExpenseReversed(tx, currentUser, expense, originalEntry) {
  return createPostedEntryWithinTransaction(tx, currentUser, {
    entryDate: expense.expenseDate,
    description: `Reversal of expense ${expense.expenseNumber}`,
    sourceType: SOURCE_TYPE.EXPENSE_REVERSAL,
    sourceId: expense.id,
    reversalOfId: originalEntry?.id ?? null,
    lines: nonZero([
      {
        accountId: expense.paymentAccountId,
        debit: round(expense.amount, MONEY_DP),
        description: `Reversal of ${expense.expenseNumber}`,
      },
      {
        accountId: expense.expenseAccountId,
        credit: round(expense.amount, MONEY_DP),
        description: `${expense.categoryNameSnapshot} reversed - ${expense.expenseNumber}`,
      },
    ]),
  });
}
