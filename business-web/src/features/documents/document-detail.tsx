"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/form-parts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import { formatAmount, formatDate } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";

/**
 * One sale or purchase, and the two actions that change its life:
 *
 *   POST    commits it - stock moves, the party's balance changes, a journal
 *           entry is written. Irreversible, and admin-only.
 *   CANCEL  abandons a draft that never touched anything.
 *
 * A posted document is never edited. If it is wrong, the remedy is a return or
 * a credit note, which is a new document - not a rewrite of history.
 */
export function DocumentDetail({ kind, id }: { kind: DocKind; id: string }) {
  const config = DOC_CONFIG[kind];
  const queryClient = useQueryClient();

  const [confirm, setConfirm] = React.useState<"post" | "cancel" | null>(null);
  const [overrideCredit, setOverrideCredit] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [kind, id],
    queryFn: () => config.api.get(id) as Promise<Record<string, unknown>>,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [kind] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const post = useMutation({
    mutationFn: () =>
      // The credit-limit override applies to sales only; a purchase has no
      // equivalent, because refusing to record a bill a supplier already sent
      // would hide the liability rather than prevent it.
      config.api.post(
        id,
        kind === "sale" && overrideCredit
          ? {
              creditLimitOverride: true,
              creditLimitOverrideReason: "Approved on the bill screen",
            }
          : undefined,
      ),
    onSuccess: () => {
      toast.success("Posted to the books");
      setConfirm(null);
      setOverrideCredit(false);
      invalidate();
    },
    onError: (err) => {
      setConfirm(null);
      if (err instanceof ApiError) {
        // The two rules the backend enforces that a shopkeeper will actually
        // hit. Both get an explanation rather than a bare code.
        if (err.code === "CREDIT_LIMIT_EXCEEDED") {
          toast.error("Over the credit limit", {
            description: `${err.message} An admin can post it anyway using the override.`,
            duration: 8000,
          });
          return;
        }
        if (err.code === "ACCOUNTING_PERIOD_CLOSED") {
          toast.error("That month is closed", {
            description: err.message,
            duration: 8000,
          });
          return;
        }
        toast.error("Could not post", { description: err.message });
        return;
      }
      toast.error("Could not post");
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
      toast.error("Could not cancel", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  if (isLoading) return <LoadingState rows={4} />;
  if (error) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href={config.backHref}>
            <ArrowLeft className="h-4 w-4" />
            {config.listTitle}
          </Link>
        </Button>
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const doc = data ?? {};
  const status = String(doc.status ?? "");
  const isDraft = status === "DRAFT";
  const party = doc[config.partyKind] as { id?: string; name?: string } | undefined;
  const items = (doc.items as Record<string, unknown>[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href={config.backHref}>
          <ArrowLeft className="h-4 w-4" />
          {config.listTitle}
        </Link>
      </Button>

      <PageHeader
        title={config.numberOf(doc) || "Document"}
        description={party?.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {isDraft ? (
              <>
                <Can do={config.postCapability}>
                  <Button className="gap-1.5" onClick={() => setConfirm("post")}>
                    <CheckCircle2 className="h-4 w-4" />
                    Post to books
                  </Button>
                </Can>
                <Can do={config.postCapability}>
                  <Button variant="outline" className="gap-1.5" onClick={() => setConfirm("cancel")}>
                    <Ban className="h-4 w-4" />
                    Cancel
                  </Button>
                </Can>
              </>
            ) : null}
          </div>
        }
      />

      {isDraft ? (
        <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground">
          This is a <strong className="text-foreground">draft</strong>. Nothing has moved yet — no
          stock, no balances. Post it when you are sure it is right.
          <Can do={config.postCapability} explain>
            <span />
          </Can>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">{config.amountLabel}</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        No items on this document.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, index) => (
                      <TableRow key={String(item.id ?? index)}>
                        <TableCell>
                          <span className="block font-medium">
                            {String(item.productNameSnapshot ?? item.productName ?? "Item")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatAmount(String(item.quantity ?? "0"))}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          <Money value={String(item[config.amountField] ?? "0")} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular">
                          <Money value={String(item.lineTotal ?? item.taxableAmount ?? "0")} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <DetailRow label="Date">{formatDate(String(doc[config.dateField] ?? ""))}</DetailRow>
            <DetailRow label="Due">
              {doc.dueDate ? formatDate(String(doc.dueDate)) : "—"}
            </DetailRow>
            {config.requiresSupplierInvoiceNumber ? (
              <DetailRow label="Supplier bill no.">{String(doc.invoiceNumber ?? "—")}</DetailRow>
            ) : null}
            <DetailRow label="Sub total">
              <Money value={String(doc.subtotal ?? "0")} />
            </DetailRow>
            {doc.discountTotal && doc.discountTotal !== "0.00" ? (
              <DetailRow label="Discount">
                <Money value={String(doc.discountTotal)} />
              </DetailRow>
            ) : null}
            {/* Tax only appears when there IS tax. A non-GST shop never sees a
                zero tax row it has to think about. */}
            {doc.taxTotal && doc.taxTotal !== "0.00" ? (
              <DetailRow label="Tax">
                <Money value={String(doc.taxTotal)} />
              </DetailRow>
            ) : null}
            <DetailRow label="Total">
              <span className="text-base font-bold">
                <Money value={String(doc.grandTotal ?? "0")} />
              </span>
            </DetailRow>
            {doc.notes ? <DetailRow label="Notes">{String(doc.notes)}</DetailRow> : null}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm === "post"}
        onOpenChange={(open) => setConfirm(open ? "post" : null)}
        title="Post this to the books?"
        confirmLabel="Post"
        isPending={post.isPending}
        onConfirm={() => post.mutate()}
        description={
          <div className="space-y-3">
            <p>
              {kind === "sale"
                ? "Stock will go out, and the customer's balance will go up. This cannot be undone — a mistake is fixed with a sales return."
                : "Stock will come in, and the supplier's balance will go up. This cannot be undone — a mistake is fixed with a purchase return."}
            </p>
            {kind === "sale" ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={overrideCredit}
                  onChange={(e) => setOverrideCredit(e.target.checked)}
                />
                <span className="text-muted-foreground">
                  Post even if this takes the customer over their credit limit. Only tick this if
                  you have decided to extend them the credit.
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
        description="The draft will be marked cancelled. Nothing was posted, so nothing needs undoing."
      />
    </div>
  );
}
