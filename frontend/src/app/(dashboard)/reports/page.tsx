"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Business Reports & Accounting Statements"
      description="Financial statements, sales/purchase analysis, inventory valuation, and general ledger reports."
      icon={BarChart3}
      features={[
        "Sales, Purchases, and Expense operational breakdown reports",
        "Customer and Supplier aging & outstanding balances",
        "Cash & Bank flow summaries",
        "Inventory valuation with moving weighted average unit cost",
        "Double-entry Trial Balance, Profit & Loss, and Balance Sheet",
      ]}
    />
  );
}
