"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { ShoppingCart } from "lucide-react";

export default function PurchasesPage() {
  return (
    <ModulePlaceholder
      title="Purchases & Supplier Bills"
      description="Record bills from suppliers, manage inventory intake, and track payables."
      icon={ShoppingCart}
      features={[
        "Draft purchase bills that do not affect stock until posted",
        "Moving weighted average unit cost calculation on posting",
        "Automatic supplier payable entry creation with due dates",
        "Purchase returns with partial quantity tracking at original purchase cost",
        "Dual GST snapshot (CGST/SGST/IGST) when GST is enabled",
      ]}
    />
  );
}
