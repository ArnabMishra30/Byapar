import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

// Backend validation is mandatory. Never rely on frontend validation.

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(255, 'Email is too long');

// Password policy for this phase: at least 8 characters, at most 128.
// Keep it in one place so it can be tightened later without hunting through routes.
const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

const nameSchema = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must be at most 100 characters');

const roleSchema = z.enum(['ADMIN', 'STAFF'], {
  errorMap: () => ({ message: 'Role must be ADMIN or STAFF' }),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user id'),
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  role: roleSchema.optional(),
  // Query values arrive as strings, so accept "true"/"false".
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  // companyId is deliberately NOT accepted here: it always comes from the
  // authenticated admin. A client cannot create a user in another company.
  role: roleSchema.default('STAFF'),
});

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const updateUserStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive is required', invalid_type_error: 'isActive must be true or false' }),
});
