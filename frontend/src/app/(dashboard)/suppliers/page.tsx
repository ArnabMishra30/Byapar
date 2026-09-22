"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { Truck } from "lucide-react";

export default function SuppliersPage() {
  return (
    <ModulePlaceholder
      title="Suppliers & Vendor Management"
      description="Manage vendor accounts, purchase records, credit terms, and payable balances."
      icon={Truck}
      features={[
        "Supplier directory with contact details, address, and optional GSTIN",
        "Immutable supplier ledger tracking every bill, return, and payment",
        "Bill-level payable allocation and advance payment handling",
        "Supplier aging summary and overdue bill schedules",
        "Seamless support for non-GST local suppliers",
      ]}
    />
  );
}
