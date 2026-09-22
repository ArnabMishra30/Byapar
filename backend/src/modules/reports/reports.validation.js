import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { optionalIdQuerySchema, moneySchema } from '../../utils/validation.js';

// Zod schemas for the dashboard, the reports and the credit book.
//
// Everything here is a READ. No schema in this file describes a write, because
// nothing in this module writes anything.

/** A business date, "YYYY-MM-DD", stored at UTC midnight so it cannot shift. */
function businessDate(label) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((value) => !Number.isNaN(value.getTime()), { message: `${label} is not a valid date` })
    .optional();
}

/**
 * A report period. Both bounds optional and inclusive - unlike a GST return,
 * a business report for "everything so far" is a perfectly sensible request.
 */
const dateRangeFields = {
  fromDate: businessDate('fromDate'),
  toDate: businessDate('toDate'),
};

const notReversed = (value) =>
  !value.fromDate || !value.toDate || value.fromDate <= value.toDate;

const reversedMessage = { message: 'fromDate must not be after toDate', path: ['fromDate'] };

// --- dashboard -------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  /** Look at a past day. Defaults to today in the company's own timezone. */
  date: businessDate('date'),
});

// --- reports ---------------------------------------------------------------

export const salesReportQuerySchema = paginationQuerySchema
  .extend({ ...dateRangeFields, customerId: optionalIdQuerySchema('customerId') })
  .refine(notReversed, reversedMessage);

export const purchasesReportQuerySchema = paginationQuerySchema
  .extend({ ...dateRangeFields, supplierId: optionalIdQuerySchema('supplierId') })
  .refine(notReversed, reversedMessage);

export const paymentsReceivedQuerySchema = salesReportQuerySchema;
export const supplierPaymentsQuerySchema = purchasesReportQuerySchema;

export const dateRangeQuerySchema = z.object(dateRangeFields).refine(notReversed, reversedMessage);

export const generalLedgerReportQuerySchema = paginationQuerySchema
  .extend({ ...dateRangeFields, accountId: optionalIdQuerySchema('accountId') })
  .refine(notReversed, reversedMessage);

export const cashBankReportQuerySchema = paginationQuerySchema
  .extend(dateRangeFields)
  .refine(notReversed, reversedMessage);

export const expenseReportQuerySchema = z
  .object({
    ...dateRangeFields,
    status: z.enum(['DRAFT', 'POSTED', 'CANCELLED', 'REVERSED']).optional(),
    expenseAccountId: optionalIdQuerySchema('expenseAccountId'),
    paymentMode: z.enum(['CASH', 'BANK']).optional(),
    paymentAccountId: optionalIdQuerySchema('paymentAccountId'),
    supplierId: optionalIdQuerySchema('supplierId'),
  })
  .refine(notReversed, reversedMessage);

export const inventoryValuationQuerySchema = z.object({
  lowStockOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const ledgerReportQuerySchema = z
  .object(dateRangeFields)
  .refine(notReversed, reversedMessage);

// --- credit book -----------------------------------------------------------

export const creditQuerySchema = z.object({
  /** Ages and overdue amounts are measured against this date. Defaults to today. */
  asOfDate: businessDate('asOfDate'),
  overdueOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** Hide small balances, which is how a shopkeeper reads a chase list. */
  minimumAmount: moneySchema('minimumAmount', { decimals: 2 }).optional(),
});

export const partyIdParamSchema = z.object({
  id: z.string().uuid('Invalid id'),
});
