"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, Search, ShoppingCart, Upload } from "lucide-react";
import { stockApi, type ValuationItem } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState, NoResultsState } from "@/components/shared/states";
import { Can } from "@/components/shared/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatQuantity, isOutOfStock } from "./stock-helpers";
import { StockTabs } from "./stock-ui";

type SortKey = "name" | "quantity";
type LevelFilter = "all" | "out" | "low";

function warehouseName(item: ValuationItem): string {
  if (!item.warehouse) return "—";
  return typeof item.warehouse === "string" ? item.warehouse : item.warehouse.name;
}

/**
 * What needs reordering.
 *
 * The list is the backend's own low-stock subset (quantity at or below the
 * product's minimum level). Search, sort and the out-of-stock filter only
 * rearrange those rows in the browser; nothing is recalculated.
 */
export function LowStockPage() {
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("quantity");
  const [level, setLevel] = React.useState<LevelFilter>("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["inventory-valuation", "low-stock"],
    queryFn: () => stockApi.valuation({ lowStockOnly: true }),
  });

  const rows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = (data?.items ?? []).filter((item) => {
      if (level === "out" && !isOutOfStock(item.quantity)) return false;
      if (level === "low" && isOutOfStock(item.quantity)) return false;
      if (!term) return true;
      return (
        item.product.toLowerCase().includes(term) ||
        (item.sku ?? "").toLowerCase().includes(term) ||
        warehouseName(item).toLowerCase().includes(term)
      );
    });
    return [...filtered].sort((a, b) =>
      sort === "name" ? a.product.localeCompare(b.product) : Number(a.quantity) - Number(b.quantity),
    );
  }, [data, search, sort, level]);

  const filtering = Boolean(search.trim()) || level !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Low Stock"
        description="Products at or below their minimum stock level."
        actions={
          <Can do="purchases.draft">
            <Button asChild className="min-h-[44px]">
              <Link href={ROUTES.newPurchase}>
                <ShoppingCart className="h-4 w-4" />
                <span className="hidden sm:inline">Create purchase</span>
                <span className="sm:hidden">Purchase</span>
              </Link>
            </Button>
          </Can>
        }
      />
      <StockTabs />

      {data && data.items.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative sm:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, code or warehouse"
              className="w-full pl-9"
              aria-label="Search low stock"
            />
          </div>
          <NativeSelect aria-label="Show" value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)}>
            <option value="all">Low and out of stock</option>
            <option value="out">Out of stock only</option>
            <option value="low">Low (not out) only</option>
          </NativeSelect>
          <NativeSelect aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="quantity">Least stock first</option>
            <option value="name">Name A–Z</option>
          </NativeSelect>
        </div>
      ) : null}

      {isLoading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Nothing is running low"
          description="Products appear here when their stock falls to the minimum level set on the product."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={ROUTES.products}>Set minimum levels on products</Link>
            </Button>
          }
        />
      ) : rows.length === 0 && filtering ? (
        <NoResultsState
          onClear={() => {
            setSearch("");
            setLevel("all");
          }}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} of {data.items.length} shown
          </p>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((item) => {
              const out = isOutOfStock(item.quantity);
              return (
                <li key={`${item.productId}-${warehouseName(item)}`} className="min-w-0">
                  <Card className={out ? "h-full border-destructive/40" : "h-full border-warning/40"}>
                    <CardContent className="flex h-full flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{item.product}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.sku ? `${item.sku} · ` : ""}
                            {warehouseName(item)}
                          </p>
                        </div>
                        <Badge variant={out ? "destructive" : "warning"} className="shrink-0 whitespace-nowrap">
                          {out ? "OUT OF STOCK" : "LOW STOCK"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Current stock</p>
                          <p className={out ? "tabular font-bold text-destructive" : "tabular font-bold"}>
                            {formatQuantity(item.quantity)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Minimum level</p>
                          <p className="tabular font-bold">{formatQuantity(item.reorderLevel)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {out ? "Out of stock. Please reorder now." : "Stock is running low. Please reorder."}
                      </p>
                      <div className="mt-auto flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm" className="min-h-[44px] flex-1">
                          <Link href={DETAIL_ROUTES.product(item.productId)}>
                            <Eye className="h-4 w-4" /> View
                          </Link>
                        </Button>
                        <Can do="purchases.draft">
                          <Button asChild size="sm" className="min-h-[44px] flex-1">
                            <Link href={ROUTES.newPurchase}>
                              <ShoppingCart className="h-4 w-4" /> Purchase
                            </Link>
                          </Button>
                        </Can>
                        <Button asChild variant="ghost" size="sm" className="min-h-[44px] flex-1">
                          <Link href={`${ROUTES.bills}?upload=1&direction=IN`}>
                            <Upload className="h-4 w-4" /> Upload bill
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
