"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, categoriesApi, inventoryApi, productsApi, taxesApi, unitsApi } from "@/lib/api";
import { Field, FormSection } from "@/components/shared/form-parts";
import { GstOnly } from "@/components/shared/gst-gate";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { stripBodyPrefix } from "@/lib/utils";
import { useWarehouses } from "@/features/stock/movement-list";
import { invalidateStock } from "@/features/stock/opening-stock-dialog";
import type { ProductRecord } from "@/features/stock/types";

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  unitId: string;
  taxId: string;
  purchasePrice: string;
  sellingPrice: string;
  reorderLevel: string;
  description: string;
  // Opening stock, create only.
  openingWarehouseId: string;
  openingQuantity: string;
  openingCost: string;
}

const EMPTY: FormState = {
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  unitId: "",
  taxId: "",
  purchasePrice: "",
  sellingPrice: "",
  reorderLevel: "",
  description: "",
  openingWarehouseId: "",
  openingQuantity: "",
  openingCost: "",
};

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

function fromProduct(p: ProductRecord): FormState {
  return {
    ...EMPTY,
    name: p.name ?? "",
    sku: p.sku ?? "",
    barcode: p.barcode ?? "",
    categoryId: p.category?.id ?? p.categoryId ?? "",
    unitId: p.unit?.id ?? p.unitId ?? "",
    taxId: p.tax?.id ?? p.taxId ?? "",
    purchasePrice: p.purchasePrice ?? "",
    sellingPrice: p.sellingPrice ?? "",
    reorderLevel: p.reorderLevel ?? "",
    description: p.description ?? "",
  };
}

/**
 * Create or edit a product (shop owner only - the backend enforces it).
 *
 * Opening stock is offered on create because that is when a shop setting up
 * has the count in hand. It is a second request after the product exists; if
 * it fails the product is still saved and the message says so.
 */
