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
  /** ITEM = ordinary products only (e.g. for purchases), COMBO = combos only. */
  kind: z.enum(['ALL', 'ITEM', 'COMBO']).optional(),
});

// companyId is deliberately absent: it always comes from the authenticated user.
/** One content of a combo: which product, and how many go into ONE combo. */
const comboComponentSchema = z.object({
  productId: z.string().uuid('Invalid productId'),
  quantity: quantitySchema('Quantity').refine((value) => Number(value) > 0, {
    message: 'Quantity must be more than zero',
  }),
});
export const comboComponentsSchema = z.array(comboComponentSchema).min(1, 'Add at least one item').max(50);

export const createProductSchema = z
  .object({
  name: nameSchema('Product name'),
  /** A combo holds no stock; category and unit default to "Combos" / Piece. */
  isCombo: z.boolean().optional().default(false),
  components: comboComponentsSchema.optional(),
  sku: skuSchema,
  barcode: barcodeSchema,
  description: descriptionSchema,
  categoryId: z.string().uuid('Invalid categoryId').optional(),
  unitId: z.string().uuid('Invalid unitId').optional(),
  taxId: z.string().uuid('Invalid taxId').nullable().optional(),
  // The product's HSN/SAC. Optional: an existing catalogue stays valid.
  taxClassificationId: z.string().uuid('Invalid taxClassificationId').nullable().optional(),
  // Where it is usually kept: a rack, drawer, fridge. Optional.
  storageLocationId: z.string().uuid('Invalid storageLocationId').nullable().optional(),
  purchasePrice: moneySchema('Purchase price').optional(),
  sellingPrice: moneySchema('Selling price').optional(),
  reorderLevel: quantitySchema('Reorder level').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isCombo) {
      if (!data.components || data.components.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['components'], message: 'Add the items that make up this combo' });
      }
      return;
    }
    if (!data.categoryId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryId'], message: 'Category is required' });
    if (!data.unitId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitId'], message: 'Unit is required' });
    if (data.components) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['components'], message: 'Only a combo has contents' });
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
  // Where it is usually kept: a rack, drawer, fridge. Optional.
  storageLocationId: z.string().uuid('Invalid storageLocationId').nullable().optional(),
    purchasePrice: moneySchema('Purchase price').optional(),
    sellingPrice: moneySchema('Selling price').optional(),
    reorderLevel: quantitySchema('Reorder level').optional(),
    /** Replace a combo's contents. Only for a product that is a combo. */
    components: comboComponentsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

/** A combo made while billing. Saved for later only when asked. */
export const onTheSpotComboSchema = z
  .object({
    name: nameSchema('Combo name'),
    sellingPrice: moneySchema('Price'),
    taxId: z.string().uuid('Invalid taxId').nullable().optional(),
    components: comboComponentsSchema,
    saveForLater: z.boolean().optional().default(false),
  })
  .strict();
