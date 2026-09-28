"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, HandCoins, Lock, Pencil, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, dueListsApi, registersApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PrintActions } from "@/components/shared/print-actions";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";
import { isNonZero, isPositive, paymentStatusLabel, trimDecimal } from "./doc-helpers";

/**
 * One sale or purchase, laid out like the paper invoice it stands for, with
 * the actions that change its life:
 *
 *   COMPLETE (post)  stock moves, the party's balance changes, a journal entry
 *                    is written. Irreversible, and admin-only.
 *   CANCEL           abandons a draft that never touched anything.
 *
 * A completed document is never edited. If it is wrong, the remedy is a return,
 * which is a new document - not a rewrite of history.
 *
 * ?print=1 opens the print dialog once the document has loaded, so "Print"
 * from a list row is one tap.
 */

interface PaymentPosition {
  total?: string;
  paid?: string;
  due?: string;
  credited?: string;
  status?: string | null;
}

export function DocumentDetail({ kind, id }: { kind: DocKind; id: string }) {
  const config = DOC_CONFIG[kind];
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { company, gstProfile, isGstEnabled, can } = useAuth();

  const [confirm, setConfirm] = React.useState<"post" | "cancel" | null>(null);
  const [overrideCredit, setOverrideCredit] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [kind, id],
    queryFn: () => config.api.get(id),
  });

  const doc = data ?? {};
  const status = String(doc.status ?? "");
  const isDraft = status === "DRAFT";
  const isPosted = status === "POSTED";
  const party = doc[config.partyKind] as { id?: string; name?: string } | undefined;
  const number = config.numberOf(doc);
  const docDate = typeof doc.invoiceDate === "string" ? doc.invoiceDate.slice(0, 10) : undefined;

  /**
   * What has been paid on THIS document, as the backend's sub-ledger says.
   * A sale's receivable is found by its invoice number; a purchase's figures
   * come from the purchase register for that supplier on that date. If the
   * backend has nothing matching, nothing is shown - never an invented figure.
   */
  const payment = useQuery({
    queryKey: [kind, id, "payment"],
    enabled: isPosted && Boolean(party?.id),
    queryFn: async (): Promise<PaymentPosition | null> => {
      if (kind === "sale") {
        const result = await dueListsApi.receivables<Record<string, unknown>>({
          customerId: party?.id,
          invoiceNumber: number,
          limit: 20,
        });
        const match = result.items.find(
          (r) => (r.salesInvoice as { id?: string } | undefined)?.id === id,
        );
        if (!match) return null;
        return {
          total: String(match.originalAmount ?? ""),
          paid: String(match.paidAmount ?? ""),
          due: String(match.outstandingAmount ?? ""),
          credited: match.creditAmount != null ? String(match.creditAmount) : undefined,
          status: (match.status as string | undefined) ?? null,
        };
      }
      const register = await registersApi.purchases({
        supplierId: party?.id,
        fromDate: docDate,
        toDate: docDate,
        limit: 100,
      });
      const match = register.bills.find((bill) => bill.id === id);
      if (!match) return null;
      return { total: match.total, paid: match.paid, due: match.outstanding, status: match.paymentStatus };
    },
  });

  // ?print=1: print once, after the document (and its payment block) is in.
  const wantsPrint = searchParams?.get("print") === "1";
  const printed = React.useRef(false);
  const readyToPrint = Boolean(data) && (!isPosted || !payment.isLoading);
  React.useEffect(() => {
    if (!wantsPrint || !readyToPrint || printed.current) return;
    printed.current = true;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [wantsPrint, readyToPrint]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [kind] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["credit"] });
  };

  const post = useMutation({
    mutationFn: () =>
      // The credit-limit override applies to sales only; a purchase has no
      // equivalent, because refusing to record a bill a supplier already sent
      // would hide the liability rather than prevent it.
      config.api.post(
        id,
        kind === "sale" && overrideCredit
          ? { creditLimitOverride: true, creditLimitOverrideReason: "Approved on the bill screen" }
          : undefined,
      ),
    onSuccess: () => {
      toast.success(kind === "sale" ? "Sale completed" : "Purchase completed", {
        description: "Stock and balances are updated.",
      });
      setConfirm(null);
      setOverrideCredit(false);
      invalidate();
    },
    onError: (err) => {
      setConfirm(null);
      if (err instanceof ApiError) {
        // The two rules a shopkeeper will actually hit get an explanation
        // rather than a bare code.
        if (err.code === "CREDIT_LIMIT_EXCEEDED") {
          toast.error("Over the credit limit", {
            description: `${err.message} An admin can complete it anyway by ticking the override.`,
            duration: 8000,
          });
          return;
        }
        if (err.code === "ACCOUNTING_PERIOD_CLOSED") {
          toast.error("That month is closed", { description: err.message, duration: 8000 });
          return;
        }
        toast.error("Could not complete", { description: err.message });
        return;
      }
      toast.error("Could not complete");
    },
  });

  const cancel = useMutation({
    mutationFn: () => config.api.cancel(id),
    onSuccess: () => {
      toast.success("Draft cancelled");
      setConfirm(null);
      invalidate();
    },
    onError: (err) => {
      setConfirm(null);
      toast.error("Could not cancel", { description: err instanceof ApiError ? err.message : undefined });
    },
  });

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
      <Link href={config.listHref}>
        <ArrowLeft className="h-4 w-4" />
        {config.listTitle}
      </Link>
    </Button>
  );

  if (isLoading) return <LoadingState rows={5} />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        {backLink}
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const items = (doc.items as Record<string, unknown>[] | undefined) ?? [];
  const pay = payment.data ?? null;
  const showGst = isGstEnabled || isNonZero(doc.taxTotal);
  const ourGstin = company?.gstin || gstProfile?.gstin || null;
  const partyGstin = (kind === "sale" ? doc.buyerGstin : doc.sellerGstin) as string | null | undefined;
  const title =
    kind === "sale" ? (isGstEnabled && ourGstin ? "Tax Invoice" : "Invoice") : "Purchase Bill";
  const who = (value: unknown) => (value as { name?: string } | null | undefined)?.name;

  return (
    <div className="space-y-6">
      {backLink}

      {/* Title and actions: on screen only. */}
      <div className="space-y-3 border-b pb-4" data-print-hide>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold tracking-tight sm:text-2xl">
            {number || (isDraft ? `${config.noun} draft` : config.noun)}
          </h1>
          <StatusBadge status={status} />
          {pay?.status ? <StatusBadge status={pay.status} /> : null}
        </div>
        {party?.name ? <p className="text-sm text-muted-foreground">{party.name}</p> : null}

        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <Can do={config.postCapability}>
                <Button className="min-h-[44px] gap-1.5 sm:min-h-0" onClick={() => setConfirm("post")}>
                  <CheckCircle2 className="h-4 w-4" />
                  Complete {config.noun.toLowerCase()}
                </Button>
              </Can>
              <Can do={config.draftCapability}>
                <Button asChild variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0">
                  <Link href={config.editHref(id)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                </Button>
              </Can>
              <Can do={config.postCapability}>
                <Button
                  variant="outline"
                  className="min-h-[44px] gap-1.5 text-destructive sm:min-h-0"
                  onClick={() => setConfirm("cancel")}
                >
                  <Ban className="h-4 w-4" />
                  Cancel draft
                </Button>
              </Can>
            </>
          ) : null}
          {isPosted && party?.id && isPositive(pay?.due) && can(config.paymentCapability) ? (
            <Button asChild className="min-h-[44px] gap-1.5 sm:min-h-0">
              <Link href={config.paymentHref(party.id)}>
                <HandCoins className="h-4 w-4" />
                {config.paymentLabel}
              </Link>
            </Button>
          ) : null}
          {isPosted ? (
            <Can do={config.returnCapability}>
              <Button asChild variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0">
                <Link href={config.returnHref(id)}>
                  <Undo2 className="h-4 w-4" />
                  Return items
                </Link>
              </Button>
            </Can>
          ) : null}
        </div>
        <PrintActions title={`${title} ${number}`.trim()} />
      </div>

      {isDraft ? (
        <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground" data-print-hide>
          This is a <strong className="text-foreground">draft</strong>. Nothing has moved yet — no stock, no
          balances. Complete it when you are sure it is right.
          <Can do={config.postCapability} explain>
            <span />
          </Can>
        </div>
      ) : isPosted ? (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground" data-print-hide>
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {config.completedNote}
        </div>
      ) : status === "CANCELLED" ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground" data-print-hide>
          This draft was cancelled. It never moved stock or money.
        </div>
      ) : null}

      {/* The document itself: this is what goes on paper. */}
      <Card>
        <CardContent className="space-y-6 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="text-lg font-bold">{company?.name ?? ""}</p>
              {company?.legalName && company.legalName !== company.name ? (
                <p className="text-sm text-muted-foreground">{company.legalName}</p>
              ) : null}
              {company?.registeredAddress ? (
                <p className="whitespace-pre-line text-sm text-muted-foreground">{company.registeredAddress}</p>
              ) : null}
              {isGstEnabled && ourGstin ? <p className="text-sm">GSTIN: {ourGstin}</p> : null}
            </div>
            <div className="space-y-0.5 sm:text-right">
              <p className="text-base font-semibold uppercase tracking-wide">{title}</p>
              <p className="text-sm">
                <span className="text-muted-foreground">No. </span>
                {number || "Draft"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Date </span>
                {formatDate(String(doc.invoiceDate ?? ""))}
              </p>
              {doc.dueDate ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Due </span>
                  {formatDate(String(doc.dueDate))}
                </p>
              ) : null}
              {kind === "purchase" && doc.invoiceNumber ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Supplier bill no. </span>
                  {String(doc.invoiceNumber)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {kind === "sale" ? "Bill to" : "Supplier"}
            </p>
            <p className="font-medium">{party?.name ?? String(doc.customerNameSnapshot ?? doc.supplierNameSnapshot ?? "—")}</p>
            {showGst && partyGstin ? <p className="text-sm">GSTIN: {partyGstin}</p> : null}
            {showGst && doc.placeOfSupplyStateCode ? (
              <p className="text-sm text-muted-foreground">Place of supply: {String(doc.placeOfSupplyStateCode)}</p>
            ) : null}
            {doc.warehouse ? (
              <p className="text-sm text-muted-foreground" data-print-hide>
                Godown: {who(doc.warehouse)}
              </p>
            ) : null}
          </div>

          <ItemsBlock items={items} amountField={config.amountField} amountLabel={config.amountLabel} showGst={showGst} />

          <div className="ml-auto w-full space-y-1.5 sm:max-w-xs">
            <TotalRow label="Sub total" value={doc.subtotal} />
            {isNonZero(doc.discountTotal) ? <TotalRow label="Discount" value={doc.discountTotal} /> : null}
            {isNonZero(doc.cgstTotal) ? <TotalRow label="CGST" value={doc.cgstTotal} /> : null}
            {isNonZero(doc.sgstTotal) ? <TotalRow label="SGST" value={doc.sgstTotal} /> : null}
            {isNonZero(doc.igstTotal) ? <TotalRow label="IGST" value={doc.igstTotal} /> : null}
            {isNonZero(doc.cessTotal) ? <TotalRow label="Cess" value={doc.cessTotal} /> : null}
            {/* Tax only appears when there IS tax, and as one line only when
                the backend gave no split. */}
            {isNonZero(doc.taxTotal) &&
            !isNonZero(doc.cgstTotal) &&
            !isNonZero(doc.sgstTotal) &&
            !isNonZero(doc.igstTotal) ? (
              <TotalRow label="Tax" value={doc.taxTotal} />
            ) : null}
            <div className="flex items-baseline justify-between gap-4 border-t pt-2">
              <span className="font-semibold">Total</span>
              <Money value={String(doc.grandTotal ?? "0")} className="text-lg font-bold" />
            </div>
          </div>

          {isPosted ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</p>
              {payment.isLoading ? (
                <LoadingState rows={1} />
              ) : payment.error ? (
                <p className="text-sm text-muted-foreground" data-print-hide>
                  Could not load payments.{" "}
                  <button type="button" className="underline" onClick={() => payment.refetch()}>
                    Try again
                  </button>
                </p>
              ) : pay ? (
                <div className="space-y-2">
                  <PaidDue paid={pay.paid} due={pay.due} size="lg" />
                  <p className="text-sm text-muted-foreground">
                    {paymentStatusLabel(pay.status ?? undefined)}
                    {isNonZero(pay.credited) ? (
                      <>
                        {" · "}
                        <Money value={pay.credited} /> settled by returns
                      </>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {doc.notes ? (
            <div className="border-t pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="whitespace-pre-line text-sm">{String(doc.notes)}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card data-print-hide>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            Created{who(doc.createdBy) ? ` by ${who(doc.createdBy)}` : ""} on {formatDateTime(String(doc.createdAt ?? ""))}
          </p>
          {doc.postedAt ? (
            <p>
              Completed{who(doc.postedBy) ? ` by ${who(doc.postedBy)}` : ""} on {formatDateTime(String(doc.postedAt))}
            </p>
          ) : null}
          {doc.cancelledAt ? (
            <p>
              Cancelled{who(doc.cancelledBy) ? ` by ${who(doc.cancelledBy)}` : ""} on{" "}
              {formatDateTime(String(doc.cancelledAt))}
            </p>
          ) : null}
          {doc.creditLimitOverride ? (
            <p className="text-warning">
              Completed over the customer&apos;s credit limit
              {doc.creditLimitOverrideReason ? ` — ${String(doc.creditLimitOverrideReason)}` : ""}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm === "post"}
        onOpenChange={(open) => setConfirm(open ? "post" : null)}
        title={`Complete this ${config.noun.toLowerCase()}?`}
        confirmLabel="Complete"
        isPending={post.isPending}
        onConfirm={() => post.mutate()}
        description={
          <div className="space-y-3">
            <p>
              {kind === "sale"
                ? "Stock will go out, and the customer's balance will go up. This cannot be undone — a mistake is fixed with a sales return."
                : "Stock will come in, and what you owe the supplier will go up. This cannot be undone — a mistake is fixed with a purchase return."}
            </p>
            {kind === "sale" ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={overrideCredit}
                  onChange={(e) => setOverrideCredit(e.target.checked)}
                />
                <span className="text-muted-foreground">
                  Complete even if this takes the customer over their credit limit. Only tick this if you have
                  decided to extend them the credit.
                </span>
              </label>
            ) : null}
          </div>
        }
      />

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => setConfirm(open ? "cancel" : null)}
        title="Cancel this draft?"
        confirmLabel="Cancel draft"
        destructive
        isPending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        description="The draft will be marked cancelled. It was never completed, so nothing needs undoing."
      />
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Money value={String(value ?? "0")} />
    </div>
  );
}

/**
 * The lines, as the backend saved them. Cards on a phone, a table from `sm`
 * up (which is also what prints, since paper is wider than `sm`).
 */
function ItemsBlock({
  items,
  amountField,
  amountLabel,
  showGst,
}: {
  items: Record<string, unknown>[];
  amountField: "unitPrice" | "unitCost";
  amountLabel: string;
  showGst: boolean;
}) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No items on this document.</p>;
  }

  const name = (item: Record<string, unknown>) => String(item.productNameSnapshot ?? item.productName ?? "Item");
  const unit = (item: Record<string, unknown>) => (item.unitNameSnapshot ? ` ${String(item.unitNameSnapshot)}` : "");
  const meta = (item: Record<string, unknown>) =>
    [
      item.skuSnapshot ? `SKU ${String(item.skuSnapshot)}` : null,
      showGst && item.hsnCodeSnapshot ? `HSN ${String(item.hsnCodeSnapshot)}` : null,
      showGst && item.taxRateSnapshot != null ? `GST ${trimDecimal(item.taxRateSnapshot)}%` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <>
      <ul className="divide-y rounded-lg border sm:hidden">
        {items.map((item, index) => (
          <li key={String(item.id ?? index)} className="space-y-1 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium">{name(item)}</p>
              <Money value={String(item.lineTotal ?? "0")} className="shrink-0 font-semibold" />
            </div>
            <p className="text-xs text-muted-foreground">
              {trimDecimal(item.quantity)}
              {unit(item)} × <Money value={String(item[amountField] ?? "0")} />
              {isNonZero(item.discountAmount) ? (
                <>
                  {" · "}discount <Money value={String(item.discountAmount)} />
                </>
              ) : null}
              {isNonZero(item.taxAmount) ? (
                <>
                  {" · "}tax <Money value={String(item.taxAmount)} />
                </>
              ) : null}
            </p>
            {meta(item) ? <p className="text-xs text-muted-foreground">{meta(item)}</p> : null}
          </li>
        ))}
      </ul>

      <div className="hidden w-full overflow-x-auto sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">{amountLabel}</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className={cn("text-right", !showGst && "hidden")}>Tax</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={String(item.id ?? index)}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <span className="block font-medium">{name(item)}</span>
                  {meta(item) ? <span className="block text-xs text-muted-foreground">{meta(item)}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">
                  {trimDecimal(item.quantity)}
                  {unit(item)}
                </TableCell>
                <TableCell className="text-right tabular">
                  <Money value={String(item[amountField] ?? "0")} />
                </TableCell>
                <TableCell className="text-right tabular">
                  {isNonZero(item.discountAmount) ? <Money value={String(item.discountAmount)} /> : "—"}
                </TableCell>
                <TableCell className={cn("text-right tabular", !showGst && "hidden")}>
                  {isNonZero(item.taxAmount) ? <Money value={String(item.taxAmount)} /> : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular">
                  <Money value={String(item.lineTotal ?? "0")} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
