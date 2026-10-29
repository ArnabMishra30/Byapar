import { prisma } from '../../config/prisma.js';

// READS FOR THE UNIFIED PARTY STATEMENT.
//
// The statement is built from the customer and supplier SUB-LEDGERS, which the
// credit repository already reads (entries, windowed opening balances). This
// file adds only what those rows do not carry: the document behind each line -
// its number, its total, its payment status and its item rows - fetched in one
// query per document type rather than one per line.
//
// EVERYTHING HERE IS A READ. The statement creates no financial fact; it shows
// rows that already exist because a document was POSTED. Drafts and cancelled
// documents never reached a sub-ledger, so they are absent by construction.

/**
 * The business details for the statement header. A dedicated read because the
 * shared company PUBLIC_FIELDS leaves out phone, email, city and pincode - all
 * of which belong on a printed statement's letterhead.
 */
export function findCompanyHeader(companyId) {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      legalName: true,
      gstin: true,
      stateCode: true,
      registeredAddress: true,
      city: true,
      pincode: true,
      phone: true,
      email: true,
    },
  });
}

/** The item rows for a document, or null when the caller did not ask for them. */
function mapItemsOf(rows, priceField, includeItems) {
  if (!includeItems) return null;
  return (rows ?? []).map((row) => mapItem(row, { priceField }));
}

/** One item row, normalized across sales, purchases and their returns. */
function mapItem(row, { priceField }) {
  return {
    lineNumber: row.lineNumber,
    name: row.productNameSnapshot,
    hsn: row.hsnCodeSnapshot ?? null,
    unit: row.unitNameSnapshot ?? null,
    quantity: row.quantity,
    unitPrice: row[priceField],
    discount: row.discountAmount ?? null,
    tax: row.taxAmount ?? null,
    amount: row.lineTotal,
  };
}

const INVOICE_ITEM_SELECT = {
  lineNumber: true,
  productNameSnapshot: true,
  hsnCodeSnapshot: true,
  unitNameSnapshot: true,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  taxAmount: true,
  lineTotal: true,
};

const PURCHASE_ITEM_SELECT = {
  lineNumber: true,
  productNameSnapshot: true,
  hsnCodeSnapshot: true,
  unitNameSnapshot: true,
  quantity: true,
  unitCost: true,
  discountAmount: true,
  taxAmount: true,
  lineTotal: true,
};

const SALES_RETURN_ITEM_SELECT = {
  lineNumber: true,
  productNameSnapshot: true,
  hsnCodeSnapshot: true,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  taxAmount: true,
  lineTotal: true,
};

const PURCHASE_RETURN_ITEM_SELECT = {
  lineNumber: true,
  productNameSnapshot: true,
  hsnCodeSnapshot: true,
  quantity: true,
  unitCost: true,
  taxAmount: true,
  lineTotal: true,
};

/**
 * The documents behind a set of ledger references, keyed by
 * `${referenceType}:${referenceId}`, in one query per type.
 *
 * Each value is normalized so the service does not care which table it came
 * from: a `total`, a `paymentStatus`, an `outstanding`, the payment `method`
 * and allocations, and (when asked) the `items`. Money stays as Prisma Decimal;
 * the service formats it.
 *
 * @param {string} companyId
 * @param {{referenceType: string, referenceId: string}[]} references
 * @param {{ includeItems?: boolean }} [options]
 * @returns {Promise<Map<string, object>>}
 */
