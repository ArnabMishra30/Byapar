import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  moneySchema,
  quantitySchema,
  optionalIdQuerySchema,
  searchQuerySchema,
} from '../../utils/validation.js';
import { toDecimal } from '../../utils/money.js';

// companyId, createdById, purchaseNumber and every calculated total are absent by
// design: they come from the server. Totals sent by a client are ignored, never
// trusted - the backend recalculates from quantity, cost, discount and tax.

const MAX_ITEMS = 500;

// A business date, e.g. "2026-08-28". Not a timestamp: an invoice date must not
// move because of a timezone.
const businessDateSchema = z
  .string({ required_error: 'Date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

const positiveQuantitySchema = quantitySchema('Quantity').refine(
  (value) => toDecimal(value).greaterThan(0),
  { message: 'Quantity must be greater than zero' },
);

const purchaseItemSchema = z
  .object({
    productId: z.string({ required_error: 'Product is required' }).uuid('Invalid productId'),
    taxId: z.string().uuid('Invalid taxId').nullable().optional(),
    quantity: positiveQuantitySchema,
    // Zero is allowed: free goods and samples are real.
    unitCost: moneySchema('Unit cost'),
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

const purchaseBodySchema = z
  .object({
    supplierId: z.string({ required_error: 'Supplier is required' }).uuid('Invalid supplierId'),
    warehouseId: z.string({ required_error: 'Warehouse is required' }).uuid('Invalid warehouseId'),
    invoiceNumber: z
      .string({ required_error: 'Supplier invoice number is required' })
      .trim()
      .min(1, 'Supplier invoice number is required')
      .max(50, 'Invoice number must be at most 50 characters'),
    invoiceDate: businessDateSchema,
    dueDate: businessDateSchema.nullable().optional(),
    notes: z
      .string()
      .trim()
      .max(1000, 'Notes must be at most 1000 characters')
      .nullable()
      .optional(),
    items: z
      .array(purchaseItemSchema)
      .min(1, 'A purchase must have at least one item')
      .max(MAX_ITEMS, `A purchase cannot have more than ${MAX_ITEMS} items`),
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

// Create and update take the same complete document. A partial item patch would
// be far harder for a client to get right than sending the whole line list.
export const createPurchaseSchema = purchaseBodySchema;
export const updatePurchaseSchema = purchaseBodySchema;

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  supplierId: optionalIdQuerySchema('supplierId'),
  warehouseId: optionalIdQuerySchema('warehouseId'),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});
