import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { optionalIdQuerySchema } from '../../utils/validation.js';

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

export const listPayablesQuerySchema = paginationQuerySchema.extend({
  supplierId: optionalIdQuerySchema('supplierId'),
  status: z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'CREDITED']).optional(),
  onlyOutstanding: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  dueDateFrom: businessDateSchema.optional(),
  dueDateTo: businessDateSchema.optional(),
});

export const supplierIdParamSchema = z.object({
  supplierId: z.string().uuid('Invalid supplierId'),
});

export const ledgerQuerySchema = z.object({
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});
