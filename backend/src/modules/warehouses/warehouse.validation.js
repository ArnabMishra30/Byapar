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
  codeSchema,
  addressSchema,
  isActiveQuerySchema,
  searchQuerySchema,
} from '../../utils/validation.js';

export const listWarehousesQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  isActive: isActiveQuerySchema,
});

export const createWarehouseSchema = z.object({
  name: nameSchema('Warehouse name', { max: 100 }),
  code: codeSchema('Warehouse code', { max: 20 }),
  address: addressSchema,
  stateCode: stateCodeSchema,
});

export const updateWarehouseSchema = z
  .object({
    name: nameSchema('Warehouse name', { max: 100 }).optional(),
    code: codeSchema('Warehouse code', { max: 20 }).optional(),
    address: addressSchema,
  stateCode: stateCodeSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
