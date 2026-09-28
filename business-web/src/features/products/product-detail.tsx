"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { inventoryApi, productsApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DetailRow } from "@/components/shared/form-parts";
import { GstOnly } from "@/components/shared/gst-gate";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROUTES } from "@/lib/constants";
import { MovementList } from "@/features/stock/movement-list";
import { formatQuantity } from "@/features/stock/stock-helpers";
import { StockLevelBadge, StockTabs } from "@/features/stock/stock-ui";
import type { ProductRecord } from "@/features/stock/types";
import { ProductFormDialog } from "./product-form-dialog";

/**
 * One product: its details, stock in each warehouse and every movement.
 *
 * Stock, average cost and value per warehouse are the inventory balances as
 * the backend holds them. The only thing decided here is the badge, which
 * compares the backend quantity with the product's minimum level.
 */
export function ProductDetail({ id }: { id: string }) {
  const [editOpen, setEditOpen] = React.useState(false);

  const product = useQuery({
    queryKey: ["product", id],
    queryFn: () => productsApi.get(id) as unknown as Promise<ProductRecord>,
  });

  const balances = useQuery({
    queryKey: ["inventory", "balances", "product", id],
    queryFn: () => inventoryApi.balances({ productId: id, limit: 100 }),
  });

  if (product.isLoading) return <LoadingState rows={5} />;
  if (product.error || !product.data) {
    return <ErrorState error={product.error} onRetry={() => product.refetch()} />;
  }

  const p = product.data;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 min-h-[44px]" data-print-hide>
        <Link href={ROUTES.products}>
          <ArrowLeft className="h-4 w-4" /> Products
        </Link>
      </Button>
      <PageHeader
        title={p.name}
        description={[p.sku, p.category?.name].filter(Boolean).join(" · ") || undefined}
        actions={
          <Can do="products.manage">
            <Button className="min-h-[44px]" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          </Can>
        }
      />
      <StockTabs />

      <div className="flex flex-wrap gap-2">
        {!p.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
        <Can do="inventory.adjust">
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link href={`${ROUTES.stockAdjustments}?productId=${p.id}`}>
              <SlidersHorizontal className="h-4 w-4" /> Adjust stock
            </Link>
          </Button>
        </Can>
        <Can do="purchases.draft">
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link href={ROUTES.newPurchase}>
              <ShoppingCart className="h-4 w-4" /> Create purchase
            </Link>
          </Button>
        </Can>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRow label="Item code / SKU">{p.sku || "—"}</DetailRow>
            <DetailRow label="Barcode">{p.barcode || "—"}</DetailRow>
            <DetailRow label="Category">{p.category?.name ?? "—"}</DetailRow>
            <DetailRow label="Unit">{p.unit ? `${p.unit.name} (${p.unit.shortCode})` : "—"}</DetailRow>
            <GstOnly>
              <DetailRow label="GST">{p.tax ? `${p.tax.name} (${Number(p.tax.rate)}%)` : "No tax"}</DetailRow>
              <DetailRow label="HSN / SAC">{p.taxClassification?.code ?? "—"}</DetailRow>
            </GstOnly>
            <DetailRow label="Status">{p.isActive ? "Active" : "Inactive"}</DetailRow>
            {p.description ? <DetailRow label="Description">{p.description}</DetailRow> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Prices</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRow label="Purchase price">
              <Money value={p.purchasePrice} />
            </DetailRow>
            <DetailRow label="Selling price">
              <Money value={p.sellingPrice} />
            </DetailRow>
            <DetailRow label="Minimum stock level">{formatQuantity(p.reorderLevel ?? 0)}</DetailRow>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock by warehouse</CardTitle>
        </CardHeader>
        <CardContent>
          {balances.isLoading ? (
            <LoadingState rows={2} />
          ) : balances.error ? (
            <ErrorState error={balances.error} onRetry={() => balances.refetch()} />
          ) : !balances.data || balances.data.items.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No stock recorded yet. Add opening stock or record a purchase.
            </p>
          ) : (
            <ul className="divide-y">
              {balances.data.items.map((b) => (
                <li key={b.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{b.warehouse.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Avg. cost <Money value={b.averageCost} /> · Value <Money value={b.inventoryValue} />
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular text-lg font-bold">{formatQuantity(b.quantity)}</span>
                    <span className="text-xs text-muted-foreground">{p.unit?.shortCode}</span>
                    <StockLevelBadge quantity={b.quantity} reorderLevel={p.reorderLevel} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock history</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="all" className="min-h-[40px]">All movements</TabsTrigger>
              <TabsTrigger value="in" className="min-h-[40px]">Recent purchases (stock in)</TabsTrigger>
              <TabsTrigger value="out" className="min-h-[40px]">Recent sales (stock out)</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <MovementList
                types={["", "OPENING_STOCK", "STOCK_IN", "STOCK_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]}
                columnSet="all"
                productId={p.id}
                emptyTitle="No movements yet"
                emptyDescription="Opening stock, purchases, sales and adjustments of this product show here."
              />
            </TabsContent>
            <TabsContent value="in">
              <MovementList
                types={["STOCK_IN"]}
                columnSet="in"
                productId={p.id}
                limit={10}
                emptyTitle="No purchases of this product yet"
              />
            </TabsContent>
            <TabsContent value="out">
              <MovementList
                types={["STOCK_OUT"]}
                columnSet="out"
                productId={p.id}
                limit={10}
                emptyTitle="No sales of this product yet"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} product={p} />
    </div>
  );
}
