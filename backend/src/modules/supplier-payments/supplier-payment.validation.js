import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { moneySchema, optionalIdQuerySchema, searchQuerySchema } from '../../utils/validation.js';
import { toDecimal } from '../../utils/money.js';

// companyId, createdById, paymentNumber, allocatedAmount and unallocatedAmount
// are absent by design: the server derives them.

const MAX_ALLOCATIONS = 200;

const businessDateSchema = z
  .string({ required_error: 'Payment date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Invalid date' });

const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER'], {
  errorMap: () => ({ message: 'Payment method must be CASH, BANK_TRANSFER, UPI, CHEQUE or OTHER' }),
});

const positiveMoneySchema = moneySchema('Amount').refine(
  (value) => toDecimal(value).greaterThan(0),
  { message: 'Amount must be greater than zero' },
);

const allocationSchema = z.object({
  payableId: z.string({ required_error: 'Payable is required' }).uuid('Invalid payableId'),
  amount: moneySchema('Allocation amount').refine((value) => toDecimal(value).greaterThan(0), {
    message: 'Allocation amount must be greater than zero',
  }),
});

const paymentBodySchema = z
  .object({
    supplierId: z.string({ required_error: 'Supplier is required' }).uuid('Invalid supplierId'),
    paymentDate: businessDateSchema,
    amount: positiveMoneySchema,
    paymentMethod: paymentMethodSchema,
    referenceNumber: z
      .string()
      .trim()
      .max(100, 'Reference number must be at most 100 characters')
      .nullable()
      .optional(),
    notes: z.string().trim().max(1000, 'Notes must be at most 1000 characters').nullable().optional(),
    // Optional: a payment with no allocations is a supplier advance.
    allocations: z.array(allocationSchema).max(MAX_ALLOCATIONS).optional().default([]),
  })
  .superRefine((data, ctx) => {
    // One line per bill, otherwise the amount applied to a bill is ambiguous.
    const seen = new Set();
    data.allocations.forEach((allocation, index) => {
      if (seen.has(allocation.payableId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allocations', index, 'payableId'],
          message: 'This bill appears more than once. Combine the allocations into one.',
        });
      }
      seen.add(allocation.payableId);
    });
  });

export const createSupplierPaymentSchema = paymentBodySchema;
export const updateSupplierPaymentSchema = paymentBodySchema;

export const listSupplierPaymentsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  supplierId: optionalIdQuerySchema('supplierId'),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  paymentMethod: paymentMethodSchema.optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
});
