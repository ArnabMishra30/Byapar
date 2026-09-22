import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { moneySchema, quantitySchema, optionalIdQuerySchema } from '../../utils/validation.js';
import { toDecimal } from '../../utils/money.js';

// companyId and createdById are deliberately absent from every schema: they come
// from the authenticated user, never from the request.

const movementTypeSchema = z.enum(
  ['OPENING_STOCK', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'],
  { errorMap: () => ({ message: 'Invalid stock movement type' }) },
);

const adjustmentTypeSchema = z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'], {
  errorMap: () => ({ message: 'Type must be ADJUSTMENT_IN or ADJUSTMENT_OUT' }),
});

// quantitySchema allows zero; a stock movement of zero is meaningless, so require
// a positive value. Compared with Decimal, never with Number.
const positiveQuantitySchema = quantitySchema('Quantity').refine(
  (value) => toDecimal(value).greaterThan(0),
  { message: 'Quantity must be greater than zero' },
);

const notesSchema = z.string().trim().max(500, 'Notes must be at most 500 characters').nullable().optional();

const productIdSchema = z.string({ required_error: 'Product is required' }).uuid('Invalid productId');
const warehouseIdSchema = z.string({ required_error: 'Warehouse is required' }).uuid('Invalid warehouseId');

export const openingStockSchema = z.object({
  productId: productIdSchema,
  warehouseId: warehouseIdSchema,
  quantity: positiveQuantitySchema,
  // Zero is allowed: stock can genuinely have been free or written down.
  unitCost: moneySchema('Unit cost'),
  notes: notesSchema,
});

export const adjustmentSchema = z
  .object({
    productId: productIdSchema,
    warehouseId: warehouseIdSchema,
    type: adjustmentTypeSchema,
    quantity: positiveQuantitySchema,
    unitCost: moneySchema('Unit cost').optional(),
    notes: notesSchema,
  })
  .superRefine((data, ctx) => {
    // Incoming stock must state what it cost, otherwise the average is meaningless.
    if (data.type === 'ADJUSTMENT_IN' && data.unitCost === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unitCost'],
        message: 'Unit cost is required for ADJUSTMENT_IN',
      });
    }
    // Outgoing stock is always valued at the current average cost, so accepting a
    // cost from the client would be misleading.
    if (data.type === 'ADJUSTMENT_OUT' && data.unitCost !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unitCost'],
        message: 'Unit cost is not accepted for ADJUSTMENT_OUT: the current average cost is used',
      });
    }
  });

export const listInventoryQuerySchema = paginationQuerySchema.extend({
  productId: optionalIdQuerySchema('productId'),
  warehouseId: optionalIdQuerySchema('warehouseId'),
});

export const balanceParamsSchema = z.object({
  productId: z.string().uuid('Invalid productId'),
  warehouseId: z.string().uuid('Invalid warehouseId'),
});

export const listMovementsQuerySchema = paginationQuerySchema.extend({
  productId: optionalIdQuerySchema('productId'),
  warehouseId: optionalIdQuerySchema('warehouseId'),
  type: movementTypeSchema.optional(),
  fromDate: z.coerce.date({ errorMap: () => ({ message: 'fromDate must be a valid date' }) }).optional(),
  toDate: z.coerce.date({ errorMap: () => ({ message: 'toDate must be a valid date' }) }).optional(),
});
