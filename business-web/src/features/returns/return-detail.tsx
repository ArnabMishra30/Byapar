"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/form-parts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Can } from "@/components/shared/permission-gate";
import { PrintActions } from "@/components/shared/print-actions";
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
import { formatDate, formatDateTime } from "@/lib/utils";
import { RETURN_CONFIG, type ReturnKind } from "./config";
import { formatQuantity } from "./helpers";
import { PurchaseModuleTabs, SalesModuleTabs } from "./module-tabs";

const isNonZero = (value: unknown) =>
  typeof value === "string" && value !== "" && !/^0+(\.0+)?$/.test(value);

/**
 * One sales or purchase return.
 *
 *   COMPLETE (post)  moves the stock and raises the credit against the
 *                    customer's invoice / supplier's bill. Admin only, final.
 *   CANCEL           abandons a draft that never touched anything. Admin only.
 *
 * Every figure on this page is the backend's.
 */
export function ReturnDetail({ kind, id }: { kind: ReturnKind; id: string }) {
  const config = RETURN_CONFIG[kind];
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = React.useState<"post" | "cancel" | null>(null);

  const { data: doc, isLoading, error, refetch } = useQuery({
    queryKey: [config.queryKey, id],
    queryFn: () => config.api.get(id),
  });

  // A completed return changes stock, the party's balance, reports and the
  // books, so everything cached is stale afterwards.
  const invalidateAll = () => queryClient.invalidateQueries();

  const post = useMutation({
    mutationFn: () => config.api.post(id),
    onSuccess: () => {
      toast.success("Return completed");
      setConfirm(null);
      invalidateAll();
    },
    onError: (err) => {
      setConfirm(null);
      if (err instanceof ApiError && err.code === "ACCOUNTING_PERIOD_CLOSED") {
        toast.error("That month is closed", { description: err.message, duration: 8000 });
        return;
      }
      toast.error("Could not complete the return", {
        description: err instanceof ApiError ? err.message : undefined,
        duration: 8000,
      });
    },
  });

  const cancel = useMutation({
    mutationFn: () => config.api.cancel(id),
    onSuccess: () => {
      toast.success("Draft cancelled");
      setConfirm(null);
      invalidateAll();
    },
    onError: (err) => {
      setConfirm(null);
      toast.error("Could not cancel", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
      <Link href={config.listHref}>
        <ArrowLeft className="h-4 w-4" />
        {config.listTitle}
      </Link>
    </Button>
  );

  if (isLoading) return <LoadingState rows={4} />;
  if (error || !doc) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const isDraft = doc.status === "DRAFT";
  const party = config.partyOf(doc);
  const source = config.sourceOf(doc);
  const items = doc.items ?? [];
  const warehouse = doc.warehouse as { name?: string } | undefined;
  const createdBy = doc.createdBy as { name?: string } | null | undefined;
  const postedBy = doc.postedBy as { name?: string } | null | undefined;
  const title = `${kind === "sale" ? "Sales return" : "Purchase return"} ${doc.returnNumber ?? ""}`.trim();

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={title}
        description={party?.name}
        actions={<StatusBadge status={doc.status} />}
      />
      {kind === "sale" ? <SalesModuleTabs /> : <PurchaseModuleTabs />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-print-hide>
        {isDraft ? (
          <Can do={config.postCapability} explain>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-[44px] gap-1.5 sm:min-h-0" onClick={() => setConfirm("post")}>
                <CheckCircle2 className="h-4 w-4" />
                Complete return
              </Button>
              <Button
                variant="outline"
                className="min-h-[44px] gap-1.5 sm:min-h-0"
                onClick={() => setConfirm("cancel")}
              >
                <Ban className="h-4 w-4" />
                Cancel draft
              </Button>
            </div>
          </Can>
        ) : (
          <span />
        )}
        <PrintActions title={title} />
      </div>

      {isDraft ? (
        <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground" data-print-hide>
          This return is a <strong className="text-foreground">draft</strong>. No stock has moved and
          no balance has changed yet. Complete it when the goods have actually{" "}
          {kind === "sale" ? "come back" : "gone back to the supplier"}.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Items returned</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No items on this return.</p>
            ) : (
              <>
                {/* Phone: one card per line instead of a sideways-scrolling table. */}
                <ul className="divide-y sm:hidden">
                  {items.map((item, index) => (
                    <li key={String(item.id ?? index)} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{String(item.productName ?? "Item")}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatQuantity(String(item.quantity ?? ""))} ×{" "}
                          <Money value={String(item[config.linePriceField] ?? "0")} />
                        </p>
                      </div>
                      <Money value={String(item.lineTotal ?? "0")} className="shrink-0 text-sm font-semibold" />
                    </li>
                  ))}
                </ul>
                <div className="hidden w-full overflow-x-auto sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">{config.unitPriceLabel}</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, index) => (
                        <TableRow key={String(item.id ?? index)}>
                          <TableCell>
                            <span className="block font-medium">{String(item.productName ?? "Item")}</span>
                            {item.sku ? (
                              <span className="block text-xs text-muted-foreground">{String(item.sku)}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular">
                            {formatQuantity(String(item.quantity ?? ""))}
                          </TableCell>
                          <TableCell className="text-right tabular">
                            <Money value={String(item[config.linePriceField] ?? "0")} />
                          </TableCell>
                          <TableCell className="text-right tabular">
                            <Money value={String(item.taxAmount ?? "0")} />
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
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <DetailRow label="Return date">{formatDate(doc.returnDate)}</DetailRow>
            <DetailRow label={config.partyLabel}>{party?.name ?? "—"}</DetailRow>
            <DetailRow label={`Original ${config.sourceLabel.toLowerCase()}`}>
              {source ? (
                <Link href={config.sourceHref(source.id)} className="text-primary hover:underline">
                  {source.number}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            {warehouse?.name ? <DetailRow label="Godown">{warehouse.name}</DetailRow> : null}
            {doc.reason ? <DetailRow label="Reason">{doc.reason}</DetailRow> : null}
            {isNonZero(doc.subtotal) ? (
              <DetailRow label="Sub total">
                <Money value={doc.subtotal} />
              </DetailRow>
            ) : null}
            {isNonZero(doc.taxableTotal) ? (
              <DetailRow label="Taxable amount">
                <Money value={String(doc.taxableTotal)} />
              </DetailRow>
            ) : null}
            {isNonZero(doc.discountTotal) ? (
              <DetailRow label="Discount">
                <Money value={String(doc.discountTotal)} />
              </DetailRow>
            ) : null}
            {isNonZero(doc.taxTotal) ? (
              <DetailRow label="Tax">
                <Money value={doc.taxTotal} />
              </DetailRow>
            ) : null}
            <DetailRow label="Return amount">
              <span className="text-base font-bold">
                <Money value={doc.grandTotal ?? "0"} />
              </span>
            </DetailRow>
            {doc.notes ? <DetailRow label="Notes">{doc.notes}</DetailRow> : null}
            {createdBy?.name ? <DetailRow label="Prepared by">{createdBy.name}</DetailRow> : null}
            {postedBy?.name ? (
              <DetailRow label="Completed by">
                {postedBy.name}
                {doc.postedAt ? ` · ${formatDateTime(String(doc.postedAt))}` : ""}
              </DetailRow>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm === "post"}
        onOpenChange={(open) => setConfirm(open ? "post" : null)}
        title={config.postTitle}
        confirmLabel="Complete return"
        isPending={post.isPending}
        onConfirm={() => post.mutate()}
        description={config.postDescription}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => setConfirm(open ? "cancel" : null)}
        title="Cancel this draft return?"
        confirmLabel="Cancel draft"
        destructive
        isPending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        description="The draft will be marked cancelled. Nothing was completed, so no stock or balance needs undoing."
      />
    </div>
  );
}
