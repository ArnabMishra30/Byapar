import { z } from 'zod';

// A GST state code, and how the party is registered. Both optional, so a
// business that does not use GST never has to think about them - but both are
// required by a posting once the company itself has enabled GST.
const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, 'A GST state code is exactly two digits')
  .nullable()
  .optional();

const gstRegistrationTypeSchema = z
  .enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OTHER'])
  .optional();

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

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

export const createCustomerSchema = z.object({
  name: nameSchema('Customer name'),
  phone: phoneSchema,
  email: optionalEmailSchema,
  address: addressSchema,
  gstin: gstinSchema,
  stateCode: stateCodeSchema,
  gstRegistrationType: gstRegistrationTypeSchema,
  openingBalance: moneySchema('Opening balance').optional(),
  creditLimit: moneySchema('Credit limit').optional(),
  // Payment terms in days. Null clears them; 0 means "due on the invoice date".
  creditDays: z
    .number()
    .int('Credit days must be a whole number of days')
    .min(0, 'Credit days cannot be negative')
    .max(3650, 'Credit days cannot exceed 3650')
    .nullable()
    .optional(),
});

export const updateCustomerSchema = z
  .object({
    name: nameSchema('Customer name').optional(),
    phone: phoneSchema,
    email: optionalEmailSchema,
    address: addressSchema,
    gstin: gstinSchema,
  stateCode: stateCodeSchema,
  gstRegistrationType: gstRegistrationTypeSchema,
    openingBalance: moneySchema('Opening balance').optional(),
    creditLimit: moneySchema('Credit limit').optional(),
  // Payment terms in days. Null clears them; 0 means "due on the invoice date".
  creditDays: z
    .number()
    .int('Credit days must be a whole number of days')
    .min(0, 'Credit days cannot be negative')
    .max(3650, 'Credit days cannot exceed 3650')
    .nullable()
    .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
