import type { Product, StockMovement } from "@/types/api";

/**
 * The fields the inventory and product endpoints actually return that the
 * shared types in src/types/api.ts do not (yet) declare. Kept local so this
 * area does not have to edit the shared types.
 */

export interface MovementRow extends StockMovement {
  quantityBefore?: string;
  referenceId?: string | null;
  createdBy?: { id: string; name: string } | null;
  warehouse?: { id: string; name: string; code?: string };
}

export interface ProductRecord extends Omit<Product, "sku"> {
  sku: string | null;
  barcode?: string | null;
  taxClassificationId?: string | null;
  taxClassification?: { id: string; code: string; kind: string; isActive: boolean } | null;
  categoryId?: string;
  unitId?: string;
  taxId?: string | null;
  createdAt?: string;
}
