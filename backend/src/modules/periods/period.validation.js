import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

// Zod schemas for accounting periods.
//
// No GST field appears here, and none should: closing a month has nothing to do
// with tax registration.

/**
 * A business date, "YYYY-MM-DD", stored at UTC midnight so it cannot shift.
 *
 * The round trip matters. `new Date("2026-02-30")` does not fail - it rolls
 * forward and quietly becomes 2 March. A NaN check never sees it. Formatting the
 * parsed date back and comparing is what catches an impossible calendar day, and
 * a period boundary that silently moves is precisely the bug worth refusing.
 */
function businessDate(label) {
  return z
    .string({ required_error: `${label} is required` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .refine(
      (value) => {
        // A month of 13 gives an Invalid Date, whose toISOString throws, so the
        // validity check has to come first.
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) return false;
        return parsed.toISOString().slice(0, 10) === value;
      },
      { message: `${label} is not a real calendar date` },
    )
    .transform((value) => new Date(`${value}T00:00:00.000Z`));
}

export const createPeriodSchema = z
  .object({
    name: z
      .string({ required_error: 'A period name is required' })
      .trim()
      .min(1, 'A period name cannot be empty')
      .max(100, 'The period name is too long'),
    startDate: businessDate('startDate'),
    endDate: businessDate('endDate'),
  })
  .strict()
  .refine((data) => data.startDate <= data.endDate, {
    message: 'A period cannot end before it starts',
    path: ['endDate'],
  });

export const reopenPeriodSchema = z.preprocess(
  // Reopening normally carries no body; an absent one is an empty one.
  (value) => value ?? {},
  z
    .object({
      reason: z
        .string()
        .trim()
        .min(1, 'A reason cannot be empty')
        .max(500, 'The reason is too long')
        .optional(),
    })
    .strict(),
);

export const listPeriodsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

/** "May I post on this date?" - so a client can grey out a date picker. */
export const checkDateQuerySchema = z.object({
  date: businessDate('date'),
});
