import { z } from 'zod';

// Zod schemas for the credit and collections layer.
//
// Every schema here describes a READ. This module writes nothing: the one place
// it changes behaviour is the credit check inside sales posting, whose input is
// validated by the sales module.
//
// NO GST FIELD APPEARS ANYWHERE IN THIS FILE, and none should. A shop with no
// registration chases its money exactly as a registered company does.

/** A business date, "YYYY-MM-DD", stored at UTC midnight so it cannot shift. */
function businessDate(label) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((value) => !Number.isNaN(value.getTime()), { message: `${label} is not a valid date` })
    .optional();
}

const notReversed = (value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate;
const reversedMessage = { message: 'fromDate must not be after toDate', path: ['fromDate'] };

/** A statement window. Both bounds optional: "everything so far" is normal. */
export const statementQuerySchema = z
  .object({
    fromDate: businessDate('fromDate'),
    toDate: businessDate('toDate'),
  })
  .refine(notReversed, reversedMessage);

export const collectionSummaryQuerySchema = z
  .object({
    /** Ages and overdue amounts are measured against this date. Defaults to today. */
    asOfDate: businessDate('asOfDate'),
    fromDate: businessDate('fromDate'),
    toDate: businessDate('toDate'),
    /** The horizon for "falling due soon". */
    dueWithinDays: z.coerce
      .number()
      .int('dueWithinDays must be a whole number of days')
      .min(0, 'dueWithinDays cannot be negative')
      .max(365, 'dueWithinDays cannot exceed 365')
      .optional(),
    limit: z.coerce
      .number()
      .int('limit must be a whole number')
      .min(1, 'limit must be at least 1')
      .max(100, 'limit cannot exceed 100')
      .optional(),
  })
  .refine(notReversed, reversedMessage);

export const creditPositionQuerySchema = z.object({
  asOfDate: businessDate('asOfDate'),
});

export const partyIdParamSchema = z.object({
  id: z.string().uuid('Invalid id'),
});
