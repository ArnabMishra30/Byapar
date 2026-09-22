"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { Receipt } from "lucide-react";

export default function SalesPage() {
  return (
    <ModulePlaceholder
      title="Sales & Invoicing"
      description="Create tax invoices, manage drafts, post sales, and track customer receivables."
      icon={Receipt}
      features={[
        "Draft to Posted invoice workflow with automatic stock reduction",
        "COGS freezing and weighted average valuation at time of sale",
        "Customer receivable sub-ledger posting and invoice payment allocation",
        "Sales returns with debit/credit notes and stock restoration",
        "Credit limit checks with optional admin override",
      ]}
    />
  );
}
