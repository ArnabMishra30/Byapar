"use client";

import { ModuleTabs } from "@/components/shared/module-tabs";
import { ROUTES } from "@/lib/constants";

/**
 * The sub-page tabs for Sales and Purchases, defined once so the returns and
 * payables screens show exactly the same row as the rest of the module.
 */
export function SalesModuleTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Overview", href: ROUTES.sales },
        { label: "Invoices", href: ROUTES.salesInvoices },
        { label: "Sales Returns", href: ROUTES.salesReturns },
      ]}
    />
  );
}

export function PurchaseModuleTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Overview", href: ROUTES.purchases },
        { label: "Purchase Bills", href: ROUTES.purchaseBills },
        { label: "Purchase Returns", href: ROUTES.purchaseReturns },
        { label: "Supplier Payables", href: ROUTES.supplierPayables },
      ]}
    />
  );
}
