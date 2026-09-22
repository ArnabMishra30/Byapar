import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { quantitySchema, optionalIdQuerySchema, searchQuerySchema } from '../../utils/validation.js';
import { toDecimal } from '../../utils/money.js';

// Deliberately absent, because the server derives them:
//   companyId, customerId, warehouseId, productId, unitPrice, discount, tax,
//   line totals, grandTotal, COGS, returnNumber, createdById.
// A client sending any of them is ignored - Zod strips unknown keys.

const MAX_ITEMS = 500;

const businessDateSchema = z
  .string({ required_error: 'Return date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

const positiveQuantitySchema = quantitySchema('Quantity').refine(
  (value) => toDecimal(value).greaterThan(0),
  { message: 'Quantity must be greater than zero' },
);

const returnItemSchema = z.object({
  salesInvoiceItemId: z
    .string({ required_error: 'Invoice line is required' })
    .uuid('Invalid salesInvoiceItemId'),
  quantity: positiveQuantitySchema,
});

const salesReturnBodySchema = z
  .object({
    salesInvoiceId: z
      .string({ required_error: 'Sales invoice is required' })
      .uuid('Invalid salesInvoiceId'),
    returnDate: businessDateSchema,
    reason: z.string().trim().max(200, 'Reason must be at most 200 characters').nullable().optional(),
    notes: z.string().trim().max(1000, 'Notes must be at most 1000 characters').nullable().optional(),
    items: z
      .array(returnItemSchema)
      .min(1, 'A sales return must have at least one item')
      .max(MAX_ITEMS, `A sales return cannot have more than ${MAX_ITEMS} items`),
  })
  .superRefine((data, ctx) => {
    // One line per invoice line, otherwise the remaining-quantity arithmetic
    // becomes ambiguous.
    const seen = new Set();
    data.items.forEach((item, index) => {
      if (seen.has(item.salesInvoiceItemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'salesInvoiceItemId'],
          message: 'This invoice line appears more than once. Combine the lines into one.',
        });
      }
      seen.add(item.salesInvoiceItemId);
    });
  });

export const createSalesReturnSchema = salesReturnBodySchema;
export const updateSalesReturnSchema = salesReturnBodySchema;

export const listSalesReturnsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  salesInvoiceId: optionalIdQuerySchema('salesInvoiceId'),
  customerId: optionalIdQuerySchema('customerId'),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});

export const returnableInvoiceParamsSchema = z.object({
  salesInvoiceId: z.string().uuid('Invalid salesInvoiceId'),
});