export async function findStatementDocuments(companyId, references, { includeItems = true } = {}) {
  const idsFor = (type) => [
    ...new Set(references.filter((r) => r.referenceType === type).map((r) => r.referenceId)),
  ];
  const key = (type, id) => `${type}:${id}`;
  const found = new Map();

  const salesInvoiceIds = idsFor('SALES_INVOICE');
  const purchaseIds = idsFor('PURCHASE');
  const customerPaymentIds = idsFor('CUSTOMER_PAYMENT');
  const supplierPaymentIds = idsFor('SUPPLIER_PAYMENT');
  const salesReturnIds = idsFor('SALES_RETURN');
  const purchaseReturnIds = idsFor('PURCHASE_RETURN');

  await Promise.all([
    salesInvoiceIds.length &&
      prisma.salesInvoice
        .findMany({
          where: { companyId, id: { in: salesInvoiceIds } },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            dueDate: true,
            status: true,
            subtotal: true,
            discountTotal: true,
            taxTotal: true,
            grandTotal: true,
            receivable: {
              select: { outstandingAmount: true, paidAmount: true, creditAmount: true, status: true },
            },
            items: includeItems
              ? { select: INVOICE_ITEM_SELECT, orderBy: { lineNumber: 'asc' } }
              : false,
          },
        })
        .then((rows) => {
          for (const row of rows) {
            found.set(key('SALES_INVOICE', row.id), {
              number: row.invoiceNumber,
              date: row.invoiceDate,
              dueDate: row.dueDate,
              docStatus: row.status,
              total: row.grandTotal,
              subtotal: row.subtotal,
              discount: row.discountTotal,
              tax: row.taxTotal,
              outstanding: row.receivable?.outstandingAmount ?? null,
              paid: row.receivable?.paidAmount ?? null,
              credited: row.receivable?.creditAmount ?? null,
              paymentStatus: row.receivable?.status ?? null,
              items: mapItemsOf(row.items, 'unitPrice', includeItems),
            });
          }
        }),

    purchaseIds.length &&
      prisma.purchase
        .findMany({
          where: { companyId, id: { in: purchaseIds } },
          select: {
            id: true,
            purchaseNumber: true,
            invoiceNumber: true,
            invoiceDate: true,
            dueDate: true,
            status: true,
            subtotal: true,
            discountTotal: true,
            taxTotal: true,
            grandTotal: true,
            payable: {
              select: { outstandingAmount: true, paidAmount: true, creditAmount: true, status: true },
            },
            items: includeItems
              ? { select: PURCHASE_ITEM_SELECT, orderBy: { lineNumber: 'asc' } }
              : false,
          },
        })
        .then((rows) => {
          for (const row of rows) {
            found.set(key('PURCHASE', row.id), {
              number: row.purchaseNumber,
              supplierInvoiceNumber: row.invoiceNumber,
              date: row.invoiceDate,
              dueDate: row.dueDate,
              docStatus: row.status,
              total: row.grandTotal,
              subtotal: row.subtotal,
              discount: row.discountTotal,
              tax: row.taxTotal,
              outstanding: row.payable?.outstandingAmount ?? null,
              paid: row.payable?.paidAmount ?? null,
              credited: row.payable?.creditAmount ?? null,
              paymentStatus: row.payable?.status ?? null,
              items: mapItemsOf(row.items, 'unitCost', includeItems),
            });
          }
        }),

    customerPaymentIds.length &&
      prisma.customerPayment
        .findMany({
          where: { companyId, id: { in: customerPaymentIds } },
          select: {
            id: true,
            paymentNumber: true,
            paymentDate: true,
            amount: true,
            allocatedAmount: true,
            unallocatedAmount: true,
            paymentMethod: true,
            referenceNumber: true,
            notes: true,
            allocations: {
              select: {
                amount: true,
                receivable: { select: { salesInvoice: { select: { invoiceNumber: true } } } },
              },
            },
          },
        })
        .then((rows) => {
          for (const row of rows) {
            found.set(key('CUSTOMER_PAYMENT', row.id), {
              number: row.paymentNumber,
              date: row.paymentDate,
              total: row.amount,
              allocated: row.allocatedAmount,
              unallocated: row.unallocatedAmount,
              method: row.paymentMethod,
              reference: row.referenceNumber,
              notes: row.notes,
              allocations: row.allocations.map((a) => ({
                documentNumber: a.receivable?.salesInvoice?.invoiceNumber ?? null,
                amount: a.amount,
              })),
            });
          }
        }),

    supplierPaymentIds.length &&
      prisma.supplierPayment
        .findMany({
          where: { companyId, id: { in: supplierPaymentIds } },
          select: {
            id: true,
            paymentNumber: true,
            paymentDate: true,
            amount: true,
            allocatedAmount: true,
            unallocatedAmount: true,
            paymentMethod: true,
            referenceNumber: true,
            notes: true,
            allocations: {
              select: {
                amount: true,
                payable: { select: { purchase: { select: { purchaseNumber: true } } } },
              },
            },
          },
        })
        .then((rows) => {
          for (const row of rows) {
            found.set(key('SUPPLIER_PAYMENT', row.id), {
              number: row.paymentNumber,
              date: row.paymentDate,
              total: row.amount,
              allocated: row.allocatedAmount,
              unallocated: row.unallocatedAmount,
              method: row.paymentMethod,
              reference: row.referenceNumber,
              notes: row.notes,
              allocations: row.allocations.map((a) => ({
                documentNumber: a.payable?.purchase?.purchaseNumber ?? null,
                amount: a.amount,
              })),
            });
          }
        }),

    salesReturnIds.length &&
      prisma.salesReturn
        .findMany({
          where: { companyId, id: { in: salesReturnIds } },
          select: {
            id: true,
            returnNumber: true,
            returnDate: true,
            status: true,
            subtotal: true,
            taxTotal: true,
            grandTotal: true,
            items: includeItems
              ? { select: SALES_RETURN_ITEM_SELECT, orderBy: { lineNumber: 'asc' } }
              : false,
          },
        })
        .then((rows) => {
          for (const row of rows) {
            found.set(key('SALES_RETURN', row.id), {
              number: row.returnNumber,
              date: row.returnDate,
              docStatus: row.status,
              total: row.grandTotal,
              subtotal: row.subtotal,
              tax: row.taxTotal,
              items: mapItemsOf(row.items, 'unitPrice', includeItems),
            });
          }
        }),

    purchaseReturnIds.length &&
      prisma.purchaseReturn
        .findMany({
          where: { companyId, id: { in: purchaseReturnIds } },
          select: {
            id: true,
            returnNumber: true,
            returnDate: true,
            status: true,
            taxableTotal: true,
            taxTotal: true,
            grandTotal: true,
            items: includeItems
              ? { select: PURCHASE_RETURN_ITEM_SELECT, orderBy: { lineNumber: 'asc' } }
              : false,
          },
        })
        .then((rows) => {
          for (const row of rows) {
            found.set(key('PURCHASE_RETURN', row.id), {
              number: row.returnNumber,
              date: row.returnDate,
              docStatus: row.status,
              total: row.grandTotal,
              subtotal: row.taxableTotal,
              tax: row.taxTotal,
              items: mapItemsOf(row.items, 'unitCost', includeItems),
            });
          }
        }),
  ].filter(Boolean));

  return found;
}
