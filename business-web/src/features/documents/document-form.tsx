"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { customersApi, suppliersApi, warehousesApi, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field, FormSection, DetailRow } from "@/components/shared/form-parts";
import { ErrorState, ForbiddenState, LoadingState } from "@/components/shared/states";
import { useAuth } from "@/lib/auth/auth-context";
import { whyNot } from "@/lib/permissions";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, stripBodyPrefix } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";
import {
  buildDocumentBody,
  emptyLine,
  isNonZero,
  lineFromItem,
  type DiscountKind,
  type LineRow,
} from "./doc-helpers";

/**
 * Creating a sale or a purchase, or editing one that is still a draft.
 *
 * SAVED AS A DRAFT. Completing (posting) is a separate, deliberate action on the
 * detail screen, because that is what moves stock and money and cannot be
 * undone by editing.
 *
 * NO TOTALS ARE WORKED OUT HERE. Tax, discounts, rounding and the grand total
 * are decided by the backend when the document is saved, and shown on the
 * document straight after. A preview computed in the browser would be a second
 * opinion that can disagree with the books, so there is none.
 */
export function DocumentForm({ kind, id }: { kind: DocKind; id?: string }) {
  const config = DOC_CONFIG[kind];

  const existing = useQuery({
    queryKey: [kind, id],
    queryFn: () => config.api.get(id as string),
    enabled: Boolean(id),
  });
  const { can } = useAuth();

  // UX only: the backend refuses anyway. Better to say so before someone
  // types out a whole bill.
  if (!can(config.draftCapability)) {
    return (
      <div className="space-y-4">
        <BackLink href={config.homeHref} label={config.noun + "s"} />
        <ForbiddenState
          message={
            kind === "purchase"
              ? "Only an admin can record or change a purchase."
              : whyNot(config.draftCapability)
          }
        />
      </div>
    );
  }

  if (!id) return <DocumentFormBody kind={kind} />;

  if (existing.isLoading) return <LoadingState rows={5} />;
  if (existing.error || !existing.data) {
    return (
      <div className="space-y-4">
        <BackLink href={config.listHref} label={config.listTitle} />
        <ErrorState error={existing.error} onRetry={() => existing.refetch()} />
      </div>
    );
  }

  // Only a draft can be changed. A completed document is history: the way to
  // correct it is a return, which is its own document.
  if (existing.data.status !== "DRAFT") {
    return (
      <div className="space-y-6">
        <BackLink href={config.detailHref(id)} label={config.numberOf(existing.data) || "Back"} />
        <Card>
          <CardContent className="flex items-start gap-3 p-4 sm:p-5">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-2">
              <p className="font-medium">This {config.noun.toLowerCase()} can&apos;t be edited</p>
              <p className="text-sm text-muted-foreground">
                {existing.data.status === "CANCELLED"
                  ? "It was cancelled. Start a new one instead."
                  : config.completedNote}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={config.detailHref(id)}>Open it</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <DocumentFormBody kind={kind} initial={existing.data} />;
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
      <Link href={href}>
        <ArrowLeft className="h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}

function DocumentFormBody({ kind, initial }: { kind: DocKind; initial?: Record<string, unknown> }) {
  const config = DOC_CONFIG[kind];
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isEdit = Boolean(initial);
  const docId = initial ? String(initial.id) : undefined;

  const today = new Date().toISOString().slice(0, 10);
  const initialParty = initial?.[config.partyKind] as { id?: string; name?: string } | undefined;
  const initialWarehouse = initial?.warehouse as { id?: string } | undefined;
  const dateOnly = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : "");

  const [partyId, setPartyId] = React.useState(initialParty?.id ?? "");
  const [partyLabel, setPartyLabel] = React.useState(initialParty?.name ?? "");
  const [warehouseId, setWarehouseId] = React.useState(initialWarehouse?.id ?? "");
  const [docDate, setDocDate] = React.useState(dateOnly(initial?.invoiceDate) || today);
  const [dueDate, setDueDate] = React.useState(dateOnly(initial?.dueDate));
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = React.useState(
    kind === "purchase" && initial?.invoiceNumber ? String(initial.invoiceNumber) : "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ? String(initial.notes) : "");
  const [lines, setLines] = React.useState<LineRow[]>(() => {
    const items = (initial?.items as Record<string, unknown>[] | undefined) ?? [];
    return items.length > 0 ? items.map((item) => lineFromItem(item, config.amountField)) : [emptyLine()];
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // ?customerId= / ?supplierId= from a party page: start the bill for them.
  const prefillId = !isEdit ? searchParams?.get(config.prefillParam) ?? "" : "";
  const prefill = useQuery({
    queryKey: [config.partyKind, prefillId],
    queryFn: async () => {
      const party =
        kind === "sale" ? await customersApi.get(prefillId) : await suppliersApi.get(prefillId);
      return { id: party.id, name: party.name };
    },
    enabled: Boolean(prefillId),
  });
  React.useEffect(() => {
    if (prefill.data && !partyId) {
      setPartyId(prefill.data.id);
      setPartyLabel(prefill.data.name);
    }
    // Only when the prefill arrives; a later manual choice must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.data]);

  const warehouses = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => warehousesApi.list({ limit: 100 }),
  });

  // One godown is the common case; pick it so nobody has to.
  React.useEffect(() => {
    const list = warehouses.data?.items;
    if (list && list.length > 0 && !warehouseId) setWarehouseId(list[0].id);
  }, [warehouses.data, warehouseId]);

  const setLine = (key: string, patch: Partial<LineRow>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const removeLine = (key: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));

  const clearError = (key: string) =>
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));

  const validate = () => {
    const next: Record<string, string> = {};
    if (!partyId) next.party = `Choose a ${config.partyLabel.toLowerCase()}`;
    if (!warehouseId) next.warehouse = "Choose where the stock is";
    if (!docDate) next.docDate = "Pick a date";
    if (config.requiresSupplierInvoiceNumber && !supplierInvoiceNumber.trim()) {
      next.supplierInvoiceNumber = "Enter the bill number from your supplier";
    }
    if (dueDate && docDate && dueDate < docDate) next.dueDate = "Due date cannot be before the bill date";

    if (!lines.some((line) => line.productId)) next.lines = "Add at least one item";

    const seen = new Set<string>();
    lines.forEach((line) => {
      if (!line.productId) return;
      const qty = Number(line.quantity);
      if (!line.quantity.trim() || !Number.isFinite(qty) || qty <= 0) {
        next[`qty-${line.key}`] = "More than zero";
      }
      const amount = Number(line.amount);
      if (!line.amount.trim() || !Number.isFinite(amount) || amount < 0) {
        next[`amt-${line.key}`] = "Enter an amount";
      }
      const discount = Number(line.discountValue || 0);
      if (!Number.isFinite(discount) || discount < 0) {
        next[`disc-${line.key}`] = "Not a valid discount";
      } else if (line.discountType === "PERCENTAGE" && discount > 100) {
        next[`disc-${line.key}`] = "100% at most";
      }
      // One line per product: the backend refuses duplicates, so catch it
      // here with a message that points at the row.
      if (seen.has(line.productId)) next[`prod-${line.key}`] = "This item is already on the bill";
      seen.add(line.productId);
    });

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = useMutation({
    mutationFn: () => {
      const body = buildDocumentBody({
        partyField: config.partyField,
        partyId,
        warehouseId,
        date: docDate,
        dueDate,
        notes,
        amountField: config.amountField,
        supplierInvoiceNumber: config.requiresSupplierInvoiceNumber ? supplierInvoiceNumber : undefined,
        // Keep an explicit place of supply only while the customer is the one
        // it was chosen for; a different customer gets their own default.
        placeOfSupplyStateCode:
          kind === "sale" && initialParty?.id === partyId
            ? ((initial?.placeOfSupplyStateCode as string | null | undefined) ?? null)
            : null,
        lines,
      });
      return docId ? config.api.update(docId, body) : config.api.create(body);
    },
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: [kind] });
      toast.success(isEdit ? "Draft updated" : "Saved as a draft", {
        description: "The totals below are worked out by the system. Complete it when it looks right.",
      });
      router.replace(config.detailHref(String((doc as { id?: string }).id ?? docId)));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const usable = lines.filter((line) => line.productId);
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) {
          const field = stripBodyPrefix(item.field);
          // "items.2.quantity" -> the error sits under that row's input.
          const match = /^items\.(\d+)\.(\w+)$/.exec(field);
          const line = match ? usable[Number(match[1])] : undefined;
          if (match && line) {
            const prefix =
              match[2] === "quantity"
                ? "qty"
                : match[2] === "productId"
                  ? "prod"
                  : match[2].startsWith("discount")
                    ? "disc"
                    : "amt";
            next[`${prefix}-${line.key}`] = item.message;
          } else {
            next[field] = item.message;
          }
        }
        setErrors((prev) => ({ ...prev, ...next }));
        toast.error("Please check the bill", { description: err.fieldErrors[0]?.message });
        return;
      }
      toast.error("Could not save", { description: err instanceof ApiError ? err.message : undefined });
    },
  });

  if (warehouses.error) {
    return <ErrorState error={warehouses.error} onRetry={() => warehouses.refetch()} />;
  }

  const backHref = docId ? config.detailHref(docId) : config.homeHref;
  const partySectionTitle = kind === "sale" ? "Customer & date" : "Supplier & bill";

  return (
    <div className="space-y-6">
      <BackLink href={backHref} label={docId ? config.numberOf(initial ?? {}) || "Back" : config.noun + "s"} />

      <PageHeader
        title={isEdit ? config.editTitle : config.newTitle}
        description="Saved as a draft first. Nothing moves until you complete it."
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validate()) save.mutate();
        }}
        className="space-y-6"
        noValidate
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{partySectionTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormSection>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={config.partyLabel} required error={errors.party || errors[config.partyField]}>
                  <EntitySelect
                    kind={config.partyKind}
                    value={partyId}
                    valueLabel={partyLabel || (prefill.isLoading ? "Loading…" : "")}
                    invalid={Boolean(errors.party)}
                    onChange={(id, label) => {
                      setPartyId(id);
                      setPartyLabel(label);
                      clearError("party");
                    }}
                  />
                </Field>

                <Field label="Godown / store" htmlFor="warehouseId" required error={errors.warehouse || errors.warehouseId}>
                  <NativeSelect
                    id="warehouseId"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {warehouses.data?.items.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="docDate" required error={errors.docDate || errors.invoiceDate}>
                  <Input id="docDate" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
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
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Items</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5 sm:min-h-0"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {errors.lines || errors.items ? (
              <p className="text-xs text-destructive">{errors.lines || errors.items}</p>
            ) : null}

            {/* Column headings for the desktop table layout. */}
            <div
              className="hidden gap-3 border-b pb-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_6rem_8rem_11rem_2.75rem]"
              aria-hidden
            >
              <span>Item</span>
              <span>Qty</span>
              <span>{config.amountLabel}</span>
              <span>Discount</span>
              <span />
            </div>

            {/* One markup, two layouts: a card per item on a phone (five inputs
                side by side are unusable at 360px), a table row from md up. */}
            <div className="space-y-3 md:space-y-0">
              {lines.map((line, index) => (
                <LineEditor
                  key={line.key}
                  index={index}
                  line={line}
                  amountLabel={config.amountLabel}
                  canRemove={lines.length > 1}
                  errors={errors}
                  onChange={(patch) => setLine(line.key, patch)}
                  onRemove={() => removeLine(line.key)}
                />
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Totals are calculated by the server when you save — tax, discounts and the final
                amount appear on the {kind === "sale" ? "invoice" : "bill"} straight after.
              </p>
            </div>
          </CardContent>
        </Card>

        {isEdit && initial ? <SavedTotals doc={initial} /> : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Notes (optional)" htmlFor="notes" error={errors.notes}>
              <Textarea
                id="notes"
                value={notes}
                rows={3}
                maxLength={1000}
                placeholder="Anything you want to remember about this bill"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Sticky on a phone, above the bottom tab bar, so Save is always in
            reach without scrolling back past a long item list. */}
        <div className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 -mx-3 border-t bg-background/95 p-3 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <div className="flex gap-2 lg:justify-end">
            <Button asChild type="button" variant="outline" className="min-h-[44px] flex-1 lg:flex-none">
              <Link href={backHref}>Cancel</Link>
            </Button>
            <Button type="submit" className="min-h-[44px] flex-1 lg:flex-none" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Save changes" : "Save draft"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function LineEditor({
  index,
  line,
  amountLabel,
  canRemove,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  line: LineRow;
  amountLabel: string;
  canRemove: boolean;
  errors: Record<string, string>;
  onChange: (patch: Partial<LineRow>) => void;
  onRemove: () => void;
}) {
  const qtyId = `qty-${line.key}`;
  const amtId = `amt-${line.key}`;
  const discId = `disc-${line.key}`;
  const label = "text-xs font-medium text-muted-foreground md:sr-only";

  return (
    <div className="rounded-lg border bg-muted/20 p-3 md:grid md:grid-cols-[minmax(0,1fr)_6rem_8rem_11rem_2.75rem] md:items-start md:gap-3 md:rounded-none md:border-0 md:border-b md:bg-transparent md:px-0 md:py-3">
      <div className="mb-2 flex items-center justify-between md:hidden">
        <span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-[44px] gap-1 px-2 text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <span className={label}>Item</span>
        <EntitySelect
          kind="product"
          value={line.productId}
          valueLabel={line.productLabel}
          invalid={Boolean(errors[`prod-${line.key}`])}
          onChange={(id, name) => onChange({ productId: id, productLabel: name, taxId: null })}
        />
        <LineError message={errors[`prod-${line.key}`]} />
      </div>

      {/* Two columns on a phone; from md up these join the parent's grid. */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:contents">
        <div className="space-y-1.5">
          <label htmlFor={qtyId} className={label}>
            Qty
          </label>
          <Input
            id={qtyId}
            inputMode="decimal"
            value={line.quantity}
            aria-invalid={Boolean(errors[qtyId]) || undefined}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
          <LineError message={errors[qtyId]} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={amtId} className={label}>
            {amountLabel} (₹)
          </label>
          <Input
            id={amtId}
            inputMode="decimal"
            value={line.amount}
            placeholder="0.00"
            aria-invalid={Boolean(errors[amtId]) || undefined}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
          <LineError message={errors[amtId]} />
        </div>
        <div className="col-span-2 space-y-1.5 md:col-span-1">
          <label htmlFor={discId} className={label}>
            Discount
          </label>
          <div className="flex gap-2">
            <Input
              id={discId}
              inputMode="decimal"
              value={line.discountValue}
              placeholder="0"
              className="min-w-0 flex-1"
              aria-invalid={Boolean(errors[discId]) || undefined}
              onChange={(e) => onChange({ discountValue: e.target.value })}
            />
            <NativeSelect
              aria-label="Discount type"
              className="w-20 shrink-0"
              value={line.discountType}
              onChange={(e) => onChange({ discountType: e.target.value as DiscountKind })}
            >
              <option value="FIXED">₹</option>
              <option value="PERCENTAGE">%</option>
            </NativeSelect>
          </div>
          <LineError message={errors[discId]} />
        </div>
      </div>

      <div className="hidden md:flex md:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-10 w-10 text-destructive", !canRemove && "invisible")}
          aria-label={`Remove item ${index + 1}`}
          onClick={onRemove}
          disabled={!canRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function LineError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

/** The figures the server worked out the last time this draft was saved. */
function SavedTotals({ doc }: { doc: Record<string, unknown> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Totals when last saved</CardTitle>
        <p className="text-xs text-muted-foreground">
          From the server. They update after you save your changes.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <DetailRow label="Sub total">
          <Money value={String(doc.subtotal ?? "0")} />
        </DetailRow>
        {isNonZero(doc.discountTotal) ? (
          <DetailRow label="Discount">
            <Money value={String(doc.discountTotal)} />
          </DetailRow>
        ) : null}
        {isNonZero(doc.taxTotal) ? (
          <DetailRow label="Tax">
            <Money value={String(doc.taxTotal)} />
          </DetailRow>
        ) : null}
        <DetailRow label="Total">
          <Money value={String(doc.grandTotal ?? "0")} className="font-bold" />
        </DetailRow>
      </CardContent>
    </Card>
  );
}
