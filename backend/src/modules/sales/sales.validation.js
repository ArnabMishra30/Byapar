import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  moneySchema,
  quantitySchema,
  optionalIdQuerySchema,
  searchQuerySchema,
} from '../../utils/validation.js';
import { toDecimal } from '../../utils/money.js';

// companyId, createdById, invoiceNumber, COGS and every calculated total are
// absent by design: the server derives them. Totals sent by a client are
// ignored - the backend recalculates from quantity, price, discount and tax.

const MAX_ITEMS = 500;

const businessDateSchema = z
  .string({ required_error: 'Date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

const positiveQuantitySchema = quantitySchema('Quantity').refine(
  (value) => toDecimal(value).greaterThan(0),
  { message: 'Quantity must be greater than zero' },
);

const salesItemSchema = z
  .object({
    productId: z.string({ required_error: 'Product is required' }).uuid('Invalid productId'),
    taxId: z.string().uuid('Invalid taxId').nullable().optional(),
    quantity: positiveQuantitySchema,
    // Zero is allowed: free goods and samples are real.
    unitPrice: moneySchema('Unit price'),
    discountType: z.enum(['NONE', 'PERCENTAGE', 'FIXED']).default('NONE'),
    discountValue: moneySchema('Discount value').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === 'NONE') return;

    if (data.discountValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'Discount value is required when a discount type is set',
      });
      return;
    }

    if (data.discountType === 'PERCENTAGE' && toDecimal(data.discountValue).greaterThan(100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'A percentage discount cannot be greater than 100',
      });
    }
  });

const salesBodySchema = z
  .object({
    customerId: z.string({ required_error: 'Customer is required' }).uuid('Invalid customerId'),
    warehouseId: z.string({ required_error: 'Warehouse is required' }).uuid('Invalid warehouseId'),
    // Optional: defaults to the customer's own state. Supplying it is what a
    // bill-to / ship-to difference needs. Everything else about the tax -
    // the rates, the split, the amounts - is server-decided.
    placeOfSupplyStateCode: z
      .string()
      .trim()
      .regex(/^\d{2}$/, 'Place of supply must be a two-digit GST state code')
      .nullable()
      .optional(),
    invoiceDate: businessDateSchema,
    dueDate: businessDateSchema.nullable().optional(),
    notes: z
      .string()
      .trim()
      .max(1000, 'Notes must be at most 1000 characters')
      .nullable()
      .optional(),
    items: z
      .array(salesItemSchema)
      .min(1, 'A sales invoice must have at least one item')
      .max(MAX_ITEMS, `A sales invoice cannot have more than ${MAX_ITEMS} items`),
  })
  .superRefine((data, ctx) => {
    if (data.dueDate && data.dueDate < data.invoiceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'Due date cannot be before the invoice date',
      });
    }

    // One line per product: two lines for the same product would create two
    // confusing stock movements in one document.
    const seen = new Set();
    data.items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'productId'],
          message: 'This product appears more than once. Combine the lines into one.',
        });
      }
      seen.add(item.productId);
    });
  });

export const createSaleSchema = salesBodySchema;
export const updateSaleSchema = salesBodySchema;

export const listSalesQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  customerId: optionalIdQuerySchema('customerId'),
  warehouseId: optionalIdQuerySchema('warehouseId'),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});

/**
 * The optional body on POST /sales/:id/post.
 *
 * A credit-limit override is an ADMIN's explicit decision to extend credit past
 * a customer's limit. It is deliberately opt-in per posting rather than a
 * setting: the point is that someone chose, on this invoice, with a reason.
 *
 * The route is already ADMIN-only, so no separate permission is needed - and no
 * separate one is invented.
 */
export const postSaleSchema = z.preprocess(
  // Posting normally carries no body at all, and must keep working that way:
  // an absent body is an empty one, not a validation failure.
  (value) => value ?? {},
  z
    .object({
      creditLimitOverride: z.boolean().optional(),
      creditLimitOverrideReason: z
        .string()
        .trim()
        .min(1, 'An override reason cannot be empty')
        .max(500, 'The override reason is too long')
        .optional(),
    })
    .strict()
    .refine((data) => !data.creditLimitOverrideReason || data.creditLimitOverride === true, {
      message: 'A reason can only be given with creditLimitOverride: true',
      path: ['creditLimitOverrideReason'],
    }),
);
