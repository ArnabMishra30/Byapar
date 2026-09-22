import { z } from 'zod';
import {
  nameSchema,
  moneySchema,
  phoneSchema,
  optionalEmailSchema,
  addressSchema,
  descriptionSchema,
  gstinSchema,
  searchQuerySchema,
  isActiveQuerySchema,
  optionalIdQuerySchema,
} from '../../utils/validation.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { ALL_PERMISSIONS } from './permissions.js';

// Shapes for the SaaS layer. Same building blocks the rest of the project uses,
// so "what is a valid phone number" still has exactly one definition.

/** A business date, "YYYY-MM-DD". Matches the convention across the codebase. */
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), {
    message: 'Invalid date',
  });

const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(255, 'Email is too long');

const permissionsSchema = z
  .array(z.enum(ALL_PERMISSIONS, { errorMap: () => ({ message: 'Unknown permission' }) }))
  .max(ALL_PERMISSIONS.length);

// --- plans -----------------------------------------------------------------

export const createPlanSchema = z.object({
  name: nameSchema('Plan name', { min: 2, max: 100 }),
  description: descriptionSchema,
  // The price the operator sets. NOTHING in this system hardcodes 300 or 500 -
  // those are simply rows an admin creates.
  price: moneySchema('Price'),
  durationValue: z
    .number({ required_error: 'Duration is required' })
    .int('Duration must be a whole number')
    .positive('Duration must be greater than zero')
    .max(120, 'Duration is too long'),
  durationUnit: z.enum(['DAY', 'MONTH', 'YEAR'], {
    errorMap: () => ({ message: 'Duration unit must be DAY, MONTH or YEAR' }),
  }),
  currency: z.string().trim().toUpperCase().length(3, 'Currency must be a 3-letter code').optional(),
  isActive: z.boolean().optional(),
});

export const updatePlanSchema = createPlanSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update' },
);

export const listPlansQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

// --- subscriptions ---------------------------------------------------------

const paymentSchema = z.object({
  amount: moneySchema('Payment amount'),
  // Must match the SubscriptionPaymentMethod enum exactly - a value this
  // accepts but the database rejects is a 500 waiting for a rep in a shop.
  method: z.enum(['CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE', 'OTHER']).optional(),
  reference: z.string().trim().max(100, 'Reference is too long').nullable().optional(),
  paidAt: dateSchema.optional(),
  notes: descriptionSchema,
});

export const createSubscriptionSchema = z.object({
  companyId: z.string().uuid('Invalid business id'),
  planId: z.string().uuid('Invalid plan id'),
  /** Money taken at the same moment. Optional - a plan may be granted first. */
  payment: paymentSchema.optional(),
  notes: descriptionSchema,
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(500, 'Reason is too long'),
});

export const recordPaymentSchema = paymentSchema;

export const listSubscriptionsQuerySchema = paginationQuerySchema.extend({
  companyId: optionalIdQuerySchema('business id'),
  status: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
  /**
   * "Which shops need chasing in the next fortnight?" - a window in days rather
   * than a date, because that is the question a sales team actually asks, and it
   * does not go stale in a bookmark.
   */
  expiringWithinDays: z.coerce
    .number()
    .int('Give a whole number of days')
    .positive('The window must be at least a day')
    .max(365, 'That window is too wide')
    .optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  collectedById: optionalIdQuerySchema('staff id'),
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
});

// --- manual grants and recharges -------------------------------------------

/**
 * How an admin may record a manual recharge.
 *
 * NOTE WHAT IS ABSENT: any gateway field. There is no order id, no signature, no
 * webhook payload, because no gateway is involved and none is planned for this
 * phase.
 */
const grantMethodSchema = z.enum(
  ['MANUAL', 'CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE', 'ADMIN_GRANT', 'OTHER'],
  { errorMap: () => ({ message: 'Choose how the money was collected, or ADMIN_GRANT for a free grant' }) },
);

export const grantSubscriptionSchema = z.object({
  companyId: z.string().uuid('Invalid business id'),
  planId: z.string().uuid('Invalid plan id'),

  /**
   * REQUIRED, always. A subscription somebody was given rather than sold has to
   * carry the reason, or nobody can later answer why this shop has free access.
   */
  reason: z
    .string({ required_error: 'A reason is required' })
    .trim()
    .min(3, 'Say why this subscription is being granted')
    .max(500, 'Reason is too long'),

  /**
   * Optional, and absent means FREE. A promotional grant records 0 and writes no
   * payment row at all, rather than a zero-rupee payment that would dress a gift
   * up as a transaction.
   */
  amount: moneySchema('Amount').optional(),
  method: grantMethodSchema.optional(),
  reference: z.string().trim().max(100, 'Reference is too long').nullable().optional(),

  /** Case D: override the plan's own duration. Both or neither. */
  durationValue: z
    .number()
    .int('Duration must be a whole number')
    .positive('Duration must be greater than zero')
    .max(120, 'Duration is too long')
    .optional(),
  durationUnit: z.enum(['DAY', 'MONTH', 'YEAR']).optional(),
});

export const previewGrantQuerySchema = z.object({
  planId: z.string().uuid('Invalid plan id'),
  durationValue: z.coerce.number().int().positive().max(120).optional(),
  durationUnit: z.enum(['DAY', 'MONTH', 'YEAR']).optional(),
});

// --- shop onboarding -------------------------------------------------------

export const onboardShopSchema = z.object({
  name: nameSchema('Business name'),
  phone: phoneSchema,
  email: optionalEmailSchema,
  city: z.string().trim().max(100, 'City is too long').nullable().optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Pincode must be 6 digits')
    .nullable()
    .optional(),
  address: addressSchema,

  // GST IS OPTIONAL. A shop with no registration simply omits both fields, and
  // the application stays in non-GST mode for them permanently.
  gstin: gstinSchema,
  stateCode: z
    .string()
    .trim()
    .regex(/^[0-9]{2}$/, 'State code must be 2 digits')
    .nullable()
    .optional(),

  owner: z.object({
    name: nameSchema('Owner name'),
    email: emailSchema,
    password: passwordSchema,
  }),

  /** Sell a plan in the same breath. Optional. */
  planId: z.string().uuid('Invalid plan id').optional(),
  payment: paymentSchema.optional(),
});

export const listShopsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
  onboardedById: optionalIdQuerySchema('staff id'),
  /** "Only the shops I signed up." */
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

// --- sales team ------------------------------------------------------------

export const createStaffSchema = z.object({
  name: nameSchema('Name'),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['PLATFORM_ADMIN', 'SALES_STAFF']).optional(),
  permissions: permissionsSchema.optional(),
});

export const updateStaffSchema = z
  .object({
    name: nameSchema('Name').optional(),
    role: z.enum(['PLATFORM_ADMIN', 'SALES_STAFF']).optional(),
    permissions: permissionsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listStaffQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

export { dateSchema };
