import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { moneySchema, optionalIdQuerySchema, descriptionSchema } from '../../utils/validation.js';

// Zod schemas for expenses.
//
// GST FIELDS ARE ABSENT ON PURPOSE. There is no GSTIN, no HSN, no place of supply
// and no tax rate anywhere in this schema: a shop with no registration records
// rent with a date, a category, an amount and how it was paid, and nothing else.

const EXPENSE_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED', 'REVERSED'];
const PAYMENT_MODES = ['CASH', 'BANK'];

/** A business date, "YYYY-MM-DD", stored at UTC midnight so it cannot shift. */
function businessDate(label, { required = true } = {}) {
  const schema = z
    .string(required ? { required_error: `${label} is required` } : undefined)
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((value) => !Number.isNaN(value.getTime()), { message: `${label} is not a valid date` });

  return required ? schema : schema.optional();
}

const expenseBodySchema = z.object({
  expenseDate: businessDate('Expense date'),

  // The category IS an account: an EXPENSE account in this company's chart.
  expenseAccountId: z
    .string({ required_error: 'An expense category is required' })
    .uuid('Invalid expense category'),

  amount: moneySchema('Amount', { decimals: 2 }),

  paymentMode: z.enum(PAYMENT_MODES, {
    required_error: 'Payment mode is required',
    invalid_type_error: 'Payment mode must be CASH or BANK',
  }),

  // Optional. Omitted, the payment mode picks the system Cash or Bank account -
  // which is what a business with one of each will always want.
  paymentAccountId: z.string().uuid('Invalid payment account').nullable().optional(),

  // Optional and informational: an expense raises no payable.
  supplierId: z.string().uuid('Invalid supplierId').nullable().optional(),

  description: descriptionSchema,
  referenceNumber: z.string().trim().max(100, 'Reference number is too long').nullable().optional(),
  notes: z.string().trim().max(1000, 'Notes are too long').nullable().optional(),
});

export const createExpenseSchema = expenseBodySchema;
export const updateExpenseSchema = expenseBodySchema;

const filterFields = {
  status: z.enum(EXPENSE_STATUSES).optional(),
  expenseAccountId: optionalIdQuerySchema('expenseAccountId'),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paymentAccountId: optionalIdQuerySchema('paymentAccountId'),
  supplierId: optionalIdQuerySchema('supplierId'),
  fromDate: businessDate('fromDate', { required: false }),
  toDate: businessDate('toDate', { required: false }),
};

const notReversed = (value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate;
const reversedMessage = { message: 'fromDate must not be after toDate', path: ['fromDate'] };

export const listExpensesQuerySchema = paginationQuerySchema
  .extend({ ...filterFields, search: z.string().trim().min(1).max(100).optional() })
  .refine(notReversed, reversedMessage);

/** The expense report takes the same filters, without pagination. */
export const expenseReportQuerySchema = z.object(filterFields).refine(notReversed, reversedMessage);
