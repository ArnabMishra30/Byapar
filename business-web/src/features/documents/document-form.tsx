"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { warehousesApi, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field, FormSection } from "@/components/shared/form-parts";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatAmount, stripBodyPrefix } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";

/**
 * Creating a sale or a purchase.
 *
 * SAVED AS A DRAFT. Posting is a separate, deliberate action on the detail
 * screen, because posting is what moves stock and money and cannot be undone by
 * editing.
 *
 * THE TOTAL SHOWN HERE IS A PREVIEW, and says so. Quantity times price, less a
 * discount, is arithmetic the shopkeeper is already doing in their head. Tax,
 * rounding and the final total are decided by the backend when the document is
 * saved - this screen never computes tax, because the GST engine lives in one
 * place and it is not here.
 */

interface LineRow {
  key: string;
  productId: string;
  productLabel: string;
  quantity: string;
  amount: string;
  discountValue: string;
}

const emptyLine = (): LineRow => ({
  key: Math.random().toString(36).slice(2),
  productId: "",
  productLabel: "",
  quantity: "1",
  amount: "",
  discountValue: "",
});

export function DocumentForm({ kind }: { kind: DocKind }) {
  const config = DOC_CONFIG[kind];
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);

  const [partyId, setPartyId] = React.useState("");
  const [partyLabel, setPartyLabel] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [docDate, setDocDate] = React.useState(today);
  const [dueDate, setDueDate] = React.useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<LineRow[]>([emptyLine()]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const warehouses = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => warehousesApi.list({ limit: 100 }),
  });

  // One godown is the common case; pick it so nobody has to.
  React.useEffect(() => {
    const only = warehouses.data?.items;
    if (only && only.length > 0 && !warehouseId) setWarehouseId(only[0].id);
  }, [warehouses.data, warehouseId]);

  const setLine = (key: string, patch: Partial<LineRow>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));

  /** Preview only. The backend decides the real figures. */
  const previewSubtotal = lines.reduce((total, line) => {
    const qty = Number(line.quantity);
    const rate = Number(line.amount);
    const discount = Number(line.discountValue || 0);
    if (!Number.isFinite(qty) || !Number.isFinite(rate)) return total;
    return total + Math.max(0, qty * rate - (Number.isFinite(discount) ? discount : 0));
  }, 0);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!partyId) next.party = `Choose a ${config.partyLabel.toLowerCase()}`;
    if (!warehouseId) next.warehouse = "Choose where the stock is";
    if (!docDate) next.docDate = "Pick a date";
    if (config.requiresSupplierInvoiceNumber && !supplierInvoiceNumber.trim()) {
      next.supplierInvoiceNumber = "Enter the bill number from your supplier";
    }
    if (dueDate && dueDate < docDate) next.dueDate = "Due date cannot be before the bill date";

    const usable = lines.filter((line) => line.productId);
    if (usable.length === 0) next.lines = "Add at least one item";

    lines.forEach((line) => {
      if (!line.productId) return;
      if (!line.quantity || Number(line.quantity) <= 0) {
        next[`qty-${line.key}`] = "Quantity must be more than zero";
      }
      if (line.amount === "" || Number(line.amount) < 0) {
        next[`amt-${line.key}`] = "Enter an amount";
      }
    });

    // One line per product: the backend refuses duplicates, so catch it here
    // with a message that points at the row.
    const seen = new Set<string>();
    lines.forEach((line) => {
      if (!line.productId) return;
      if (seen.has(line.productId)) {
        next[`prod-${line.key}`] = "This item is already on the bill";
      }
      seen.add(line.productId);
    });

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        [config.partyField]: partyId,
        warehouseId,
        invoiceDate: docDate,
        ...(dueDate ? { dueDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(config.requiresSupplierInvoiceNumber
          ? { invoiceNumber: supplierInvoiceNumber.trim() }
          : {}),
        items: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            [config.amountField]: line.amount,
            ...(line.discountValue
              ? { discountType: "FIXED", discountValue: line.discountValue }
              : {}),
          })),
      };
      return config.api.create(body);
    },
    onSuccess: (doc) => {
      toast.success("Saved as a draft", {
        description: "Check it, then post it to the books.",
      });
      router.replace(config.detailHref((doc as { id: string }).id));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) {
          next[stripBodyPrefix(item.field)] = item.message;
        }
        setErrors((prev) => ({ ...prev, ...next }));
        toast.error("Please check the bill", {
          description: err.fieldErrors[0]?.message,
        });
        return;
      }
      toast.error("Could not save", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  if (warehouses.error) {
    return <ErrorState error={warehouses.error} onRetry={() => warehouses.refetch()} />;
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href={config.backHref}>
          <ArrowLeft className="h-4 w-4" />
          {config.listTitle}
        </Link>
      </Button>

      <PageHeader
        title={config.newTitle}
        description="Saved as a draft first. Nothing moves until you post it."
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validate()) create.mutate();
        }}
        className="space-y-6"
        noValidate
      >
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <FormSection>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={config.partyLabel} required error={errors.party}>
                  <EntitySelect
                    kind={config.partyKind}
                    value={partyId}
                    valueLabel={partyLabel}
                    invalid={Boolean(errors.party)}
                    onChange={(id, label) => {
                      setPartyId(id);
                      setPartyLabel(label);
                      setErrors((prev) => ({ ...prev, party: "" }));
                    }}
                  />
                </Field>

                <Field label="Godown / store" required error={errors.warehouse}>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {warehouses.data?.items.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="docDate" required error={errors.docDate || errors.invoiceDate}>
                  <Input
                    id="docDate"
                    type="date"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                  />
                </Field>
                <Field
                  label="Payment due"
                  htmlFor="dueDate"
                  hint="Leave blank for cash, or to use the party's terms"
                  error={errors.dueDate}
                >
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    min={docDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </Field>
              </div>

              {config.requiresSupplierInvoiceNumber ? (
                <Field
                  label="Supplier bill number"
                  htmlFor="supplierInvoiceNumber"
                  required
                  hint="The number printed on the bill your supplier gave you"
                  error={errors.supplierInvoiceNumber || errors.invoiceNumber}
                >
                  <Input
                    id="supplierInvoiceNumber"
                    value={supplierInvoiceNumber}
                    onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  />
                </Field>
              ) : null}
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Items</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="h-4 w-4" />
                Add item
              </Button>
            </div>

            {errors.lines ? <p className="text-xs text-destructive">{errors.lines}</p> : null}
            {errors.items ? <p className="text-xs text-destructive">{errors.items}</p> : null}

            {/* Stacked cards, not a squeezed table: five columns of inputs is
                unusable on a 360px phone. */}
            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={line.key} className="rounded-lg border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Item {index + 1}
                    </span>
                    {lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-destructive"
                        onClick={() => removeLine(line.key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <Field label="Item" error={errors[`prod-${line.key}`]}>
                      <EntitySelect
                        kind="product"
                        value={line.productId}
                        valueLabel={line.productLabel}
                        invalid={Boolean(errors[`prod-${line.key}`])}
                        onChange={(id, label) =>
                          setLine(line.key, { productId: id, productLabel: label })
                        }
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Field label="Qty" error={errors[`qty-${line.key}`]}>
                        <Input
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        />
                      </Field>
                      <Field label={config.amountLabel} error={errors[`amt-${line.key}`]}>
                        <Input
                          inputMode="decimal"
                          value={line.amount}
                          placeholder="0.00"
                          onChange={(e) => setLine(line.key, { amount: e.target.value })}
                        />
                      </Field>
                      <Field label="Discount" className="col-span-2 sm:col-span-1">
                        <Input
                          inputMode="decimal"
                          value={line.discountValue}
                          placeholder="0"
                          onChange={(e) => setLine(line.key, { discountValue: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">Items total (before tax)</span>
              <span className="text-lg font-bold tabular">₹{formatAmount(previewSubtotal)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              This is a preview. Tax, rounding and the final total are worked out by the system when
              you save.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5">
            <Field label="Notes" htmlFor="notes">
              <Input
                id="notes"
                value={notes}
                placeholder="Anything you want to remember about this bill"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Sticky on a phone so the save button is always reachable without
            scrolling back down a long item list. */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto flex max-w-7xl gap-2">
            <Button asChild type="button" variant="outline" className="flex-1 lg:flex-none">
              <Link href={config.backHref}>Cancel</Link>
            </Button>
            <Button type="submit" className="flex-1 lg:flex-none" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save draft
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
