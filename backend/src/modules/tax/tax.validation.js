import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { descriptionSchema, isActiveQuerySchema, searchQuerySchema } from '../../utils/validation.js';

// Zod schemas for the tax module.
//
// A client may configure tax and read summaries. It may NEVER send a tax amount,
// a component split, or a supply type: those are all computed by the server from
// the states and the rates. The only tax input on a document is the optional
// place of supply on a sale, declared in the sales module.

const GST_REGISTRATION_TYPES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OTHER'];
const TAX_CLASSIFICATION_KINDS = ['HSN', 'SAC'];
const TAX_SOURCES = ['PURCHASE', 'PURCHASE_RETURN', 'SALES_INVOICE', 'SALES_RETURN'];

const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, 'A GST state code is exactly two digits');

function businessDate(label) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((value) => !Number.isNaN(value.getTime()), { message: `${label} is not a valid date` })
    .optional();
}

// --- company GST profile ---------------------------------------------------

export const updateGstProfileSchema = z
  .object({
    // Validated strictly - structure, state code AND checksum - in the service.
    gstin: z.string().trim().toUpperCase().min(15).max(15).nullable().optional(),
    legalName: z.string().trim().min(2).max(150).nullable().optional(),
    stateCode: stateCodeSchema.nullable().optional(),
    registeredAddress: z.string().trim().max(500).nullable().optional(),
    registrationType: z.enum(GST_REGISTRATION_TYPES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const validateGstinSchema = z.object({
  gstin: z.string({ required_error: 'GSTIN is required' }).trim().min(1).max(20),
});

// --- HSN / SAC -------------------------------------------------------------

export const createTaxClassificationSchema = z.object({
  kind: z.enum(TAX_CLASSIFICATION_KINDS).default('HSN'),
  // HSN is 4, 6 or 8 digits; SAC is 6. Digits only, and never edited afterwards.
  code: z
    .string({ required_error: 'An HSN/SAC code is required' })
    .trim()
    .regex(/^\d{4,8}$/, 'An HSN/SAC code is 4 to 8 digits'),
  description: descriptionSchema,
  defaultTaxId: z.string().uuid('Invalid defaultTaxId').nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateTaxClassificationSchema = z
  .object({
    kind: z.enum(TAX_CLASSIFICATION_KINDS).optional(),
    description: descriptionSchema,
    defaultTaxId: z.string().uuid('Invalid defaultTaxId').nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listTaxClassificationsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  kind: z.enum(TAX_CLASSIFICATION_KINDS).optional(),
  isActive: isActiveQuerySchema,
});

// --- reporting -------------------------------------------------------------

const reportFilters = {
  dateFrom: businessDate('dateFrom'),
  dateTo: businessDate('dateTo'),
  state: stateCodeSchema.optional(),
  gstin: z.string().trim().toUpperCase().min(1).max(20).optional(),
  hsn: z.string().trim().min(1).max(20).optional(),
  rate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'rate must be a number with at most 2 decimal places')
    .optional(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).optional(),
};

export const gstReportQuerySchema = z.object(reportFilters);

export const gstLinesQuerySchema = paginationQuerySchema.extend({
  ...reportFilters,
  source: z.enum(TAX_SOURCES).optional(),
});

export const gstSourceParamsSchema = z.object({
  source: z.enum(TAX_SOURCES, { invalid_type_error: 'Unknown document type' }),
});

// --- GST return preparation ------------------------------------------------

/**
 * A return period. BOTH DATES ARE REQUIRED and both bounds are INCLUSIVE.
 *
 * A return is always filed for a stated period, so unlike the summary endpoints
 * there is no "everything to date" default: an unbounded return dataset would be
 * meaningless, and silently defaulting one would be worse.
 */
export const gstReturnPeriodQuerySchema = z
  .object({
    fromDate: z
      .string({ required_error: 'fromDate is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be in YYYY-MM-DD format')
      .transform((value) => new Date(`${value}T00:00:00.000Z`))
      .refine((value) => !Number.isNaN(value.getTime()), { message: 'fromDate is not a valid date' }),
    toDate: z
      .string({ required_error: 'toDate is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be in YYYY-MM-DD format')
      .transform((value) => new Date(`${value}T00:00:00.000Z`))
      .refine((value) => !Number.isNaN(value.getTime()), { message: 'toDate is not a valid date' }),
  })
  .refine((value) => value.fromDate <= value.toDate, {
    message: 'fromDate must not be after toDate',
    path: ['fromDate'],
  });
