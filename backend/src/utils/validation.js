import { z } from 'zod';

// Shared Zod building blocks. Master-data modules import these so a rule such as
// "what is a valid GSTIN" is defined once, not eight times.

/** Indian GSTIN: 2 digit state code, 10 char PAN, entity number, "Z", checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** Route parameter :id */
export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id'),
});

/** Body of every PATCH /:id/status endpoint */
export const statusSchema = z.object({
  isActive: z.boolean({
    required_error: 'isActive is required',
    invalid_type_error: 'isActive must be true or false',
  }),
});

/** @param {string} label @param {{ min?: number, max?: number }} [options] */
export function nameSchema(label = 'Name', { min = 2, max = 150 } = {}) {
  return z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
}

/** Short code such as a unit shortCode or warehouse code. Stored upper-case. */
export function codeSchema(label = 'Code', { min = 1, max = 20 } = {}) {
  return z
    .string({ required_error: `${label} is required` })
    .trim()
    .toUpperCase()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
}

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_PATTERN, 'Invalid GSTIN format')
  .nullable()
  .optional();

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+]?[0-9\s-]{7,20}$/, 'Invalid phone number')
  .nullable()
  .optional();

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(255, 'Email is too long')
  .nullable()
  .optional();

export const addressSchema = z.string().trim().max(500, 'Address is too long').nullable().optional();

export const descriptionSchema = z
  .string()
  .trim()
  .max(1000, 'Description is too long')
  .nullable()
  .optional();

/**
 * A monetary amount. Accepts a number or a numeric string and always hands the
 * service a STRING, which Prisma converts to Decimal without ever passing through
 * a JavaScript float. See src/utils/money.js.
 *
 * @param {string} label
 * @param {{ max?: number, decimals?: number }} [options]
 */
export function moneySchema(label = 'Amount', { max = 999999999999, decimals = 4 } = {}) {
  return z
    .union([z.number(), z.string()], { required_error: `${label} is required` })
    .transform((value) => String(value).trim())
    .refine((value) => new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value), {
      message: `${label} must be a positive number with at most ${decimals} decimal places`,
    })
    .refine((value) => Number(value) <= max, { message: `${label} is too large` });
}

/** A quantity, e.g. reorder level. Same rules as money but 6 decimal places. */
export function quantitySchema(label = 'Quantity') {
  return moneySchema(label, { decimals: 6 });
}

/** Query filter that arrives as the string "true" or "false". */
export const isActiveQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const searchQuerySchema = z.string().trim().min(1).max(100).optional();

/** Optional uuid used as a list filter, e.g. ?categoryId=... */
export function optionalIdQuerySchema(label = 'id') {
  return z.string().uuid(`Invalid ${label}`).optional();
}
