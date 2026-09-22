import { prisma } from '../../config/prisma.js';

// All Prisma access for the dashboard and the business reports.
//
// WHAT THIS FILE IS AND IS NOT
//   It is a QUERY layer: period sums, per-party groupings, counts. It contains no
//   accounting rules at all.
//
//   It is NOT a second accounting engine. Profit, ledgers, balances and the trial
//   balance are computed by the modules that own them - the general ledger, the
//   customer and supplier sub-ledgers, and inventory - and the report services
//   call those. Anything that looked like it needed a formula here belongs there
//   instead.
//
// ONLY POSTED DOCUMENTS COUNT, everywhere. A draft has sold nothing, bought
// nothing and paid nobody; a cancelled document never happened.
//
// GST IS IRRELEVANT TO EVERY QUERY HERE. Nothing in this file reads a GSTIN, a
// place of supply or a tax component, which is what lets the whole dashboard work
// identically for a shop that has never heard of GST.

/** A business-date range filter. Both bounds inclusive; null means unbounded. */
function dateRange(field, { fromDate, toDate }) {
  if (!fromDate && !toDate) return {};

  const range = {};
  if (fromDate) range.gte = fromDate;
  if (toDate) range.lte = toDate;

  return { [field]: range };
}

// --- period totals ---------------------------------------------------------

/**
 * Posted sales in a period: what was invoiced, and what it cost us.
 *
 * `customerId` narrows it to one customer. Every sum in this file takes the same
 * filters as the matching list, so a report's totals always describe exactly the
 * rows it is showing.
 */
export async function sumSales(companyId, { customerId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('invoiceDate', period),
    ...(customerId ? { customerId } : {}),
  };

  const [aggregate, count] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where,
      _sum: { subtotal: true, discountTotal: true, taxTotal: true, grandTotal: true, cogsTotal: true },
    }),
    prisma.salesInvoice.count({ where }),
  ]);

  return { ...aggregate._sum, documentCount: count };
}

/** Posted purchases in a period, optionally for one supplier. */
export async function sumPurchases(companyId, { supplierId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('invoiceDate', period),
    ...(supplierId ? { supplierId } : {}),
  };

  const [aggregate, count] = await Promise.all([
    prisma.purchase.aggregate({
      where,
      _sum: { subtotal: true, discountTotal: true, taxTotal: true, grandTotal: true },
    }),
    prisma.purchase.count({ where }),
  ]);

  return { ...aggregate._sum, documentCount: count };
}

export async function sumSalesReturns(companyId, { customerId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('returnDate', period),
    ...(customerId ? { customerId } : {}),
  };

  const [aggregate, count] = await Promise.all([
    prisma.salesReturn.aggregate({
      where,
      _sum: { taxTotal: true, grandTotal: true, cogsTotal: true },
    }),
    prisma.salesReturn.count({ where }),
  ]);

  return { ...aggregate._sum, documentCount: count };
}

export async function sumPurchaseReturns(companyId, { supplierId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('returnDate', period),
    // A purchase return has no supplier of its own: it belongs to the bill it
    // reverses, and that bill has the supplier.
    ...(supplierId ? { purchase: { supplierId } } : {}),
  };

  const [aggregate, count] = await Promise.all([
    prisma.purchaseReturn.aggregate({
      where,
      _sum: { taxableTotal: true, taxTotal: true, grandTotal: true },
    }),
    prisma.purchaseReturn.count({ where }),
  ]);

  return { ...aggregate._sum, documentCount: count };
}

/** Money actually received from customers in a period. */
export async function sumCustomerPayments(companyId, { customerId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('paymentDate', period),
    ...(customerId ? { customerId } : {}),
  };

  const [aggregate, count] = await Promise.all([
    prisma.customerPayment.aggregate({
      where,
      _sum: { amount: true, allocatedAmount: true, unallocatedAmount: true },
    }),
    prisma.customerPayment.count({ where }),
  ]);

  return { ...aggregate._sum, documentCount: count };
}

