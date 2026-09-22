"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { Boxes } from "lucide-react";

export default function InventoryPage() {
  return (
    <ModulePlaceholder
      title="Inventory & Stock Management"
      description="Warehouse balances, immutable stock movements, and moving weighted average costs."
      icon={Boxes}
      features={[
        "Real-time warehouse-level inventory balance tracking",
        "Append-only immutable stock movements ledger",
        "Moving weighted average costing (no negative valuation errors)",
        "Opening stock entries and inventory adjustments with reasons",
        "Low stock threshold alerts and reorder levels",
      ]}
    />
  );
}
