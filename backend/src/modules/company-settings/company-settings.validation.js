import { z } from 'zod';

// Defaults are India-oriented but every value is configurable and never hardcoded
// into business logic.

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Currency must be a 3 letter code, e.g. INR');

// Validated against the runtime's own timezone database rather than a hardcoded list.
const timezoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid timezone, e.g. Asia/Kolkata' },
  );

const dateFormatSchema = z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], {
  errorMap: () => ({ message: 'Date format must be DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD' }),
});

const prefixSchema = (label) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1, `${label} is required`)
    .max(10, `${label} must be at most 10 characters`)
    .regex(/^[A-Z0-9-]+$/, `${label} may only contain letters, numbers and hyphens`);

export const updateCompanySettingsSchema = z
  .object({
    currency: currencySchema.optional(),
    timezone: timezoneSchema.optional(),
    dateFormat: dateFormatSchema.optional(),
    invoicePrefix: prefixSchema('Invoice prefix').optional(),
    purchasePrefix: prefixSchema('Purchase prefix').optional(),
    financialYearStartMonth: z
      .number({ invalid_type_error: 'Financial year start month must be a number' })
      .int('Financial year start month must be a whole number')
      .min(1, 'Financial year start month must be between 1 and 12')
      .max(12, 'Financial year start month must be between 1 and 12')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