export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit when given, create otherwise. */
  product?: ProductRecord | null;
  onSaved?: (product: ProductRecord) => void;
}) {
  const isEdit = Boolean(product);
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const warehouses = useWarehouses();

  const categories = useQuery({
    queryKey: ["categories", "options"],
    queryFn: () => categoriesApi.list({ limit: 100, isActive: "true" }),
    enabled: open,
  });
  const units = useQuery({
    queryKey: ["units", "options"],
    queryFn: () => unitsApi.list({ limit: 100, isActive: "true" }),
    enabled: open,
  });
  const taxes = useQuery({
    queryKey: ["taxes", "options"],
    queryFn: () => taxesApi.list({ limit: 100, isActive: "true" }),
    enabled: open,
  });

  React.useEffect(() => {
    if (!open) return;
    setForm(product ? fromProduct(product) : EMPTY);
    setErrors({});
  }, [open, product]);

  React.useEffect(() => {
    const list = warehouses.data?.items ?? [];
    if (open && !isEdit && !form.openingWarehouseId && list.length === 1) {
      setForm((f) => ({ ...f, openingWarehouseId: list[0].id }));
    }
  }, [open, isEdit, form.openingWarehouseId, warehouses.data]);

  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        description: form.description.trim() || null,
        categoryId: form.categoryId,
        unitId: form.unitId,
        taxId: form.taxId || null,
        purchasePrice: form.purchasePrice.trim() || "0",
        sellingPrice: form.sellingPrice.trim() || "0",
        reorderLevel: form.reorderLevel.trim() || "0",
      };
      const saved = (
        isEdit
          ? await productsApi.update(product!.id, body as never)
          : await productsApi.create(body as never)
      ) as unknown as ProductRecord;

      let openingError: string | null = null;
      if (!isEdit && form.openingQuantity.trim()) {
        try {
          await inventoryApi.openingStock({
            productId: saved.id,
            warehouseId: form.openingWarehouseId,
            quantity: form.openingQuantity.trim(),
            unitCost: form.openingCost.trim() || form.purchasePrice.trim() || "0",
          });
        } catch (err) {
          openingError = err instanceof ApiError ? err.message : "Opening stock could not be saved.";
        }
      }
      return { saved, openingError };
    },
    onSuccess: ({ saved, openingError }) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
      queryClient.invalidateQueries({ queryKey: ["product", "options"] });
      invalidateStock(queryClient);
      if (openingError) {
        toast.warning("Product saved, but opening stock was not", {
          description: `${openingError} You can add it from the stock page.`,
        });
      } else {
        toast.success(isEdit ? "Product updated" : "Product added");
      }
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setErrors(next);
        toast.error("Please check the form");
        return;
      }
      toast.error("Could not save the product", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = "Enter a name (at least 2 letters)";
    if (!form.categoryId) next.categoryId = "Choose a category";
    if (!form.unitId) next.unitId = "Choose a unit";
    if (form.barcode.trim() && form.barcode.trim().length < 4) next.barcode = "Barcode must be at least 4 characters";
    for (const key of ["purchasePrice", "sellingPrice"] as const) {
      if (form[key].trim() && !MONEY_RE.test(form[key].trim())) next[key] = "Enter a valid price";
    }
    if (form.reorderLevel.trim() && !QTY_RE.test(form.reorderLevel.trim())) {
      next.reorderLevel = "Enter a valid quantity";
    }
    if (!isEdit && form.openingQuantity.trim()) {
      if (!QTY_RE.test(form.openingQuantity.trim()) || !(Number(form.openingQuantity) > 0)) {
        next.openingQuantity = "Enter a quantity more than zero";
      }
      if (!form.openingWarehouseId) next.openingWarehouseId = "Choose a warehouse";
      if (form.openingCost.trim() && !MONEY_RE.test(form.openingCost.trim())) next.openingCost = "Enter a valid cost";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (save.isPending ? null : onOpenChange(next))}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes apply to new bills. Bills already made keep their old prices."
              : "Only name, category and unit are required. Fill the rest when you have it."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-6">
          <FormSection title="Basic details">
            <Field label="Product name" htmlFor="p-name" required error={errors.name}>
              <Input id="p-name" value={form.name} onChange={(e) => set("name")(e.target.value)} autoFocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Item code / SKU" htmlFor="p-sku" error={errors.sku} hint="Optional, must be unique">
                <Input id="p-sku" value={form.sku} maxLength={50} onChange={(e) => set("sku")(e.target.value)} />
              </Field>
              <Field label="Barcode" htmlFor="p-barcode" error={errors.barcode} hint="Optional">
                <Input
                  id="p-barcode"
                  value={form.barcode}
                  maxLength={50}
                  onChange={(e) => set("barcode")(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="p-category" required error={errors.categoryId}>
                <MasterSelect
                  id="p-category"
                  value={form.categoryId}
                  onChange={set("categoryId")}
                  placeholder="Choose category"
                  loading={categories.isLoading}
                  options={(categories.data?.items ?? []).map((c) => ({ id: c.id, label: c.name }))}
                  addLabel="New category"
                  onAdd={async ({ name }) => {
                    const created = await categoriesApi.create({ name });
                    await queryClient.invalidateQueries({ queryKey: ["categories"] });
                    return created.id;
                  }}
                />
              </Field>
              <Field label="Unit" htmlFor="p-unit" required error={errors.unitId}>
                <MasterSelect
                  id="p-unit"
                  value={form.unitId}
                  onChange={set("unitId")}
                  placeholder="Choose unit"
                  loading={units.isLoading}
                  options={(units.data?.items ?? []).map((u) => ({
                    id: u.id,
                    label: `${u.name} (${u.shortCode})`,
                  }))}
                  addLabel="New unit"
                  withShortCode
                  onAdd={async ({ name, shortCode }) => {
                    const created = await unitsApi.create({ name, shortCode });
                    await queryClient.invalidateQueries({ queryKey: ["units"] });
                    return created.id;
                  }}
                />
              </Field>
            </div>
            <GstOnly>
              <Field label="GST rate" htmlFor="p-tax" error={errors.taxId}>
                <NativeSelect id="p-tax" value={form.taxId} onChange={(e) => set("taxId")(e.target.value)}>
                  <option value="">No tax</option>
                  {(taxes.data?.items ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({Number(t.rate)}%)
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </GstOnly>
          </FormSection>

          <Separator />

          <FormSection title="Prices and stock level">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Purchase price (₹)" htmlFor="p-pp" error={errors.purchasePrice}>
                <Input
                  id="p-pp"
                  inputMode="decimal"
                  value={form.purchasePrice}
                  onChange={(e) => set("purchasePrice")(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Selling price (₹)" htmlFor="p-sp" error={errors.sellingPrice}>
                <Input
                  id="p-sp"
                  inputMode="decimal"
                  value={form.sellingPrice}
                  onChange={(e) => set("sellingPrice")(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field
                label="Minimum stock"
                htmlFor="p-min"
                error={errors.reorderLevel}
                hint="Warn me at or below this"
              >
                <Input
                  id="p-min"
                  inputMode="decimal"
                  value={form.reorderLevel}
                  onChange={(e) => set("reorderLevel")(e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="p-desc" error={errors.description}>
              <Textarea
                id="p-desc"
                rows={2}
                maxLength={1000}
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
              />
            </Field>
          </FormSection>

          {!isEdit ? (
            <>
              <Separator />
              <FormSection
                title="Opening stock (optional)"
                description="Stock you already have. Leave the quantity empty to skip."
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Warehouse" htmlFor="p-ow" error={errors.openingWarehouseId}>
                    <NativeSelect
                      id="p-ow"
                      value={form.openingWarehouseId}
                      onChange={(e) => set("openingWarehouseId")(e.target.value)}
                    >
                      <option value="">Choose warehouse</option>
                      {(warehouses.data?.items ?? []).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Quantity" htmlFor="p-oq" error={errors.openingQuantity}>
                    <Input
                      id="p-oq"
                      inputMode="decimal"
                      value={form.openingQuantity}
                      onChange={(e) => set("openingQuantity")(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field
                    label="Cost per unit (₹)"
                    htmlFor="p-oc"
                    error={errors.openingCost}
                    hint="Empty = purchase price"
                  >
                    <Input
                      id="p-oc"
                      inputMode="decimal"
                      value={form.openingCost}
                      onChange={(e) => set("openingCost")(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
              </FormSection>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A select for a small master (category, unit) with "add new" inline, so a
 * shopkeeper adding their first product is not sent to another screen.
 */
function MasterSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  loading,
  addLabel,
  withShortCode,
  onAdd,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  loading?: boolean;
  addLabel: string;
  withShortCode?: boolean;
  onAdd: (input: { name: string; shortCode: string }) => Promise<string>;
}) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shortCode, setShortCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const cancel = () => {
    setAdding(false);
    setName("");
    setShortCode("");
    setError("");
  };

  const confirm = async () => {
    if (name.trim().length < 2) return setError("At least 2 letters");
    if (withShortCode && !shortCode.trim()) return setError("Enter a short code, e.g. PCS");
    setBusy(true);
    setError("");
    try {
      const newId = await onAdd({ name: name.trim(), shortCode: shortCode.trim() });
      onChange(newId);
      cancel();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            aria-label={addLabel}
            placeholder={withShortCode ? "Name, e.g. Pieces" : "Name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void confirm();
              }
            }}
          />
          {withShortCode ? (
            <Input
              aria-label="Short code"
              placeholder="PCS"
              value={shortCode}
              maxLength={10}
              onChange={(e) => setShortCode(e.target.value)}
              className="w-20 shrink-0"
            />
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" className="min-h-[44px] flex-1" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add
          </Button>
          <Button type="button" size="sm" variant="outline" className="min-h-[44px]" onClick={cancel} disabled={busy}>
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel</span>
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1">
        <option value="">{loading ? "Loading…" : placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-11 shrink-0"
        onClick={() => setAdding(true)}
        aria-label={addLabel}
        title={addLabel}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
