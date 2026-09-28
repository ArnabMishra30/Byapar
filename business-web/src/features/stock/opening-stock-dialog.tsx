"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, inventoryApi } from "@/lib/api";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field } from "@/components/shared/form-parts";
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
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { stripBodyPrefix } from "@/lib/utils";
import { useWarehouses } from "./movement-list";

/** Everything a stock write can change, invalidated together. */
export function invalidateStock(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ["inventory", "stock-movements", "inventory-valuation", "stock-balance", "dashboard"]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Stock the shop already had before it started using the app.
 *
 * The backend accepts this once per product and warehouse; after that the only
 * way to change stock by hand is an adjustment, and its error says so.
 */
export function OpeningStockDialog({
  open,
  onOpenChange,
  product: initialProduct,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: { id: string; name: string; purchasePrice?: string | null };
}) {
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const [product, setProduct] = React.useState<{ id: string; name: string } | null>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [unitCost, setUnitCost] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Fresh form on every open, prefilled from the product when there is one.
  React.useEffect(() => {
    if (!open) return;
    setProduct(initialProduct ? { id: initialProduct.id, name: initialProduct.name } : null);
    setQuantity("");
    setUnitCost(initialProduct?.purchasePrice ?? "");
    setNotes("");
    setErrors({});
  }, [open, initialProduct]);

  React.useEffect(() => {
    const list = warehouses.data?.items ?? [];
    if (open && !warehouseId && list.length === 1) setWarehouseId(list[0].id);
  }, [open, warehouseId, warehouses.data]);

  const save = useMutation({
    mutationFn: () =>
      inventoryApi.openingStock({
        productId: product?.id,
        warehouseId,
        quantity: quantity.trim(),
        unitCost: unitCost.trim() || "0",
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Opening stock saved");
      invalidateStock(queryClient);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setErrors(next);
        return;
      }
      toast.error("Could not save opening stock", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!product) next.productId = "Choose a product";
    if (!warehouseId) next.warehouseId = "Choose a warehouse";
    if (!(Number(quantity) > 0)) next.quantity = "Enter a quantity more than zero";
    if (unitCost && !(Number(unitCost) >= 0)) next.unitCost = "Enter a valid cost";
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (save.isPending ? null : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add opening stock</DialogTitle>
          <DialogDescription>
            Stock you already had before using this app. It can be entered once per product and
            warehouse. To correct it later, use a stock adjustment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Product" required error={errors.productId}>
            <EntitySelect
              kind="product"
              value={product?.id}
              valueLabel={product?.name}
              disabled={Boolean(initialProduct)}
              invalid={Boolean(errors.productId)}
              onChange={(id, name) => setProduct({ id, name })}
            />
          </Field>
          <Field label="Warehouse" htmlFor="os-warehouse" required error={errors.warehouseId}>
            <NativeSelect
              id="os-warehouse"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="os-qty" required error={errors.quantity}>
              <Input
                id="os-qty"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field
              label="Cost per unit (₹)"
              htmlFor="os-cost"
              error={errors.unitCost}
              hint="What one unit cost you"
            >
              <Input
                id="os-cost"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor="os-notes" error={errors.notes}>
            <Textarea
              id="os-notes"
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save opening stock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
