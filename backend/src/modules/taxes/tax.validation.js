import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { nameSchema, isActiveQuerySchema, searchQuerySchema } from '../../utils/validation.js';

// Only GST exists today. The enum is here so more types can be added without
// changing every call site.
const taxTypeSchema = z.enum(['GST'], {
  errorMap: () => ({ message: 'Tax type must be GST' }),
});

// A percentage: 0 to 100, at most 2 decimal places. Sent to Prisma as a string
// so the value never passes through a JavaScript float.
const rateSchema = z
  .union([z.number(), z.string()], { required_error: 'Rate is required' })
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), {
    message: 'Rate must be a positive number with at most 2 decimal places',
  })
  .refine((value) => Number(value) <= 100, { message: 'Rate cannot be greater than 100' });

export const listTaxesQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
  type: taxTypeSchema.optional(),
});

// A business date, "YYYY-MM-DD", stored at midnight UTC so it cannot shift.
const effectiveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .nullable()
  .optional();

const treatmentSchema = z.enum(['TAXABLE', 'EXEMPT', 'NIL_RATED', 'ZERO_RATED'], {
  errorMap: () => ({ message: 'Treatment must be TAXABLE, EXEMPT, NIL_RATED or ZERO_RATED' }),
});

// The component rates are OPTIONAL. Leave them out and the server derives the
// standard split (half each to CGST and SGST, the whole rate to IGST); send them
// and they are checked against the headline rate rather than trusted.
const gstComponentFields = {
  cgstRate: rateSchema.optional(),
  sgstRate: rateSchema.optional(),
  igstRate: rateSchema.optional(),
  cessRate: rateSchema.optional(),
  treatment: treatmentSchema.optional(),
  effectiveFrom: effectiveDateSchema,
  effectiveTo: effectiveDateSchema,
};

export const createTaxSchema = z
  .object({
    name: nameSchema('Tax name', { max: 50 }),
    rate: rateSchema,
    type: taxTypeSchema.default('GST'),
    ...gstComponentFields,
  })
  .refine((value) => !value.effectiveFrom || !value.effectiveTo || value.effectiveFrom <= value.effectiveTo, {
    message: 'effectiveFrom must not be after effectiveTo',
    path: ['effectiveFrom'],
  });

export const updateTaxSchema = z
  .object({
    name: nameSchema('Tax name', { max: 50 }).optional(),
    rate: rateSchema.optional(),
    type: taxTypeSchema.optional(),
    ...gstComponentFields,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
