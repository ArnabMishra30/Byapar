import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  nameSchema,
  descriptionSchema,
  isActiveQuerySchema,
  searchQuerySchema,
} from '../../utils/validation.js';

export const listCategoriesQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

// companyId is deliberately absent: it always comes from the authenticated user.
export const createCategorySchema = z.object({
  name: nameSchema('Category name'),
  description: descriptionSchema,
});

export const updateCategorySchema = z
  .object({
    name: nameSchema('Category name').optional(),
    description: descriptionSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
