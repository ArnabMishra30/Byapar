import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { quantitySchema, optionalIdQuerySchema, searchQuerySchema } from '../../utils/validation.js';
import { toDecimal } from '../../utils/money.js';

// Deliberately absent, because the server derives them:
//   companyId, warehouseId, productId, unitCost, lineTotal, grandTotal,
//   returnNumber, createdById.
// A client sending any of them is simply ignored - Zod strips unknown keys.

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
  purchaseItemId: z
    .string({ required_error: 'Purchase item is required' })
    .uuid('Invalid purchaseItemId'),
  quantity: positiveQuantitySchema,
});

const purchaseReturnBodySchema = z
  .object({
    purchaseId: z.string({ required_error: 'Purchase is required' }).uuid('Invalid purchaseId'),
    returnDate: businessDateSchema,
    reason: z.string().trim().max(200, 'Reason must be at most 200 characters').nullable().optional(),
    notes: z.string().trim().max(1000, 'Notes must be at most 1000 characters').nullable().optional(),
    items: z
      .array(returnItemSchema)
      .min(1, 'A purchase return must have at least one item')
      .max(MAX_ITEMS, `A purchase return cannot have more than ${MAX_ITEMS} items`),
  })
  .superRefine((data, ctx) => {
    // One line per purchase item, otherwise "how much of this line is left"
    // becomes ambiguous.
    const seen = new Set();
    data.items.forEach((item, index) => {
      if (seen.has(item.purchaseItemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'purchaseItemId'],
          message: 'This purchase line appears more than once. Combine the lines into one.',
        });
      }
      seen.add(item.purchaseItemId);
    });
  });

// Update takes the same complete document as create, matching how purchases work.
export const createPurchaseReturnSchema = purchaseReturnBodySchema;
export const updatePurchaseReturnSchema = purchaseReturnBodySchema;

export const listPurchaseReturnsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  purchaseId: optionalIdQuerySchema('purchaseId'),
  warehouseId: optionalIdQuerySchema('warehouseId'),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});

export const returnablePurchaseParamsSchema = z.object({
  purchaseId: z.string().uuid('Invalid purchaseId'),
});
