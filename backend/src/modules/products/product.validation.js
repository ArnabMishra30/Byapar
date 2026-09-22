import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import {
  nameSchema,
  codeSchema,
  descriptionSchema,
  moneySchema,
  quantitySchema,
  isActiveQuerySchema,
  searchQuerySchema,
  optionalIdQuerySchema,
} from '../../utils/validation.js';

// SKU is optional. When present it is stored upper-case and must be unique per company.
const skuSchema = codeSchema('SKU', { max: 50 }).nullable().optional();

// Barcode is optional and free-form (EAN, UPC or an internal code).
const barcodeSchema = z
  .string()
  .trim()
  .min(4, 'Barcode must be at least 4 characters')
  .max(50, 'Barcode must be at most 50 characters')
  .nullable()
  .optional();

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: searchQuerySchema,
  categoryId: optionalIdQuerySchema('categoryId'),
  unitId: optionalIdQuerySchema('unitId'),
  taxId: optionalIdQuerySchema('taxId'),
  isActive: isActiveQuerySchema,
});

// companyId is deliberately absent: it always comes from the authenticated user.
export const createProductSchema = z.object({
  name: nameSchema('Product name'),
  sku: skuSchema,
  barcode: barcodeSchema,
  description: descriptionSchema,
  categoryId: z.string({ required_error: 'Category is required' }).uuid('Invalid categoryId'),
  unitId: z.string({ required_error: 'Unit is required' }).uuid('Invalid unitId'),
  taxId: z.string().uuid('Invalid taxId').nullable().optional(),
  // The product's HSN/SAC. Optional: an existing catalogue stays valid.
  taxClassificationId: z.string().uuid('Invalid taxClassificationId').nullable().optional(),
  purchasePrice: moneySchema('Purchase price').optional(),
  sellingPrice: moneySchema('Selling price').optional(),
  reorderLevel: quantitySchema('Reorder level').optional(),
});

export const updateProductSchema = z
  .object({
    name: nameSchema('Product name').optional(),
    sku: skuSchema,
    barcode: barcodeSchema,
    description: descriptionSchema,
    categoryId: z.string().uuid('Invalid categoryId').optional(),
    unitId: z.string().uuid('Invalid unitId').optional(),
    taxId: z.string().uuid('Invalid taxId').nullable().optional(),
  // The product's HSN/SAC. Optional: an existing catalogue stays valid.
  taxClassificationId: z.string().uuid('Invalid taxClassificationId').nullable().optional(),
    purchasePrice: moneySchema('Purchase price').optional(),
    sellingPrice: moneySchema('Selling price').optional(),
    reorderLevel: quantitySchema('Reorder level').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
