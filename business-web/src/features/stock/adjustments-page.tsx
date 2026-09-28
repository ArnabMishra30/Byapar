"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { ApiError, inventoryApi, productsApi, stockApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field } from "@/components/shared/form-parts";
import { NotAvailable } from "@/components/shared/not-available";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/auth-context";
import { stripBodyPrefix } from "@/lib/utils";
import {
  ADJUSTMENT_REASONS,
  NOTES_MAX,
  adjustmentTypeFor,
  formatAdjustmentNotes,
  formatQuantity,
  reasonLabel,
  type AdjustmentDirection,
  type AdjustmentReason,
} from "./stock-helpers";
import { MovementList, useWarehouses } from "./movement-list";
import { invalidateStock } from "./opening-stock-dialog";
import { StockTabs } from "./stock-ui";
import type { ProductRecord } from "./types";

/**
 * Stock corrections: damaged, lost, expired, found, or a count that did not
 * match. The list is the backend's adjustment movements; the form posts one.
 */
export function AdjustmentsPage() {
  const params = useSearchParams();
  const { can } = useAuth();
  const prefillProductId = params?.get("productId") ?? undefined;
  const [open, setOpen] = React.useState(false);

  // ?productId=<id> (from a product page) opens the form for that product.
  React.useEffect(() => {
    if (prefillProductId && can("inventory.adjust")) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillProductId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Adjustments"
        description="Correct stock for damage, loss, expiry, found items or a count difference."
        actions={
          <Can do="inventory.adjust">
            <Button className="min-h-[44px]" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New adjustment</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Can>
        }
      />
      <StockTabs />
      {/* Staff see why the button is missing rather than wondering. */}
      <Can do="inventory.adjust" explain>
        {null}
      </Can>
      <MovementList
        types={["ADJUSTMENT_OUT", "ADJUSTMENT_IN"]}
        columnSet="adjustment"
        emptyTitle="No adjustments yet"
        emptyDescription="When stock is damaged, lost or found, record it here so your stock stays right."
        emptyAction={
          <Can do="inventory.adjust">
            <Button size="sm" onClick={() => setOpen(true)}>
              New adjustment
            </Button>
          </Can>
        }
      />
      <NotAvailable
        features={[
          {
            title: "Separate reason field",
            description: "The reason is saved at the start of the notes, e.g. \"Damaged: box fell\".",
          },
          {
            title: "Back-dated adjustment",
            description: "An adjustment is recorded at the moment you save it; a past date cannot be chosen.",
          },
          {
            title: "Stock transfer between warehouses",
            description: "Record a removal in one warehouse and an addition in the other.",
          },
        ]}
      />
      <AdjustmentDialog open={open} onOpenChange={setOpen} productId={prefillProductId} />
    </div>
  );
}

function AdjustmentDialog({
  open,
  onOpenChange,
  productId: prefillProductId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId?: string;
}) {
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const [product, setProduct] = React.useState<{ id: string; name: string } | null>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [reason, setReason] = React.useState<AdjustmentReason | "">("");
  const [direction, setDirection] = React.useState<AdjustmentDirection | "">("");
  const [quantity, setQuantity] = React.useState("");
  const [unitCost, setUnitCost] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState(false);

  const prefill = useQuery({
    queryKey: ["products", "detail", prefillProductId],
    queryFn: () => productsApi.get(prefillProductId as string) as unknown as Promise<ProductRecord>,
    enabled: Boolean(prefillProductId) && open,
  });

  // The chosen product's full record, for its purchase price (default cost when adding).
  const chosen = useQuery({
    queryKey: ["products", "detail", product?.id],
    queryFn: () => productsApi.get(product?.id as string) as unknown as Promise<ProductRecord>,
    enabled: Boolean(product?.id) && open,
  });

  React.useEffect(() => {
    if (!open) return;
    setProduct(null);
    setReason("");
    setDirection("");
    setQuantity("");
    setUnitCost("");
    setNotes("");
    setErrors({});
  }, [open]);

  React.useEffect(() => {
    if (open && prefill.data) setProduct({ id: prefill.data.id, name: prefill.data.name });
  }, [open, prefill.data]);

  React.useEffect(() => {
    const list = warehouses.data?.items ?? [];
    if (open && !warehouseId && list.length === 1) setWarehouseId(list[0].id);
  }, [open, warehouseId, warehouses.data]);

  const type = adjustmentTypeFor(reason, direction);
  const fixedDirection = ADJUSTMENT_REASONS.find((r) => r.value === reason)?.direction ?? null;

  // Default the cost of found stock to the product's purchase price.
  React.useEffect(() => {
    if (type === "ADJUSTMENT_IN" && !unitCost && chosen.data?.purchasePrice) {
      setUnitCost(chosen.data.purchasePrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, chosen.data]);

  const balance = useQuery({
    queryKey: ["stock-balance", product?.id, warehouseId],
    queryFn: () => stockApi.balance(product?.id as string, warehouseId),
    enabled: Boolean(product?.id && warehouseId) && open,
  });

  const save = useMutation({
    mutationFn: () =>
      inventoryApi.adjust({
        productId: product?.id,
        warehouseId,
        type,
        quantity: quantity.trim(),
        // The backend rejects a cost on removals: it uses the current average.
        unitCost: type === "ADJUSTMENT_IN" ? unitCost.trim() : undefined,
        notes: formatAdjustmentNotes(reason, notes),
      }),
    onSuccess: () => {
      toast.success("Stock adjusted");
      invalidateStock(queryClient);
      setConfirming(false);
      onOpenChange(false);
    },
    onError: (err) => {
      setConfirming(false);
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setErrors(next);
        return;
      }
      toast.error("Could not adjust stock", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!product) next.productId = "Choose a product";
    if (!warehouseId) next.warehouseId = "Choose a warehouse";
    if (!reason) next.reason = "Choose a reason";
    else if (!type) next.type = "Choose whether to add or remove stock";
    if (!(Number(quantity) > 0)) next.quantity = "Enter a quantity more than zero";
    if (type === "ADJUSTMENT_IN" && !(unitCost.trim() !== "" && Number(unitCost) >= 0)) {
      next.unitCost = "Enter what one unit is worth";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) setConfirming(true);
  };

  const currentQty = balance.data ? String((balance.data as { quantity?: string }).quantity ?? "") : "";
  const warehouseName = warehouses.data?.items.find((w) => w.id === warehouseId)?.name ?? "";

  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={(next) => (save.isPending ? null : onOpenChange(next))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New stock adjustment</DialogTitle>
            <DialogDescription>
              Recorded now, with today&apos;s date. Stock removed is valued at its current average cost.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Product" required error={errors.productId}>
              <EntitySelect
                kind="product"
                value={product?.id}
                valueLabel={product?.name ?? (prefill.isLoading ? "Loading…" : undefined)}
                invalid={Boolean(errors.productId)}
                onChange={(id, name) => {
                  setProduct({ id, name });
                  setUnitCost("");
                }}
              />
            </Field>
            <Field label="Warehouse" htmlFor="adj-warehouse" required error={errors.warehouseId}>
              <NativeSelect
                id="adj-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Choose warehouse</option>
                {(warehouses.data?.items ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            {product && warehouseId ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                {balance.isLoading ? (
                  <span className="text-muted-foreground">Checking current stock…</span>
                ) : balance.error ? (
                  <span className="text-destructive">Could not load current stock.</span>
                ) : (
                  <span>
                    In stock now:{" "}
                    <span className="tabular font-semibold">{formatQuantity(currentQty)}</span>
                  </span>
                )}
              </div>
            ) : null}

            <Field label="Reason" htmlFor="adj-reason" required error={errors.reason}>
              <NativeSelect
                id="adj-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value as AdjustmentReason | "");
                  setDirection("");
                }}
              >
                <option value="">Choose reason</option>
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            {reason && !fixedDirection ? (
              <Field label="Add or remove?" required error={errors.type}>
                <div className="grid grid-cols-2 gap-2" role="radiogroup">
                  {(
                    [
                      ["ADJUSTMENT_IN", "Add stock"],
                      ["ADJUSTMENT_OUT", "Remove stock"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={direction === value}
                      variant={direction === value ? "default" : "outline"}
                      className="min-h-[44px]"
                      onClick={() => setDirection(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </Field>
            ) : reason ? (
              <p className="text-sm text-muted-foreground">
                This will <strong>{fixedDirection === "ADJUSTMENT_IN" ? "add to" : "remove from"}</strong>{" "}
                your stock.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quantity" htmlFor="adj-qty" required error={errors.quantity}>
                <Input
                  id="adj-qty"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </Field>
              {type === "ADJUSTMENT_IN" ? (
                <Field
                  label="Cost per unit (₹)"
                  htmlFor="adj-cost"
                  required
                  error={errors.unitCost}
                  hint="Defaults to the purchase price"
                >
                  <Input
                    id="adj-cost"
                    inputMode="decimal"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              ) : null}
            </div>

            <Field
              label="Notes"
              htmlFor="adj-notes"
              error={errors.notes}
              hint="Saved with the reason in front, e.g. “Damaged: box fell”"
            >
              <Textarea
                id="adj-notes"
                value={notes}
                rows={2}
                maxLength={NOTES_MAX - 30}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Review adjustment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => setConfirming(next)}
        title={type === "ADJUSTMENT_IN" ? "Add this stock?" : "Remove this stock?"}
        description={
          <div className="space-y-1">
            <p>
              {type === "ADJUSTMENT_IN" ? "Add" : "Remove"}{" "}
              <strong className="tabular">{formatQuantity(quantity)}</strong> of{" "}
              <strong>{product?.name}</strong>
              {warehouseName ? ` in ${warehouseName}` : ""}.
            </p>
            <p>Reason: {reasonLabel(reason)}</p>
            <p>A stock adjustment cannot be edited or deleted afterwards.</p>
          </div>
        }
        confirmLabel={type === "ADJUSTMENT_IN" ? "Add stock" : "Remove stock"}
        destructive={type === "ADJUSTMENT_OUT"}
        isPending={save.isPending}
        onConfirm={() => save.mutate()}
      />
    </>
  );
}
