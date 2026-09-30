import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  nameSchema,
  phoneSchema,
  optionalEmailSchema,
  addressSchema,
  gstinSchema,
  moneySchema,
  isActiveQuerySchema,
  searchQuerySchema,
} from '../../utils/validation.js';

// GST is never required here. A kirana shop's regular wholesaler usually has no
// GSTIN on file, and a party without one is perfectly ordinary. A GSTIN is
// checked only when one is actually typed in.

const optionalText = (label, max) =>
  z.string().trim().max(max, `${label} is too long`).nullable().optional();

const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, 'A state code is exactly two digits')
  .nullable()
  .optional();

const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN format')
  .nullable()
  .optional();

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'A pincode is six digits')
  .nullable()
  .optional();

export const relationshipSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH'], {
  required_error: 'Choose whether this party is a customer, a supplier, or both',
  invalid_type_error: 'Relationship must be CUSTOMER, SUPPLIER or BOTH',
});

/** What belongs to one side only: their credit terms with us, or ours with them. */
const roleTermsSchema = z
  .object({
    openingBalance: moneySchema('Opening balance').optional(),
    creditLimit: moneySchema('Credit limit').optional(),
    creditDays: z
      .number()
      .int('Credit days must be a whole number of days')
      .min(0, 'Credit days cannot be negative')
      .max(3650, 'Credit days cannot exceed 3650')
      .nullable()
      .optional(),
    gstRegistrationType: z
      .enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OTHER'])
      .optional(),
  })
  .strict();

const commonFields = {
  contactPerson: optionalText('Contact person', 150),
  phone: phoneSchema,
  alternatePhone: phoneSchema,
  email: optionalEmailSchema,
  address: addressSchema,
  city: optionalText('City', 100),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
  country: optionalText('Country', 60),
  gstin: gstinSchema,
  pan: panSchema,
  notes: optionalText('Notes', 1000),
};

export const createPartySchema = z
  .object({
    name: nameSchema('Party name'),
    ...commonFields,
    relationship: relationshipSchema,
    customer: roleTermsSchema.optional(),
    supplier: roleTermsSchema.optional(),
    /**
     * Set after the shop has seen "a similar party already exists" and chosen
     * to create a new one anyway. Without it a possible duplicate is refused.
     */
    allowDuplicate: z.boolean().optional().default(false),
  })
  .strict();

export const updatePartySchema = z
  .object({
    name: nameSchema('Party name').optional(),
    ...commonFields,
    customer: roleTermsSchema.optional(),
    supplier: roleTermsSchema.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listPartiesQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
  relationship: z.enum(['ALL', 'CUSTOMER', 'SUPPLIER', 'BOTH']).optional().default('ALL'),
});

export const possibleMatchesQuerySchema = z
  .object({
    name: z.string().trim().max(150).optional(),
    phone: z.string().trim().max(30).optional(),
    alternatePhone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(255).optional(),
    gstin: z.string().trim().max(20).optional(),
    excludeId: z.string().uuid().optional(),
  })
  .refine((q) => q.name || q.phone || q.alternatePhone || q.email || q.gstin, {
    message: 'Give at least a name, phone, email or GSTIN to look for',
  });

export const addRelationshipSchema = z
  .object({
    role: z.enum(['CUSTOMER', 'SUPPLIER']),
    terms: roleTermsSchema.optional(),
  })
  .strict();

/** Link an existing customer or supplier record to this party. Exactly one. */
export const linkPartySchema = z
  .object({
    customerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
  })
  .strict()
  .refine((body) => Boolean(body.customerId) !== Boolean(body.supplierId), {
    message: 'Send exactly one of customerId or supplierId',
  });

// Ledger and statement windows reuse the credit module's schema, so a party's
// statement accepts exactly the dates a customer's or supplier's does.
export { statementQuerySchema as partyLedgerQuerySchema } from '../credit/credit.validation.js';
