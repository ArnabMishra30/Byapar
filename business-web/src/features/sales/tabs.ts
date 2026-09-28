import type { ModuleTab } from "@/components/shared/module-tabs";
import { ROUTES } from "@/lib/constants";

/** The Sales module's sub-pages, in the order a shopkeeper uses them. */
export const SALES_TABS: ModuleTab[] = [
  { label: "Overview", href: ROUTES.sales },
  { label: "Invoices", href: ROUTES.salesInvoices },
  { label: "Sales Returns", href: ROUTES.salesReturns },
];