/** Money actually paid to suppliers in a period. */
export async function sumSupplierPayments(companyId, { supplierId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('paymentDate', period),
    ...(supplierId ? { supplierId } : {}),
  };

  const [aggregate, count] = await Promise.all([
    prisma.supplierPayment.aggregate({
      where,
      _sum: { amount: true, allocatedAmount: true, unallocatedAmount: true },
    }),
    prisma.supplierPayment.count({ where }),
  ]);

  return { ...aggregate._sum, documentCount: count };
}

/** Receipts split by how the money arrived - cash, bank, UPI and the rest. */
export function groupCustomerPaymentsByMethod(companyId, { customerId, ...period }) {
  return prisma.customerPayment.groupBy({
    by: ['paymentMethod'],
    where: {
      companyId,
      status: 'POSTED',
      ...dateRange('paymentDate', period),
      ...(customerId ? { customerId } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
}

export function groupSupplierPaymentsByMethod(companyId, { supplierId, ...period }) {
  return prisma.supplierPayment.groupBy({
    by: ['paymentMethod'],
    where: {
      companyId,
      status: 'POSTED',
      ...dateRange('paymentDate', period),
      ...(supplierId ? { supplierId } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
}

// --- outstanding balances --------------------------------------------------

/**
 * What every customer still owes, one row per customer.
 *
 * `oldestDate` is what a shopkeeper means by "since when": the date of their
 * oldest still-unpaid invoice.
 */
export async function groupReceivablesByCustomer(companyId, { asOfDate } = {}) {
  const grouped = await prisma.customerReceivable.groupBy({
    by: ['customerId'],
    where: { companyId, outstandingAmount: { gt: 0 } },
    _sum: { originalAmount: true, creditAmount: true, paidAmount: true, outstandingAmount: true },
    _count: { _all: true },
    _min: { dueDate: true },
  });

  if (grouped.length === 0) return [];

  const customerIds = grouped.map((row) => row.customerId);

  const [customers, oldestInvoices, overdue] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: customerIds }, companyId },
      select: { id: true, name: true, phone: true, creditLimit: true, isActive: true },
    }),
    // The oldest unpaid invoice per customer - "since when".
    prisma.customerReceivable.findMany({
      where: { companyId, outstandingAmount: { gt: 0 }, customerId: { in: customerIds } },
      select: {
        customerId: true,
        outstandingAmount: true,
        dueDate: true,
        salesInvoice: { select: { invoiceNumber: true, invoiceDate: true } },
      },
      orderBy: { salesInvoice: { invoiceDate: 'asc' } },
    }),
    asOfDate
      ? prisma.customerReceivable.groupBy({
          by: ['customerId'],
          where: {
            companyId,
            outstandingAmount: { gt: 0 },
            dueDate: { lt: asOfDate },
            customerId: { in: customerIds },
          },
          _sum: { outstandingAmount: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const overdueById = new Map(overdue.map((row) => [row.customerId, row]));

  const oldestByCustomer = new Map();
  for (const invoice of oldestInvoices) {
    if (!oldestByCustomer.has(invoice.customerId)) {
      oldestByCustomer.set(invoice.customerId, invoice);
    }
  }

  return grouped.map((row) => ({
    party: customerById.get(row.customerId) ?? null,
    partyId: row.customerId,
    sums: row._sum,
    invoiceCount: row._count._all,
    oldest: oldestByCustomer.get(row.customerId) ?? null,
    earliestDueDate: row._min.dueDate,
    overdue: overdueById.get(row.customerId) ?? null,
  }));
}

/** The mirror image: what we still owe every supplier. */
export async function groupPayablesBySupplier(companyId, { asOfDate } = {}) {
  const grouped = await prisma.supplierPayable.groupBy({
    by: ['supplierId'],
    where: { companyId, outstandingAmount: { gt: 0 } },
    _sum: { originalAmount: true, creditAmount: true, paidAmount: true, outstandingAmount: true },
    _count: { _all: true },
    _min: { dueDate: true },
  });

  if (grouped.length === 0) return [];

  const supplierIds = grouped.map((row) => row.supplierId);

  const [suppliers, oldestBills, overdue] = await Promise.all([
    prisma.supplier.findMany({
      where: { id: { in: supplierIds }, companyId },
      select: { id: true, name: true, phone: true, creditLimit: true, isActive: true },
    }),
    prisma.supplierPayable.findMany({
      where: { companyId, outstandingAmount: { gt: 0 }, supplierId: { in: supplierIds } },
      select: {
        supplierId: true,
        outstandingAmount: true,
        dueDate: true,
        purchase: { select: { purchaseNumber: true, invoiceNumber: true, invoiceDate: true } },
      },
      orderBy: { purchase: { invoiceDate: 'asc' } },
    }),
    asOfDate
      ? prisma.supplierPayable.groupBy({
          by: ['supplierId'],
          where: {
            companyId,
            outstandingAmount: { gt: 0 },
            dueDate: { lt: asOfDate },
            supplierId: { in: supplierIds },
          },
          _sum: { outstandingAmount: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const overdueById = new Map(overdue.map((row) => [row.supplierId, row]));

  const oldestBySupplier = new Map();
  for (const bill of oldestBills) {
    if (!oldestBySupplier.has(bill.supplierId)) {
      oldestBySupplier.set(bill.supplierId, bill);
    }
  }

  return grouped.map((row) => ({
    party: supplierById.get(row.supplierId) ?? null,
    partyId: row.supplierId,
    sums: row._sum,
    invoiceCount: row._count._all,
    oldest: oldestBySupplier.get(row.supplierId) ?? null,
    earliestDueDate: row._min.dueDate,
    overdue: overdueById.get(row.supplierId) ?? null,
  }));
}

/** The last posted receipt from each customer - "what payments were made". */
export async function findLastCustomerPayments(companyId, customerIds) {
  if (customerIds.length === 0) return new Map();

  const payments = await prisma.customerPayment.findMany({
    where: { companyId, status: 'POSTED', customerId: { in: customerIds } },
    select: { customerId: true, paymentNumber: true, paymentDate: true, amount: true },
    orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
  });

  const latest = new Map();
  for (const payment of payments) {
    if (!latest.has(payment.customerId)) latest.set(payment.customerId, payment);
  }

  return latest;
}

export async function findLastSupplierPayments(companyId, supplierIds) {
  if (supplierIds.length === 0) return new Map();

  const payments = await prisma.supplierPayment.findMany({
    where: { companyId, status: 'POSTED', supplierId: { in: supplierIds } },
    select: { supplierId: true, paymentNumber: true, paymentDate: true, amount: true },
    orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
  });

  const latest = new Map();
  for (const payment of payments) {
    if (!latest.has(payment.supplierId)) latest.set(payment.supplierId, payment);
  }

  return latest;
}

/** Company-wide totals, so the dashboard does not have to sum a party list. */
export function sumAllReceivables(companyId) {
  return prisma.customerReceivable.aggregate({
    where: { companyId, outstandingAmount: { gt: 0 } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

export function sumAllPayables(companyId) {
  return prisma.supplierPayable.aggregate({
    where: { companyId, outstandingAmount: { gt: 0 } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

export function sumOverdueReceivables(companyId, asOfDate) {
  return prisma.customerReceivable.aggregate({
    where: { companyId, outstandingAmount: { gt: 0 }, dueDate: { lt: asOfDate } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

export function sumOverduePayables(companyId, asOfDate) {
  return prisma.supplierPayable.aggregate({
    where: { companyId, outstandingAmount: { gt: 0 }, dueDate: { lt: asOfDate } },
    _sum: { outstandingAmount: true },
    _count: { _all: true },
  });
}

// --- inventory -------------------------------------------------------------

/**
 * Every stock balance a company holds.
 *
 * Deliberately returns the rows rather than a SQL SUM: the valuation is
 * `quantity x averageCost` rounded per balance, exactly as the inventory module
 * itself reports it, and that arithmetic stays in one place.
 */
export function findAllInventoryBalances(companyId) {
  return prisma.inventoryBalance.findMany({
    where: { companyId },
    select: {
      id: true,
      quantity: true,
      averageCost: true,
      product: { select: { id: true, name: true, sku: true, reorderLevel: true } },
      warehouse: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ product: { name: 'asc' } }, { warehouse: { name: 'asc' } }],
  });
}

// --- document listings for the report tables -------------------------------

/** Posted sales invoices in a period, for the sales register. */
export async function listSales(companyId, { skip, take, customerId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('invoiceDate', period),
    ...(customerId ? { customerId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.salesInvoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        customerNameSnapshot: true,
        customer: { select: { id: true, name: true } },
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        grandTotal: true,
        cogsTotal: true,
        receivable: { select: { outstandingAmount: true, paidAmount: true, status: true } },
      },
      orderBy: [{ invoiceDate: 'asc' }, { invoiceNumber: 'asc' }],
      skip,
      take,
    }),
    prisma.salesInvoice.count({ where }),
  ]);

  return { items, total };
}

/** Posted purchases in a period, for the purchase register. */
export async function listPurchases(companyId, { skip, take, supplierId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('invoiceDate', period),
    ...(supplierId ? { supplierId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      select: {
        id: true,
        purchaseNumber: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        supplierNameSnapshot: true,
        supplier: { select: { id: true, name: true } },
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        grandTotal: true,
        payable: { select: { outstandingAmount: true, paidAmount: true, status: true } },
      },
      orderBy: [{ invoiceDate: 'asc' }, { purchaseNumber: 'asc' }],
      skip,
      take,
    }),
    prisma.purchase.count({ where }),
  ]);

  return { items, total };
}

/** Posted receipts in a period, for the payments-received register. */
export async function listCustomerPayments(companyId, { skip, take, customerId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('paymentDate', period),
    ...(customerId ? { customerId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.customerPayment.findMany({
      where,
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        amount: true,
        allocatedAmount: true,
        unallocatedAmount: true,
        paymentMethod: true,
        referenceNumber: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: [{ paymentDate: 'asc' }, { paymentNumber: 'asc' }],
      skip,
      take,
    }),
    prisma.customerPayment.count({ where }),
  ]);

  return { items, total };
}

/** Posted supplier payments in a period. */
export async function listSupplierPayments(companyId, { skip, take, supplierId, ...period }) {
  const where = {
    companyId,
    status: 'POSTED',
    ...dateRange('paymentDate', period),
    ...(supplierId ? { supplierId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.supplierPayment.findMany({
      where,
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        amount: true,
        allocatedAmount: true,
        unallocatedAmount: true,
        paymentMethod: true,
        referenceNumber: true,
        supplier: { select: { id: true, name: true } },
      },
      orderBy: [{ paymentDate: 'asc' }, { paymentNumber: 'asc' }],
      skip,
      take,
    }),
    prisma.supplierPayment.count({ where }),
  ]);

  return { items, total };
}

/** Daily sales and purchase totals, for a trend line. */
export async function dailySalesTotals(companyId, period) {
  return prisma.salesInvoice.groupBy({
    by: ['invoiceDate'],
    where: { companyId, status: 'POSTED', ...dateRange('invoiceDate', period) },
    _sum: { grandTotal: true, cogsTotal: true },
    _count: { _all: true },
  });
}

export async function dailyPurchaseTotals(companyId, period) {
  return prisma.purchase.groupBy({
    by: ['invoiceDate'],
    where: { companyId, status: 'POSTED', ...dateRange('invoiceDate', period) },
    _sum: { grandTotal: true },
    _count: { _all: true },
  });
}
