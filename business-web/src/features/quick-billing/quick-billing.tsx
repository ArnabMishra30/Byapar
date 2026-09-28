"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info, Loader2, Save, ShieldAlert, UserPlus, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  dueListsApi,
  moneyInApi,
  productsApi,
  salesApi,
  warehousesApi,
} from "@/lib/api";
import type { Receivable, SalesInvoice } from "@/types/api";
import { useAuth } from "@/lib/auth/auth-context";
import { whyNot } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field } from "@/components/shared/form-parts";
import { ErrorState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { isPositiveAmount, stripBodyPrefix } from "@/lib/utils";
import { BillItems, type BillLine } from "./bill-items";
import { PaymentSection, PAYMENT_METHODS, type PayMode, type PaymentMethod } from "./payment-section";
import { BillResult, type PaymentOutcome } from "./bill-result";

/**
 * QUICK BILLING: a counter sale on one screen.
 *
 *   pick customer -> add items -> save (draft) -> complete (post) -> payment
 *
 * It uses exactly the same backend calls as the full sale form and the money
 * received screen - nothing special-cased - so the books cannot tell a quick
 * bill from any other:
 *
 *   POST /sales                     the draft (backend works out tax and totals)
 *   POST /sales/:id/post            stock out, receivable raised, journal written
 *   POST /customer-payments (+post) the money received, allocated to this bill
 *
 * THE TOTAL COMES FROM THE BACKEND. Until the draft is saved the screen says
 * "Total will be calculated when you save"; after that it shows the draft's own
 * grandTotal and taxTotal. Change anything and it says the total will be
 * recalculated, rather than showing a figure that is now stale.
 *
 * Staff can save a draft; only the owner (ADMIN) can complete it, because only
 * an admin may post a document or record money received.
 */

/** Today's date in the shop's own time zone, as the API wants it. */
function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const newKey = () => Math.random().toString(36).slice(2);

type Busy = null | "saving" | "posting" | "payment";

export function QuickBillingScreen() {
  const queryClient = useQueryClient();
  const { can, isGstEnabled } = useAuth();
  const canComplete = can("sales.post") && can("money.receive");

  // --- the bill being made ---------------------------------------------------
  const [customerId, setCustomerId] = React.useState("");
  const [customerLabel, setCustomerLabel] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [invoiceDate, setInvoiceDate] = React.useState(localToday);
  const [lines, setLines] = React.useState<BillLine[]>([]);
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // --- payment ---------------------------------------------------------------
  const [payMode, setPayMode] = React.useState<PayMode>("FULL");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("CASH");

  // --- progress --------------------------------------------------------------
  const [draft, setDraft] = React.useState<SalesInvoice | null>(null);
  /** True when the screen differs from the saved draft (or nothing is saved). */
  const [dirty, setDirty] = React.useState(true);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [creditBlock, setCreditBlock] = React.useState<string | null>(null);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [result, setResult] = React.useState<{
    invoice: SalesInvoice;
    payment: PaymentOutcome;
  } | null>(null);

  const edited = () => setDirty(true);

  const warehouses = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => warehousesApi.list({ limit: 100 }),
  });
  const warehouseItems = React.useMemo(() => warehouses.data?.items ?? [], [warehouses.data]);

  // One godown is the common case; pick the first so nobody has to.
  React.useEffect(() => {
    if (!warehouseId && warehouseItems.length > 0) setWarehouseId(warehouseItems[0].id);
  }, [warehouseItems, warehouseId]);

  const reset = () => {
    setCustomerId("");
    setCustomerLabel("");
    setInvoiceDate(localToday());
    setLines([]);
    setNotes("");
    setErrors({});
    setPayMode("FULL");
    setPaidAmount("");
    setMethod("CASH");
    setDraft(null);
    setDirty(true);
    setCreditBlock(null);
    setOverrideReason("");
    setResult(null);
  };

  // --- items -------------------------------------------------------------------

  const addItem = async (productId: string, label: string) => {
    edited();
    const existing = lines.find((line) => line.productId === productId);
    if (existing) {
      // Same item again: one more of it, not a second line.
      const qty = Number(existing.quantity);
      setLines((prev) =>
        prev.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: String(Number.isFinite(qty) ? qty + 1 : 1) }
            : line,
        ),
      );
      return;
    }

    const key = newKey();
    setLines((prev) => [...prev, { key, productId, label, quantity: "1", unitPrice: "" }]);
    setErrors((prev) => ({ ...prev, lines: "" }));

    // The item's usual selling price, as a starting point the cashier can change.
    try {
      const product = await queryClient.fetchQuery({
        queryKey: ["product", productId],
        queryFn: () => productsApi.get(productId),
        staleTime: 60_000,
      });
      if (product?.sellingPrice != null) {
        setLines((prev) =>
          prev.map((line) =>
            line.key === key && line.unitPrice === ""
              ? { ...line, unitPrice: String(product.sellingPrice) }
              : line,
          ),
        );
      }
    } catch {
      // No default price is fine; the cashier types it.
    }
  };

  const changeLine = (key: string, patch: Partial<BillLine>) => {
    edited();
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    edited();
    setLines((prev) => prev.filter((line) => line.key !== key));
  };

  // --- validation and saving -------------------------------------------------

  const validate = () => {
    const next: Record<string, string> = {};
    if (!customerId) next.customer = "Choose the customer";
    if (!warehouseId) next.warehouse = "Choose where the stock goes out from";
    if (!invoiceDate) next.invoiceDate = "Pick a date";
    if (lines.length === 0) next.lines = "Add at least one item";
    for (const line of lines) {
      if (!isPositiveAmount(line.quantity)) next[`qty-${line.key}`] = "More than zero";
      if (line.unitPrice === "" || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) {
        next[`price-${line.key}`] = "Enter a price";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const body = () => ({
    customerId,
    warehouseId,
    invoiceDate,
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    items: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity.trim(),
      unitPrice: line.unitPrice.trim(),
    })),
  });

  /** Creates the draft, or updates it if one was already saved. Throws on failure. */
  const saveDraft = async (): Promise<SalesInvoice> => {
    try {
      const saved = draft ? await salesApi.update(draft.id, body()) : await salesApi.create(body());
      setDraft(saved);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["sale"] });
      return saved;
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        toast.error("Please check the bill", { description: err.fieldErrors[0]?.message });
      } else {
        toast.error("Could not save the bill", {
          description: err instanceof ApiError ? err.message : undefined,
        });
      }
      throw err;
    }
  };

  const onSaveDraft = async () => {
    if (!validate()) return;
    setBusy("saving");
    try {
      await saveDraft();
      toast.success("Saved as a draft", {
        description: canComplete
          ? "The total below is from your books. Complete the sale when ready."
          : "The shop owner can complete it from Sales.",
      });
    } catch {
      // Already explained by saveDraft.
    } finally {
      setBusy(null);
    }
  };

  // --- completing the sale ---------------------------------------------------

  const startComplete = () => {
    if (!validate()) return;
    if (payMode === "PART" && !isPositiveAmount(paidAmount)) {
      setErrors((prev) => ({ ...prev, paid: "Enter how much was paid now" }));
      return;
    }
    setConfirmOpen(true);
  };

  const complete = async (override?: { reason: string }) => {
    setConfirmOpen(false);

    // 1. An up-to-date draft, so the backend has priced exactly what is on screen.
    let doc: SalesInvoice;
    setBusy("saving");
    try {
      doc = draft && !dirty ? draft : await saveDraft();
    } catch {
      setBusy(null);
      return;
    }

    // 2. Post it. The credit limit is the one rule a counter sale commonly hits.
    setBusy("posting");
    let posted: SalesInvoice;
    try {
      posted = await salesApi.post(
        doc.id,
        override
          ? { creditLimitOverride: true, creditLimitOverrideReason: override.reason }
          : undefined,
      );
    } catch (err) {
      setBusy(null);
      if (err instanceof ApiError && err.code === "CREDIT_LIMIT_EXCEEDED") {
        setCreditBlock(err.message);
        return;
      }
      if (err instanceof ApiError && err.code === "ACCOUNTING_PERIOD_CLOSED") {
        toast.error("That month is closed", {
          description: `${err.message} The bill is saved as a draft.`,
          duration: 8000,
        });
        return;
      }
      toast.error("Saved as a draft, but could not complete the sale", {
        description: err instanceof ApiError ? err.message : undefined,
        duration: 8000,
      });
      return;
    }

    setCreditBlock(null);
    setOverrideReason("");
    queryClient.invalidateQueries({ queryKey: ["sale"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });

    if (payMode === "CREDIT") {
      setBusy(null);
      setResult({ invoice: posted, payment: { status: "none" } });
      return;
    }

    // 3. The payment, allocated to this invoice's receivable.
    setBusy("payment");
    let paymentId: string | null = null;
    try {
      const { items } = await dueListsApi.receivables<Receivable>({
        customerId,
        invoiceNumber: posted.invoiceNumber,
        onlyOutstanding: true,
        limit: 10,
      });
      const receivable = items.find((row) => row.salesInvoice?.id === posted.id);
      if (!receivable) {
        // A zero-value bill has nothing due, so there is nothing to receive.
        if (!isPositiveAmount(posted.grandTotal)) {
          setResult({ invoice: posted, payment: { status: "none" } });
          return;
        }
        throw new Error("the amount due on this bill could not be found.");
      }

      // "Full" means exactly what the backend says is due - never a figure
      // worked out on this screen.
      const amount = payMode === "FULL" ? receivable.outstandingAmount : paidAmount.trim();
      const payment = await moneyInApi.create({
        customerId,
        paymentDate: invoiceDate,
        amount,
        paymentMethod: method,
        referenceNumber: posted.invoiceNumber || null,
        allocations: [{ receivableId: receivable.id, amount }],
      });
      paymentId = payment.id;
      await moneyInApi.post(payment.id);
      queryClient.invalidateQueries({ queryKey: ["money"] });
      queryClient.invalidateQueries({ queryKey: ["credit"] });
      setResult({ invoice: posted, payment: { status: "done" } });
      toast.success("Sale and payment recorded");
    } catch (err) {
      const message = stripBodyPrefix(
        err instanceof ApiError
          ? err.fieldErrors?.[0]?.message ?? err.message
          : err instanceof Error
            ? err.message
            : "something went wrong.",
      );
      setResult({
        invoice: posted,
        payment: paymentId ? { status: "unposted", message } : { status: "failed", message },
      });
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  // --- render ------------------------------------------------------------------

  if (warehouses.error) {
    return <ErrorState error={warehouses.error} onRetry={() => warehouses.refetch()} />;
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Quick Billing" description="A counter sale, start to finish." />
        <BillResult
          invoice={result.invoice}
          customerId={customerId}
          payment={result.payment}
          onNewBill={reset}
        />
      </div>
    );
  }

  const locked = busy !== null;
  const hasCurrentTotal = Boolean(draft) && !dirty;
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quick Billing"
        description="Pick the customer, add items, save. The total comes from your books."
        actions={
          draft ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={DETAIL_ROUTES.sale(draft.id)}>Open draft</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {/* Left: who and what */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Customer" required error={errors.customer}>
                <EntitySelect
                  kind="customer"
                  value={customerId}
                  valueLabel={customerLabel}
                  disabled={locked}
                  invalid={Boolean(errors.customer)}
                  placeholder="Choose the customer"
                  onChange={(id, label) => {
                    edited();
                    setCustomerId(id);
                    setCustomerLabel(label);
                    setErrors((prev) => ({ ...prev, customer: "" }));
                  }}
                />
              </Field>
              <Can do="parties.manage">
                <Link
                  href={ROUTES.newCustomer}
                  className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <UserPlus className="h-4 w-4" aria-hidden />
                  New customer? Add them first
                </Link>
              </Can>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Stock from" required error={errors.warehouse}>
                  {warehouses.isLoading ? (
                    <div className="flex h-10 items-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : warehouseItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No store set up yet.{" "}
                      <Link href={ROUTES.settings} className="font-medium text-primary underline">
                        Add one in Settings
                      </Link>
                    </p>
                  ) : (
                    <NativeSelect
                      value={warehouseId}
                      disabled={locked}
                      onChange={(event) => {
                        edited();
                        setWarehouseId(event.target.value);
                      }}
                    >
                      {warehouseItems.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Bill date" htmlFor="qb-date" required error={errors.invoiceDate}>
                  <Input
                    id="qb-date"
                    type="date"
                    value={invoiceDate}
                    disabled={locked}
                    onChange={(event) => {
                      edited();
                      setInvoiceDate(event.target.value);
                    }}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Items{lines.length > 0 ? ` (${lines.length})` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <BillItems
                lines={lines}
                errors={errors}
                disabled={locked}
                onAdd={addItem}
                onChange={changeLine}
                onRemove={removeLine}
              />
              <Field label="Notes" htmlFor="qb-notes">
                <Textarea
                  id="qb-notes"
                  rows={2}
                  value={notes}
                  disabled={locked}
                  maxLength={1000}
                  placeholder="Optional"
                  onChange={(event) => {
                    edited();
                    setNotes(event.target.value);
                  }}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* Right: the total (from the backend), payment and the buttons */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardContent className="space-y-5 p-4 sm:p-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Bill total</p>
                  {draft ? <StatusBadge status={draft.status} /> : null}
                </div>
                {hasCurrentTotal && draft ? (
                  <div className="space-y-1">
                    <p className="text-3xl font-bold tracking-tight">
                      <Money value={draft.grandTotal} />
                    </p>
                    {isGstEnabled || isPositiveAmount(draft.taxTotal) ? (
                      <p className="text-xs text-muted-foreground">
                        Includes tax <Money value={draft.taxTotal} />
                      </p>
                    ) : null}
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                      Worked out by your books when saved
                    </p>
                  </div>
                ) : (
                  <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {draft
                      ? "You changed the bill. The total will be recalculated when you save."
                      : "Total will be calculated when you save."}
                  </p>
                )}
              </div>

              <Can
                do="money.receive"
                fallback={null}
              >
                <PaymentSection
                  mode={payMode}
                  onModeChange={(mode) => {
                    setPayMode(mode);
                    setErrors((prev) => ({ ...prev, paid: "" }));
                  }}
                  amount={paidAmount}
                  onAmountChange={(value) => {
                    setPaidAmount(value);
                    setErrors((prev) => ({ ...prev, paid: "" }));
                  }}
                  method={method}
                  onMethodChange={setMethod}
                  grandTotal={hasCurrentTotal ? draft?.grandTotal : null}
                  error={errors.paid}
                  disabled={locked}
                />
              </Can>

              {creditBlock ? (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <p className="flex items-start gap-2 text-sm">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                    <span>
                      <strong>Over the credit limit.</strong> {creditBlock} The bill is saved as a
                      draft.
                    </span>
                  </p>
                  <Field label="Reason to allow it anyway" htmlFor="qb-override">
                    <Input
                      id="qb-override"
                      value={overrideReason}
                      maxLength={500}
                      placeholder="e.g. Regular customer, will pay Friday"
                      onChange={(event) => setOverrideReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    className="h-11 w-full"
                    disabled={locked || !overrideReason.trim()}
                    onClick={() => complete({ reason: overrideReason.trim() })}
                  >
                    Allow and complete the sale
                  </Button>
                </div>
              ) : null}

              <div className="space-y-2">
                {canComplete ? (
                  <Button className="h-12 w-full text-base" disabled={locked} onClick={startComplete}>
                    {busy && busy !== "saving" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {busy === "posting"
                      ? "Completing the sale…"
                      : busy === "payment"
                        ? "Recording the payment…"
                        : "Save & complete"}
                  </Button>
                ) : null}
                <Button
                  variant={canComplete ? "outline" : "default"}
                  className="h-11 w-full"
                  disabled={locked}
                  onClick={onSaveDraft}
                >
                  {busy === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {draft ? "Save changes" : "Save draft"}
                </Button>
                {!canComplete ? (
                  <p className="text-xs text-muted-foreground">
                    {whyNot("sales.post")} The shop owner completes it and records the payment.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A draft changes nothing. Completing it takes the stock out and adds the bill to
                    the customer&apos;s account.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Complete this sale?"
        confirmLabel="Complete sale"
        isPending={locked}
        onConfirm={() => complete()}
        description={
          <div className="space-y-2">
            <p>
              The bill for <strong className="text-foreground">{customerLabel}</strong> will be
              posted: the stock goes out and it is added to their account. A completed bill cannot
              be edited; a mistake is fixed with a return.
            </p>
            <p>
              Payment:{" "}
              <strong className="text-foreground">
                {payMode === "CREDIT"
                  ? "on credit (nothing received now)"
                  : payMode === "FULL"
                    ? `full bill, by ${methodLabel}`
                    : `₹${paidAmount.trim()} now by ${methodLabel}, the rest on credit`}
              </strong>
            </p>
          </div>
        }
      />
    </div>
  );
}
