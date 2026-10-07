import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { isActiveQuerySchema, searchQuerySchema, optionalIdQuerySchema } from '../../utils/validation.js';

export const LOCATION_TYPES = ['RACK', 'SHELF', 'DRAWER', 'FRIDGE', 'FREEZER', 'COUNTER', 'BIN', 'BOX', 'OTHER'];

const typeSchema = z.enum(LOCATION_TYPES, {
  invalid_type_error: `Type must be one of ${LOCATION_TYPES.join(', ')}`,
});

const nameSchema = z
  .string({ required_error: 'Location name is required' })
  .trim()
  .min(1, 'Location name is required')
  .max(80, 'Location name must be at most 80 characters');

const codeSchema = z.string().trim().toUpperCase().max(20, 'Code must be at most 20 characters').nullable().optional();
const notesSchema = z.string().trim().max(300, 'Notes must be at most 300 characters').nullable().optional();
const sortOrderSchema = z.number().int().min(0).max(100000).optional();

export const listLocationsQuerySchema = paginationQuerySchema.extend({
  warehouseId: optionalIdQuerySchema('warehouseId'),
  type: typeSchema.optional(),
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

export const createLocationSchema = z
  .object({
    warehouseId: z.string({ required_error: 'Warehouse is required' }).uuid('Invalid warehouseId'),
    name: nameSchema,
    type: typeSchema.optional().default('RACK'),
    code: codeSchema,
    notes: notesSchema,
    sortOrder: sortOrderSchema,
  })
  .strict();

// The warehouse is fixed once created: moving a location to another godown
// would silently change where its past movements say the stock was.
export const updateLocationSchema = z
  .object({
    name: nameSchema.optional(),
    type: typeSchema.optional(),
    code: codeSchema,
    notes: notesSchema,
    sortOrder: sortOrderSchema,
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' });

export const starterLocationsSchema = z
  .object({ warehouseId: z.string({ required_error: 'Warehouse is required' }).uuid('Invalid warehouseId') })
  .strict();
