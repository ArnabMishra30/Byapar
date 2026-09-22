import { z } from 'zod';

// Indian GSTIN: 2 digit state code, 10 char PAN, entity number, "Z", checksum.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const nameSchema = z
  .string({ required_error: 'Company name is required' })
  .trim()
  .min(2, 'Company name must be at least 2 characters')
  .max(150, 'Company name must be at most 150 characters');

const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_PATTERN, 'Invalid GSTIN format')
  .nullable()
  .optional();

export const companyIdParamSchema = z.object({
  id: z.string().uuid('Invalid company id'),
});

export const createCompanySchema = z.object({
  name: nameSchema,
  gstin: gstinSchema,
  // The first admin of the new company. Without this the company would have no
  // way to be managed, since users can only be created by an admin of that company.
  admin: z.object({
    email: z.string({ required_error: 'Admin email is required' }).trim().toLowerCase().email('Invalid email address'),
    password: z
      .string({ required_error: 'Admin password is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters'),
    name: z
      .string({ required_error: 'Admin name is required' })
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must be at most 100 characters'),
  }),
});

export const updateCompanySchema = z
  .object({
    name: nameSchema.optional(),
    gstin: gstinSchema,
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
