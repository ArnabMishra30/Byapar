"use client";

import * as React from "react";
import Link from "next/link";
import { ModuleTabs } from "@/components/shared/module-tabs";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import { formatQuantity, isInward, movementReference, stockLevel, type StockLevel } from "./stock-helpers";

/** The same six tabs on every stock page, so moving between them is one tap. */
export function StockTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Dashboard", href: ROUTES.stock },
        { label: "Products", href: ROUTES.products },
        { label: "Stock In", href: ROUTES.stockIn },
        { label: "Stock Out", href: ROUTES.stockOut },
        { label: "Adjustments", href: ROUTES.stockAdjustments },
        { label: "Low Stock", href: ROUTES.lowStock },
      ]}
    />
  );
}

const LEVEL_BADGE: Record<StockLevel, { label: string; variant: "destructive" | "warning" | "success" }> = {
  out: { label: "Out of stock", variant: "destructive" },
  low: { label: "Low stock", variant: "warning" },
  ok: { label: "In stock", variant: "success" },
};

export function StockLevelBadge({
  quantity,
  reorderLevel,
  level,
}: {
  quantity?: string | number | null;
  reorderLevel?: string | number | null;
  /** Pass when the backend has already decided (e.g. isLowStock). */
  level?: StockLevel;
}) {
  const resolved = level ?? stockLevel(quantity, reorderLevel);
  const badge = LEVEL_BADGE[resolved];
  return (
    <Badge variant={badge.variant} className="whitespace-nowrap">
      {badge.label}
    </Badge>
  );
}

/** A movement quantity with its direction, e.g. "+12" in green or "-3" in red. */
export function SignedQuantity({ type, quantity }: { type: string; quantity: string }) {
  const inward = isInward(type);
  return (
    <span className={inward ? "tabular font-medium text-success" : "tabular font-medium text-destructive"}>
      {inward ? "+" : "−"}
      {formatQuantity(quantity)}
    </span>
  );
}

/** "Sale" / "Purchase" with a link to the document when there is one. */
export function ReferenceLink({
  referenceType,
  referenceId,
}: {
  referenceType?: string | null;
  referenceId?: string | null;
}) {
  const ref = movementReference(referenceType, referenceId);
  if (!ref.href) return <span className="text-muted-foreground">{ref.label}</span>;
  return (
    <Link href={ref.href} className="font-medium text-primary hover:underline">
      View {ref.label.toLowerCase()}
    </Link>
  );
}
