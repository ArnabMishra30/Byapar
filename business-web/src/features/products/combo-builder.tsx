"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, productsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { EntitySelect } from "@/components/shared/entity-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ComboContentRow {
  key: string;
  productId: string;
  label: string;
  quantity: string;
}

let seq = 0;
export const emptyContent = (): ComboContentRow => ({ key: `c-${(seq += 1)}`, productId: "", label: "", quantity: "1" });

/**
 * The list of what goes into a combo: an item and how many of it per combo.
 * Combos cannot contain combos, so the picker offers ordinary items only.
 */
export function ComboContentsEditor({
  rows,
  onChange,
}: {
  rows: ComboContentRow[];
  onChange: (rows: ComboContentRow[]) => void;
}) {
  const set = (key: string, patch: Partial<ComboContentRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_5rem_2.75rem] items-start gap-2">
          <EntitySelect
            kind="product"
            productKind="ITEM"
            value={row.productId}
            valueLabel={row.label}
            placeholder={`Item ${index + 1}`}
            onChange={(id, label) => set(row.key, { productId: id, label })}
          />
          <Input
            aria-label={`How many in one combo, item ${index + 1}`}
            inputMode="decimal"
            value={row.quantity}
            onChange={(event) => set(row.key, { quantity: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove item"
            disabled={rows.length === 1}
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onChange([...rows, emptyContent()])}>
        <Plus className="h-4 w-4" />
        Add item to combo
      </Button>
      <p className="text-xs text-muted-foreground">The number is how many go into ONE combo.</p>
    </div>
  );
}

/** Problems with a contents list, before sending it. */
export function contentsError(rows: ComboContentRow[]): string | null {
  const filled = rows.filter((row) => row.productId);
  if (filled.length === 0) return "Add at least one item";
  if (filled.some((row) => !(Number(row.quantity) > 0))) return "Each item needs a quantity above zero";
  return null;
}

export const toComponents = (rows: ComboContentRow[]) =>
  rows.filter((row) => row.productId).map((row) => ({ productId: row.productId, quantity: row.quantity.trim() }));

/**
 * "Make a combo" while billing: name it, pick what goes in, set the price.
 * It is used on this bill; ticking "save for later" (owner / store keeper)
 * also keeps it as a ready-made combo. Stock always comes from the contents.
 */
export function ComboBuilderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (combo: { id: string; name: string; price: string }) => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [rows, setRows] = React.useState<ComboContentRow[]>([emptyContent(), emptyContent()]);
  const [save, setSave] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setPrice("");
      setRows([emptyContent(), emptyContent()]);
      setSave(false);
      setError(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      productsApi.comboOnTheSpot({
        name: name.trim(),
        sellingPrice: price.trim(),
        components: toComponents(rows),
        saveForLater: save,
      }),
    onSuccess: (combo) => {
      toast.success(save ? `${combo.name} saved and added to the bill` : `${combo.name} added to the bill`);
      queryClient.invalidateQueries({ queryKey: ["product"] });
      onCreated({ id: combo.id, name: combo.name, price: price.trim() });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not make the combo"),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Give the combo a name");
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) return setError("Enter the combo's price");
    const problem = contentsError(rows);
    if (problem) return setError(problem);
    setError(null);
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Make a combo
          </DialogTitle>
          <DialogDescription>
            Sold as one item. Each item inside comes out of your stock when the bill is completed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="combo-name">Combo name</Label>
              <Input id="combo-name" autoFocus placeholder="e.g. Gift set" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="combo-price">Price (₹)</Label>
              <Input id="combo-price" inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>What goes in it</Label>
            <ComboContentsEditor rows={rows} onChange={setRows} />
          </div>
          {can("products.manage") ? (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={save} onChange={(e) => setSave(e.target.checked)} />
              <span>
                Save this combo for later
                <span className="block text-xs text-muted-foreground">It will appear with your products, ready to sell again.</span>
              </span>
            </label>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending} className="min-h-[44px] sm:min-h-0">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add combo to bill
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
