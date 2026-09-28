"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Loader2, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "@/components/shared/states";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, toInputDate } from "@/lib/utils";
import { RETURN_CONFIG, type ReturnConfig, type ReturnKind, type SourceOption } from "./config";
import {
  buildReturnReason,
  checkReturnQuantity,
  formatQuantity,
  hasRemaining,
} from "./helpers";

const REASONS = ["Damaged", "Wrong item", "Customer changed mind", "Expired", "Other"];
const PURCHASE_REASONS = ["Damaged", "Wrong item", "Expired", "Excess quantity", "Other"];

/**
 * A new sales or purchase return, in two steps:
 *
 *   1. Pick the completed invoice / bill the goods came on (or arrive with it
 *      preselected from ?salesInvoiceId= / ?purchaseId=).
 *   2. Say how much of each line is coming back.
 *
 * The backend decides what can still be returned (it subtracts earlier
 * COMPLETED returns) and prices the return itself. This screen only stops
 * obvious typos, then saves a DRAFT; the totals are shown on the next page,
 * straight from the backend.
 */
export function ReturnForm({ kind }: { kind: ReturnKind }) {
  const config = RETURN_CONFIG[kind];
  const params = useSearchParams();
  const { can } = useAuth();
  const [sourceId, setSourceId] = React.useState<string | null>(params?.get(config.sourceParam) ?? null);

  if (!can(config.draftCapability)) {
    return <ForbiddenState />;
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
        <Link href={config.listHref}>
          <ArrowLeft className="h-4 w-4" />
          {config.listTitle}
        </Link>
      </Button>
      <PageHeader
        title={kind === "sale" ? "New sales return" : "New purchase return"}
        description={config.emptyDescription}
      />
      {sourceId ? (
        <ReturnLinesStep config={config} sourceId={sourceId} onChangeSource={() => setSourceId(null)} />
      ) : (
        <SourcePicker config={config} onPick={setSourceId} />
      )}
    </div>
  );
}

/** Step 1: find the completed invoice or bill. */
function SourcePicker({ config, onPick }: { config: ReturnConfig; onPick: (id: string) => void }) {
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [config.queryKey, "sources", debounced],
    queryFn: () => config.api.searchSources(debounced),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{config.sourcePickTitle}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Only completed {config.kind === "sale" ? "invoices" : "purchase bills"} can have a return.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              config.kind === "sale" ? "Search invoice no. or customer" : "Search bill no. or supplier"
            }
            aria-label="Search"
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <LoadingState rows={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={debounced ? "Nothing matches that search" : "No completed documents yet"}
            description={
              config.kind === "sale"
                ? "A return can only be made against a completed sales invoice."
                : "A return can only be made against a completed purchase bill."
            }
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.map((option: SourceOption) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => onPick(option.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {option.number}
                      {option.secondaryNumber ? ` · ${option.secondaryNumber}` : ""}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.partyName || "—"} · {formatDate(option.date)}
                    </span>
                  </span>
                  <Money value={option.grandTotal} className="shrink-0 text-sm font-semibold" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Step 2: quantities per line, reason, date, notes. */
function ReturnLinesStep({
  config,
  sourceId,
  onChangeSource,
}: {
  config: ReturnConfig;
  sourceId: string;
  onChangeSource: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [reasonChoice, setReasonChoice] = React.useState("");
  const [reasonDetail, setReasonDetail] = React.useState("");
  const [returnDate, setReturnDate] = React.useState(toInputDate());
  const [notes, setNotes] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  const { data: source, isLoading, error, refetch } = useQuery({
    queryKey: [config.queryKey, "returnable", sourceId],
    queryFn: () => config.api.returnable(sourceId),
  });

  const create = useMutation({
    mutationFn: (input: { items: { itemId: string; quantity: string }[] }) =>
      config.api.create(
        sourceId,
        {
          returnDate,
          reason: buildReturnReason(reasonChoice, reasonDetail),
          notes: notes.trim() || undefined,
        },
        input.items,
      ),
    onSuccess: (doc) => {
      toast.success("Return saved as a draft");
      queryClient.invalidateQueries({ queryKey: [config.queryKey] });
      router.push(config.detailHref(doc.id));
    },
    onError: (err) => {
      const description =
        err instanceof ApiError
          ? err.fieldErrors?.length
            ? err.fieldErrors.map((f) => f.message).join(" ")
            : err.message
          : undefined;
      toast.error("Could not save the return", { description });
    },
  });

  if (isLoading) return <LoadingState rows={4} />;
  if (error || !source) return <ErrorState error={error} onRetry={() => refetch()} />;

  const isCompleted = source.sourceStatus === "POSTED";
  const returnableLines = source.lines.filter((line) => hasRemaining(line.remainingQuantity));
  const checks = Object.fromEntries(
    source.lines.map((line) => [
      line.itemId,
      checkReturnQuantity(quantities[line.itemId] ?? "", line.remainingQuantity),
    ]),
  );
  const chosen = source.lines.flatMap((line) => {
    const check = checks[line.itemId];
    return check.ok && !check.skip ? [{ itemId: line.itemId, quantity: check.quantity }] : [];
  });
  const hasErrors = Object.values(checks).some((check) => !check.ok);
  const reasons = config.kind === "sale" ? REASONS : PURCHASE_REASONS;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors) {
      toast.error("Fix the highlighted quantities");
      return;
    }
    if (chosen.length === 0) {
      toast.error("Enter a quantity for at least one item");
      return;
    }
    if (!returnDate) {
      toast.error("Choose the return date");
      return;
    }
    create.mutate({ items: chosen });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{config.sourceLabel}</p>
            <Link
              href={config.sourceHref(source.sourceId)}
              className="block truncate font-semibold hover:text-primary"
            >
              {source.sourceNumber}
            </Link>
            <p className="truncate text-sm text-muted-foreground">
              {config.partyLabel}: {source.partyName || "—"}
              {source.warehouseName ? ` · ${source.warehouseName}` : ""}
            </p>
          </div>
          <Button type="button" variant="outline" className="min-h-[44px] sm:min-h-0" onClick={onChangeSource}>
            Choose another
          </Button>
        </CardContent>
      </Card>

      {!isCompleted ? (
        <EmptyState
          icon={Undo2}
          title="This document is not completed"
          description="Only a completed invoice or bill can have a return. A draft can simply be edited or cancelled."
        />
      ) : returnableLines.length === 0 ? (
        <EmptyState
          icon={Undo2}
          title="Everything on this document has already been returned"
          description="There is nothing left to return from it."
        />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What is coming back?</CardTitle>
              <p className="text-xs text-muted-foreground">
                Enter the quantity for each item being returned. Leave the others empty. Returns
                still in draft are not counted in &quot;Already returned&quot;.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {source.lines.map((line) => {
                  const check = checks[line.itemId];
                  const disabled = !hasRemaining(line.remainingQuantity);
                  const inputId = `qty-${line.itemId}`;
                  const showError = !check.ok && (submitted || (quantities[line.itemId] ?? "") !== "");
                  return (
                    <li
                      key={line.itemId}
                      className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-start"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{line.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.sku ? `${line.sku} · ` : ""}
                          {config.unitPriceLabel} <Money value={line.unitPrice} />
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {config.originalQtyLabel} {formatQuantity(line.originalQuantity)} · Already returned{" "}
                          {formatQuantity(line.returnedQuantity)} ·{" "}
                          <span className="font-medium text-foreground">
                            Can return {formatQuantity(line.remainingQuantity)}
                          </span>
                        </p>
                      </div>
                      <div className="space-y-1 sm:w-44">
                        <label htmlFor={inputId} className="sr-only">
                          Return quantity for {line.productName}
                        </label>
                        <div className="flex gap-2">
                          <Input
                            id={inputId}
                            inputMode="decimal"
                            placeholder="0"
                            disabled={disabled}
                            value={quantities[line.itemId] ?? ""}
                            aria-invalid={showError}
                            className={showError ? "border-destructive" : undefined}
                            onChange={(e) =>
                              setQuantities((prev) => ({ ...prev, [line.itemId]: e.target.value }))
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={disabled}
                            className="min-h-[44px] shrink-0 sm:min-h-0"
                            onClick={() =>
                              setQuantities((prev) => ({
                                ...prev,
                                [line.itemId]: formatQuantity(line.remainingQuantity),
                              }))
                            }
                          >
                            All
                          </Button>
                        </div>
                        {showError && !check.ok ? (
                          <p className="text-xs text-destructive">{check.error}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <FormSection title="Details">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Reason" htmlFor="return-reason">
                    <NativeSelect
                      id="return-reason"
                      value={reasonChoice}
                      onChange={(e) => setReasonChoice(e.target.value)}
                    >
                      <option value="">Choose a reason (optional)</option>
                      {reasons.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Return date" htmlFor="return-date" required>
                    <Input
                      id="return-date"
                      type="date"
                      value={returnDate}
                      max={toInputDate()}
                      onChange={(e) => setReturnDate(e.target.value)}
                    />
                  </Field>
                  <Field
                    label={reasonChoice === "Other" ? "Describe the reason" : "More about the reason"}
                    htmlFor="return-reason-detail"
                    className="sm:col-span-2"
                  >
                    <Input
                      id="return-reason-detail"
                      maxLength={150}
                      value={reasonDetail}
                      onChange={(e) => setReasonDetail(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                  <Field label="Notes" htmlFor="return-notes" className="sm:col-span-2">
                    <Textarea
                      id="return-notes"
                      maxLength={1000}
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>
              </FormSection>
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild type="button" variant="outline" className="min-h-[44px] sm:min-h-0">
              <Link href={config.listHref}>Cancel</Link>
            </Button>
            <Button type="submit" className="min-h-[44px] gap-1.5 sm:min-h-0" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save draft ({chosen.length} item{chosen.length === 1 ? "" : "s"})
            </Button>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            The return amount is worked out by the system from the original prices and tax once you save.
          </p>
        </>
      )}
    </form>
  );
}
