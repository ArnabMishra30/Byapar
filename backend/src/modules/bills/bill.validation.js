import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { createPurchaseSchema } from '../purchases/purchase.validation.js';
import { createSaleSchema } from '../sales/sales.validation.js';
import { extractionSchema } from './bill-extraction.service.js';

// The shapes for bill import.
//
// The important one is `confirmBillSchema`. What a human confirms is not a
// loosened, AI-flavoured variant of a purchase - it IS a purchase, validated by
// the EXACT schema the ordinary purchase form uses, imported from that module.
// A bill that came from a photograph therefore cannot get anything past
// validation that a typed bill could not.

const businessDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

export const uploadBillSchema = z.object({
  direction: z.enum(['IN', 'OUT'], {
    errorMap: () => ({ message: 'Direction must be IN (a bill you received) or OUT (a bill you issued)' }),
  }),
});

/** Saving corrections mid-review. Same shape the extractor is held to. */
export const saveReviewSchema = z.object({
  reviewedData: extractionSchema,
});

/**
 * Which schema a confirmed bill is held to, by direction.
 *
 *   IN  -> the purchase form's schema
 *   OUT -> the sales form's schema
 *
 * Imported, not redefined. If someone adds a required field to purchases
 * tomorrow, imported bills require it the same day.
 */
export const DOCUMENT_SCHEMA_BY_DIRECTION = {
  IN: createPurchaseSchema,
  OUT: createSaleSchema,
};

/**
 * Confirming a bill.
 *
 * `document` is deliberately NOT validated here. Which shape is correct depends
 * on the bill's direction, and that is a fact about the stored bill, not about
 * the request - so it is read from the database and applied in the service.
 * Validating a union here instead would report "expected a customerId" on a
 * supplier bill, which is a worse error than no error.
 */
export const confirmBillSchema = z.object({
  document: z.record(z.unknown()),
  /**
   * Whether to post immediately or leave a draft. Defaults to posting: a shop
   * confirming a bill has already reviewed it, and leaving silent drafts behind
   * is how documents get forgotten.
   */
  postImmediately: z.boolean().optional().default(true),
});

export const cancelBillSchema = z.object({
  reason: z.string().trim().max(500, 'Reason is too long').optional(),
});

export const listBillsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['UPLOADED', 'PROCESSING', 'REVIEW', 'POSTED', 'FAILED', 'CANCELLED']).optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});
