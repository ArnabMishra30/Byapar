"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Plus, Power, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ApiError, categoriesApi, productsApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { GstOnly } from "@/components/shared/gst-gate";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/select-native";
import { useAuth } from "@/lib/auth/auth-context";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatQuantity } from "@/features/stock/stock-helpers";
import { StockTabs } from "@/features/stock/stock-ui";
import type { ProductRecord } from "@/features/stock/types";
import { ProductFormDialog } from "./product-form-dialog";

/**
 * The product catalogue: search, category and active filters are all sent to
 * the backend, so paging stays right on a large catalogue.
 */
export function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { can, isGstEnabled } = useAuth();
  const list = useListState({ limit: 20 });
  const [searchInput, setSearchInput] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [active, setActive] = React.useState<"true" | "false" | "">("true");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProductRecord | null>(null);
  const [toggling, setToggling] = React.useState<ProductRecord | null>(null);

  // Debounce so typing does not fire a request per key.
  React.useEffect(() => {
    const timer = setTimeout(() => list.setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // ?new=1 (from the dashboard, command menu or a bill) opens the add form once.
  React.useEffect(() => {
    if (params?.get("new") === "1" && can("products.manage")) {
      setEditing(null);
      setFormOpen(true);
      router.replace(pathname ?? ROUTES.products);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const categories = useQuery({
    queryKey: ["categories", "options"],
    queryFn: () => categoriesApi.list({ limit: 100, isActive: "true" }),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["products", "list", list.page, list.search, categoryId, active],
    queryFn: () =>
      productsApi.list({
        page: list.page,
        limit: list.limit,
        search: list.search || undefined,
        categoryId: categoryId || undefined,
        isActive: active || undefined,
      }) as unknown as Promise<{
        items: ProductRecord[];
        pagination: { page: number; totalPages: number; total: number };
      }>,
  });

  const toggle = useMutation({
    mutationFn: (p: ProductRecord) => productsApi.setStatus(p.id, !p.isActive),
    onSuccess: (_res, p) => {
      toast.success(p.isActive ? "Product deactivated" : "Product activated");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
      setToggling(null);
    },
    onError: (err) => {
      toast.error("Could not change the status", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const filtering = Boolean(list.search || categoryId || active !== "true");

  const rowActions = (row: ProductRecord) => (
    <Can do="products.manage">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Actions for ${row.name}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setEditing(row);
              setFormOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`${ROUTES.stockAdjustments}?productId=${row.id}`}>
              <SlidersHorizontal className="h-4 w-4" /> Adjust stock
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setToggling(row)}>
            <Power className="h-4 w-4" /> {row.isActive ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Can>
  );

  const columns: Column<ProductRecord>[] = [
    {
      header: "Name",
      cell: (row) => (
        <Link href={DETAIL_ROUTES.product(row.id)} className="block max-w-[16rem] truncate font-medium hover:text-primary">
          {row.name}
        </Link>
      ),
    },
    { header: "Code / SKU", hideOnMobile: true, cell: (row) => row.sku || "—" },
    { header: "Barcode", hideOnMobile: true, cell: (row) => row.barcode || "—" },
    { header: "Category", hideOnMobile: true, cell: (row) => row.category?.name ?? "—" },
    { header: "Unit", hideOnMobile: true, cell: (row) => row.unit?.shortCode ?? row.unit?.name ?? "—" },
    { header: "Purchase price", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.purchasePrice} /> },
    { header: "Selling price", numeric: true, cell: (row) => <Money value={row.sellingPrice} /> },
  ];
  if (isGstEnabled) {
    columns.push({
      header: "GST %",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (row.tax ? `${Number(row.tax.rate)}%` : "—"),
    });
  }
  columns.push(
    {
      header: "Min. stock",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="tabular">{formatQuantity(row.reorderLevel ?? 0)}</span>,
    },
    {
      header: "Status",
      cell: (row) =>
        row.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>,
    },
    { header: "", cell: rowActions },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Everything you buy and sell, with prices and minimum stock level."
        actions={
          <Can do="products.manage">
            <Button className="min-h-[44px]" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add product</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </Can>
        }
      />
      <StockTabs />

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search name, code or barcode"
        pagination={
          data?.pagination
            ? {
                page: list.page,
                totalPages: data.pagination.totalPages,
                total: data.pagination.total,
                onPageChange: list.setPage,
              }
            : undefined
        }
        filters={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <NativeSelect
              aria-label="Category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                list.setPage(1);
              }}
              className="sm:w-44"
            >
              <option value="">All categories</option>
              {(categories.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Status"
              value={active}
              onChange={(e) => {
                setActive(e.target.value as "true" | "false" | "");
                list.setPage(1);
              }}
              className="sm:w-36"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="">All</option>
            </NativeSelect>
          </div>
        }
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <Link href={DETAIL_ROUTES.product(row.id)} className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium">{row.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[row.sku, row.category?.name, row.unit?.shortCode].filter(Boolean).join(" · ") || "—"}
              </p>
              <p className="text-sm">
                Sell <Money value={row.sellingPrice} className="font-semibold" />
                <span className="text-muted-foreground"> · Buy </span>
                <Money value={row.purchasePrice} />
              </p>
              <GstOnly>
                {row.tax ? <p className="text-xs text-muted-foreground">GST {Number(row.tax.rate)}%</p> : null}
              </GstOnly>
              {!row.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
            </Link>
            {rowActions(row)}
          </div>
        )}
        emptyTitle={filtering ? "No products match" : "No products yet"}
        emptyDescription={
          filtering
            ? "Try another word, category or status."
            : "Add the items you sell so you can bill them and track stock."
        }
        emptyAction={
          filtering ? undefined : (
            <Can do="products.manage">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add product
              </Button>
            </Can>
          )
        }
      />

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />

      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(next) => (next ? null : setToggling(null))}
        title={toggling?.isActive ? "Deactivate this product?" : "Activate this product?"}
        description={
          toggling?.isActive
            ? `"${toggling?.name}" will no longer appear when making new bills. Its history and stock stay as they are.`
            : `"${toggling?.name}" will be available for new bills again.`
        }
        confirmLabel={toggling?.isActive ? "Deactivate" : "Activate"}
        destructive={Boolean(toggling?.isActive)}
        isPending={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
      />
    </div>
  );
}
