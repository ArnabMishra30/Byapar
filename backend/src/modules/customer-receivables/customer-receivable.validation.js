import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { optionalIdQuerySchema } from '../../utils/validation.js';

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

export const listReceivablesQuerySchema = paginationQuerySchema.extend({
  customerId: optionalIdQuerySchema('customerId'),
  status: z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'CREDITED', 'CANCELLED']).optional(),
  onlyOutstanding: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  invoiceNumber: z.string().trim().min(1).max(50).optional(),
  dueDateFrom: businessDateSchema.optional(),
  dueDateTo: businessDateSchema.optional(),
});

export const customerIdParamSchema = z.object({
  id: z.string().uuid('Invalid customer id'),
});

export const ledgerQuerySchema = z.object({
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});

export const customerPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
});
