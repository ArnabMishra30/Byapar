import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  nameSchema,
  codeSchema,
  descriptionSchema,
  isActiveQuerySchema,
  searchQuerySchema,
  optionalIdQuerySchema,
} from '../../utils/validation.js';

// Zod schemas for the accounting module. Everything the client may send is
// declared here; anything not declared is dropped before a service sees it.
//
// The client can NEVER send: companyId, isSystem, a journal entry, a journal
// line, an amount, or an account id to post to. Those are all server decisions.

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const SOURCE_TYPES = [
  'PURCHASE',
  'PURCHASE_RETURN',
  'SUPPLIER_PAYMENT',
  'SALES_INVOICE',
  'SALES_RETURN',
  'CUSTOMER_PAYMENT',
  'EXPENSE',
  'EXPENSE_REVERSAL',
  'OPENING_BALANCE',
  'REVERSAL',
];

/** A business date, "YYYY-MM-DD", stored as midnight UTC so it cannot shift. */
function businessDateSchema(label) {
  return z
    .string({ required_error: `${label} is required` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((value) => !Number.isNaN(value.getTime()), { message: `${label} is not a valid date` });
}

const optionalBusinessDate = (label) => businessDateSchema(label).optional();

// --- chart of accounts -----------------------------------------------------

export const createAccountSchema = z.object({
  // Numbers and letters only: a code is an identifier, not a sentence.
  code: codeSchema('Account code', { min: 1, max: 20 }).regex(
    /^[A-Z0-9][A-Z0-9._-]*$/,
    'Account code may contain letters, digits, dot, dash and underscore only',
  ),
  name: nameSchema('Account name', { min: 2, max: 150 }),
  type: z.enum(ACCOUNT_TYPES, {
    required_error: 'Account type is required',
    invalid_type_error: `Account type must be one of ${ACCOUNT_TYPES.join(', ')}`,
  }),
  parentId: z.string().uuid('Invalid parentId').nullable().optional(),
  description: descriptionSchema,
  isActive: z.boolean().optional(),
});

/**
 * `code` and `type` are deliberately absent: neither can ever change. Sending
 * them is not an error, they are simply ignored - Zod strips unknown keys.
 */
export const updateAccountSchema = z
  .object({
    name: nameSchema('Account name', { min: 2, max: 150 }).optional(),
    parentId: z.string().uuid('Invalid parentId').nullable().optional(),
    description: descriptionSchema,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listAccountsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  type: z.enum(ACCOUNT_TYPES).optional(),
  isActive: isActiveQuerySchema,
  isSystem: isActiveQuerySchema,
  parentId: optionalIdQuerySchema('parentId'),
});

export const accountLedgerQuerySchema = paginationQuerySchema.extend({
  dateFrom: optionalBusinessDate('dateFrom'),
  dateTo: optionalBusinessDate('dateTo'),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceId: optionalIdQuerySchema('sourceId'),
});

// --- journal entries -------------------------------------------------------

export const listJournalEntriesQuerySchema = paginationQuerySchema.extend({
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceId: optionalIdQuerySchema('sourceId'),
  journalNumber: z.string().trim().min(1).max(50).optional(),
  status: z.enum(['DRAFT', 'POSTED']).optional(),
  accountId: optionalIdQuerySchema('accountId'),
  dateFrom: optionalBusinessDate('dateFrom'),
  dateTo: optionalBusinessDate('dateTo'),
});

export const reverseJournalEntrySchema = z.object({
  description: z.string().trim().max(500, 'Description is too long').optional(),
});

export const sourceParamsSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES, { invalid_type_error: 'Unknown source type' }),
  sourceId: z.string().uuid('Invalid sourceId'),
});

// --- general ledger --------------------------------------------------------

export const generalLedgerQuerySchema = paginationQuerySchema.extend({
  accountId: optionalIdQuerySchema('accountId'),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceId: optionalIdQuerySchema('sourceId'),
  dateFrom: optionalBusinessDate('dateFrom'),
  dateTo: optionalBusinessDate('dateTo'),
});

export const generalLedgerSummaryQuerySchema = z.object({
  accountId: optionalIdQuerySchema('accountId'),
  dateFrom: optionalBusinessDate('dateFrom'),
  dateTo: optionalBusinessDate('dateTo'),
});

// --- financial statements --------------------------------------------------

/** As-of reports. Omitting the date means "everything up to now". */
export const asOfDateQuerySchema = z.object({
  date: optionalBusinessDate('date'),
});

export const dateRangeQuerySchema = z
  .object({
    from: optionalBusinessDate('from'),
    to: optionalBusinessDate('to'),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });
