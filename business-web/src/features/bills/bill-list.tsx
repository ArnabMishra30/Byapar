"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Loader2,
  RefreshCw,
  Save,
  ScanLine,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { billsApi, type Bill, type BillDirection } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select-native";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, stripBodyPrefix } from "@/lib/utils";

/**
 * Bill import: photograph a bill, check what was read, then record it.
 *
 * THE ONE RULE OF THIS SCREEN: nothing here posts to the books on its own. A
 * bill is read, a human checks it, and only the human's confirmation creates an
 * accounting document — through the ordinary purchase and sales flows, with the
 * same rules the typed forms follow.
 *
 *   IN  — a bill you RECEIVED   becomes a PURCHASE (stock comes in)
 *   OUT — a bill you ISSUED     becomes a SALE     (stock goes out)
 *
 * Other screens open the upload dialog directly with `?upload=1`, optionally
 * with `&direction=IN|OUT` (e.g. the Home "Upload Bill" tile).
 */

/** Shop-owner wording for the two directions, used across the bill screens. */
export const DIRECTION_LABEL: Record<BillDirection, string> = {
  IN: "IN · Purchase bill (stock comes in)",
  OUT: "OUT · Sales bill (stock goes out)",
};

const STEPS = [
  { icon: Upload, title: "1. Upload", text: "Take a photo or choose a PDF of the bill." },
  { icon: ClipboardCheck, title: "2. Check", text: "We read it. You fix anything misread and match the items." },
  { icon: Save, title: "3. Save", text: "Only when you confirm is it saved as a purchase or a sale." },
];

/** Where a recorded bill lives now. */
function postedHref(bill: Bill) {
  if (!bill.posted) return null;
  return bill.posted.sourceType === "PURCHASE"
    ? DETAIL_ROUTES.purchase(bill.posted.sourceId)
    : DETAIL_ROUTES.sale(bill.posted.sourceId);
}

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Reading…",
  REVIEW: "Ready to check",
  POSTED: "Recorded",
  FAILED: "Could not read",
  CANCELLED: "Cancelled",
};

export function BillListScreen() {
  const queryClient = useQueryClient();
  const list = useListState();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadDirection, setUploadDirection] = React.useState<BillDirection>("IN");

  // `?upload=1[&direction=IN|OUT]` opens the upload dialog straight away. The
  // query is then removed, so a refresh or the back button does not reopen it.
  React.useEffect(() => {
    if (searchParams?.get("upload") !== "1") return;
    setUploadDirection(searchParams.get("direction") === "OUT" ? "OUT" : "IN");
    setUploadOpen(true);
    router.replace(ROUTES.bills);
  }, [searchParams, router]);

  const openUpload = () => {
    setUploadDirection("IN");
    setUploadOpen(true);
  };
  const [cancelling, setCancelling] = React.useState<Bill | null>(null);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [directionFilter, setDirectionFilter] = React.useState("");

  const summary = useQuery({
    queryKey: ["bills", "summary"],
    queryFn: () => billsApi.summary(),
  });

  const query = useQuery({
    queryKey: ["bills", list.page, statusFilter, directionFilter],
    queryFn: () =>
      billsApi.list({
        page: list.page,
        limit: 20,
        status: statusFilter || undefined,
        direction: directionFilter || undefined,
      }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bills"] });
  };

  const retryMutation = useMutation({
    mutationFn: (id: string) => billsApi.retry(id),
    onSuccess: (bill) => {
      toast.success(
        bill.status === "REVIEW" ? "Read again — check the details" : "Still could not read it"
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => billsApi.cancel(id, "Cancelled by user"),
    onSuccess: () => {
      toast.success("Bill cancelled");
      setCancelling(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  const columns: Column<Bill>[] = [
    {
      header: "Bill",
      cell: (bill) => (
        <div className="min-w-0">
          <div className="font-medium truncate">
            {bill.reviewedData?.partyName || bill.file.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {bill.direction === "IN" ? "IN · Purchase" : "OUT · Sale"}
            {bill.reviewedData?.invoiceNumber ? ` · ${bill.reviewedData.invoiceNumber}` : ""}
          </div>
        </div>
      ),
    },
    {
      header: "Amount",
      cell: (bill) =>
        bill.reviewedData?.grandTotal ? (
          // As printed on the bill (read, not calculated). The recorded
          // document's own total is on its page once saved.
          <Money value={bill.reviewedData.grandTotal} className="font-medium" />
        ) : (
          // Never invent a figure. If it was not read, it is not shown.
          <span className="text-muted-foreground text-sm">Not read</span>
        ),
    },
    {
      header: "Uploaded",
      hideOnMobile: true,
      cell: (bill) => (
        <span className="text-sm tabular-nums">{formatDate(bill.createdAt)}</span>
      ),
    },
    {
      header: "Status",
      cell: (bill) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={bill.status} />
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {STATUS_LABEL[bill.status]}
          </span>
        </div>
      ),
    },
    {
      header: "",
      className: "text-right",
      cell: (bill) => renderActions(bill),
    },
  ];

  // The row actions, shared by the table and the phone card.
  function renderActions(bill: Bill) {
    const href = postedHref(bill);
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {(bill.status === "REVIEW" || bill.status === "FAILED") && (
          <Button size="sm" asChild className="h-10">
            <Link href={DETAIL_ROUTES.bill(bill.id)}>Check &amp; save</Link>
          </Button>
        )}

        {bill.status === "POSTED" && href && (
          <Button size="sm" variant="outline" asChild className="h-10">
            <Link href={href}>Open document</Link>
          </Button>
        )}

        {bill.status === "FAILED" && (
          <Button
            size="icon"
            variant="ghost"
            title="Try reading it again"
            aria-label="Try reading it again"
            disabled={retryMutation.isPending}
            onClick={() => retryMutation.mutate(bill.id)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}

        {bill.status !== "POSTED" && bill.status !== "CANCELLED" && (
          <Button
            size="icon"
            variant="ghost"
            title="Cancel this bill"
            aria-label="Cancel this bill"
            onClick={() => setCancelling(bill)}
          >
            <Ban className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bill Import"
        description="Photograph a bill, check what was read, then save it as a purchase or a sale."
        actions={
          <Can do="bills.upload">
            <Button onClick={openUpload}>
              <Upload className="h-4 w-4" />
              Upload a bill
            </Button>
          </Can>
        }
      />

      {/* How it works, in three steps, stated up front so nobody expects a
          photo to land in the books on its own. */}
      <Card>
        <CardContent className="grid gap-3 p-3 sm:grid-cols-3 sm:p-4">
          {STEPS.map((step) => (
            <div key={step.title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <step.icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.text}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* If the server has no AI key, say so plainly rather than letting people
          upload bills that will never be read. */}
      {summary.data && !summary.data.extractionConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">Automatic bill reading is not set up on this server.</p>
            <p className="text-muted-foreground mt-0.5">
              You can still upload bills to keep the photo on file, but they will not be read
              automatically. Enter them using the normal Purchase and Sales forms for now.
            </p>
          </div>
        </div>
      )}

      {summary.data && summary.data.awaitingReview > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium">
              {summary.data.awaitingReview} bill
              {summary.data.awaitingReview === 1 ? "" : "s"} waiting for you
            </p>
            <p className="text-muted-foreground mt-0.5">
              Nothing is recorded until you check it and confirm.
            </p>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(bill) => bill.id}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        pagination={
          query.data?.pagination
            ? { ...query.data.pagination, onPageChange: list.setPage }
            : undefined
        }
        mobileCard={(bill) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {bill.reviewedData?.partyName || bill.file.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {bill.direction === "IN" ? "IN · Purchase" : "OUT · Sale"} ·{" "}
                  {formatDate(bill.createdAt)}
                  {bill.reviewedData?.invoiceNumber ? ` · ${bill.reviewedData.invoiceNumber}` : ""}
                </p>
              </div>
              <StatusBadge status={bill.status} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                {bill.reviewedData?.grandTotal ? (
                  <Money value={bill.reviewedData.grandTotal} className="font-medium" />
                ) : (
                  <span className="text-muted-foreground">{STATUS_LABEL[bill.status]}</span>
                )}
              </span>
              {renderActions(bill)}
            </div>
          </div>
        )}
        emptyTitle="No bills uploaded yet"
        emptyDescription="Take a photo of a supplier or sales bill and upload it to get started."
        emptyAction={
          <Can do="bills.upload">
            <Button onClick={openUpload}>
              <Upload className="h-4 w-4" />
              Upload a bill
            </Button>
          </Can>
        }
        filters={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <NativeSelect
              aria-label="Filter by status"
              className="sm:w-44"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                list.setPage(1);
              }}
            >
              <option value="">Any status</option>
              <option value="REVIEW">Ready to check</option>
              <option value="POSTED">Recorded</option>
              <option value="FAILED">Could not read</option>
              <option value="CANCELLED">Cancelled</option>
            </NativeSelect>

            <NativeSelect
              aria-label="Filter by kind of bill"
              className="sm:w-72"
              value={directionFilter}
              onChange={(event) => {
                setDirectionFilter(event.target.value);
                list.setPage(1);
              }}
            >
              <option value="">All bills</option>
              <option value="IN">{DIRECTION_LABEL.IN}</option>
              <option value="OUT">{DIRECTION_LABEL.OUT}</option>
            </NativeSelect>
          </div>
        }
      />

      <UploadBillDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={invalidate}
        initialDirection={uploadDirection}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this bill?"
        description="The photo stays on file but the bill will not be recorded. Nothing in your books changes."
        confirmLabel="Cancel bill"
        destructive
        isPending={cancelMutation.isPending}
        onConfirm={() => {
          if (cancelling) cancelMutation.mutate(cancelling.id);
        }}
      />
    </div>
  );
}

/** The upload step. Direction first, because it decides everything downstream. */
export function UploadBillDialog({
  open,
  onOpenChange,
  onUploaded,
  startWithCamera = false,
  initialDirection = "IN",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: (bill: Bill) => void;
  /** Open the camera as soon as the dialog appears, rather than a file picker. */
  startWithCamera?: boolean;
  /** Pre-select IN or OUT, e.g. when opened from `?upload=1&direction=OUT`. */
  initialDirection?: BillDirection;
}) {
  const [direction, setDirection] = React.useState<BillDirection>(initialDirection);
  const [file, setFile] = React.useState<File | null>(null);

  // Each time the dialog opens it starts on the direction it was asked for.
  React.useEffect(() => {
    if (open) setDirection(initialDirection);
  }, [open, initialDirection]);

  // TWO INPUTS, NOT ONE.
  //
  // `capture` is what makes a phone open the camera instead of the gallery, and
  // it cannot be toggled reliably on a single input after the fact - Safari in
  // particular caches the behaviour. Two inputs, one with capture and one
  // without, is the arrangement that actually works on a real phone.
  //
  // On a desktop `capture` is ignored and both open a file dialog, which is the
  // right outcome there.
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Opening straight into the camera when that is how the dialog was launched.
  // The small delay lets the dialog mount first; clicking a hidden input in the
  // same tick is ignored by some mobile browsers.
  React.useEffect(() => {
    if (!open || !startWithCamera || file) return;
    const timer = setTimeout(() => cameraRef.current?.click(), 250);
    return () => clearTimeout(timer);
  }, [open, startWithCamera, file]);

  // A fresh dialog should never show the previous attempt's file.
  React.useEffect(() => {
    if (!open) setFile(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => billsApi.upload(file as File, direction),
    onSuccess: (bill) => {
      if (bill.status === "REVIEW") {
        toast.success("Bill read — check the details before recording it");
      } else if (bill.status === "FAILED") {
        toast.warning(bill.extractionError ?? "The bill could not be read");
      } else {
        toast.success("Bill uploaded");
      }
      onUploaded?.(bill);
      setFile(null);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a bill</DialogTitle>
          <DialogDescription>
            A photo or PDF. We read it for you — then you check it before anything is recorded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">What kind of bill is it?</p>
            {/*
              IN and OUT, in large type, rather than "I received it" / "I issued
              it". Two first-person sentences that differ by one verb are read
              too quickly and picked wrongly; a single short word is not.

              The one-word outcome underneath - Purchase or Sale - says what the
              bill will actually become, which is the thing that matters.
            */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={direction === "IN"}
                onClick={() => setDirection("IN")}
                className={`flex flex-col items-center rounded-xl border-2 px-3 py-4 transition-colors ${
                  direction === "IN"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <ArrowDownLeft
                  className={`h-5 w-5 ${direction === "IN" ? "text-primary" : "text-muted-foreground"}`}
                  aria-hidden
                />
                <span className="mt-1.5 text-xl font-bold leading-none">IN</span>
                <span className="mt-1 text-sm font-medium">Purchase</span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  bill · stock comes in
                </span>
              </button>

              <button
                type="button"
                aria-pressed={direction === "OUT"}
                onClick={() => setDirection("OUT")}
                className={`flex flex-col items-center rounded-xl border-2 px-3 py-4 transition-colors ${
                  direction === "OUT"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <ArrowUpRight
                  className={`h-5 w-5 ${direction === "OUT" ? "text-primary" : "text-muted-foreground"}`}
                  aria-hidden
                />
                <span className="mt-1.5 text-xl font-bold leading-none">OUT</span>
                <span className="mt-1 text-sm font-medium">Sale</span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  bill · stock goes out
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">The bill</p>

            {/* capture="environment" asks for the REAR camera - the one pointing
                at the bill on the counter, not at the shopkeeper. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <input
              ref={fileRef}
              type="file"
              // HEIC/HEIF is how an iPhone saves photos; the backend accepts it,
              // and some browsers only match it by file extension.
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,application/pdf,.pdf"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />

            {file ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 transition-colors hover:bg-muted/50"
              >
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB · tap to choose another
                </span>
              </button>
            ) : (
              <div className="space-y-2">
                {/* Taking a photo is the common case at a counter, so it is the
                    bigger, filled button. */}
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80"
                >
                  <Camera className="h-5 w-5" aria-hidden />
                  Take a photo
                </button>

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-input text-sm font-medium transition-colors hover:bg-muted"
                >
                  <Upload className="h-4 w-4" aria-hidden />
                  Choose a file instead
                </button>

                <p className="text-center text-xs text-muted-foreground">
                  JPG, PNG, WEBP, HEIC or PDF · up to 10 MB
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mutation.isPending ? "Reading the bill…" : "Upload and read"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
