import type { ModuleTab } from "@/components/shared/module-tabs";
import { ROUTES } from "@/lib/constants";

/** The Purchase module's sub-pages. */
export const PURCHASE_TABS: ModuleTab[] = [
  { label: "Overview", href: ROUTES.purchases },
  { label: "Purchase Bills", href: ROUTES.purchaseBills },
  { label: "Purchase Returns", href: ROUTES.purchaseReturns },
  { label: "Supplier Payables", href: ROUTES.supplierPayables },
];
