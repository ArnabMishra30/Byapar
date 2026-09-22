import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  nameSchema,
  codeSchema,
  isActiveQuerySchema,
  searchQuerySchema,
} from '../../utils/validation.js';

export const listUnitsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

export const createUnitSchema = z.object({
  name: nameSchema('Unit name', { max: 50 }),
  shortCode: codeSchema('Short code', { max: 10 }),
});

export const updateUnitSchema = z
  .object({
    name: nameSchema('Unit name', { max: 50 }).optional(),
    shortCode: codeSchema('Short code', { max: 10 }).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
