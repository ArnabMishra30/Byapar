"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  customersApi,
  dueListsApi,
  moneyInApi,
  moneyOutApi,
  suppliersApi,
  type ListParams,
  type ListResult,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { StatusBadge } from "@/components/shared/status-badge";
import { EntitySelect } from "@/components/shared/entity-select";
import { DetailRow, Field, FormSection } from "@/components/shared/form-parts";
import { Can } from "@/components/shared/permission-gate";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DETAIL_ROUTES } from "@/lib/constants";
import { cn, formatDate, stripBodyPrefix, toInputDate } from "@/lib/utils";
import { OverdueBadge } from "@/features/parties/party-tabs";
import { isAmount, isMore, leftToAssign } from "./form-helper";
import { MoneyTabs } from "./money-tabs";
import type { CustomerPayment, Payable, Receivable } from "@/types/api";

/**
 * Money received from customers, and money paid to suppliers.
 *
 * ALLOCATION IS THE POINT. A receipt is not just an amount - it says WHICH
 * bills it settles. Whatever is not assigned to a bill is an advance, which the
 * backend keeps as credit for that party. After saving, the page shows the
 * backend's own allocated / advance split, not the form's.
 *
 * Both sides work identically; only the words, the payment methods and the
 * name of the bill key change.
 */

export type MoneyKind = "in" | "out";

type Payment = CustomerPayment & { supplier?: { id: string; name: string }; notes?: string | null };
type OpenBill = Receivable & Payable;

interface MoneyApi {
  list: (p?: ListParams) => Promise<ListResult<Payment>>;
  get: (id: string) => Promise<Payment>;
  create: (body: unknown) => Promise<Payment>;
  post: (id: string) => Promise<Payment>;
  cancel: (id: string) => Promise<Payment>;
}

const CONFIG = {
  in: {
    title: "Money Received",
    description: "Payments customers have made to you.",
    addLabel: "Record money received",
    shortAdd: "Receive",
    partyKind: "customer" as const,
    partyLabel: "Customer",
    partyParam: "customerId",
    billKey: "receivableId",
    capability: "money.receive" as const,
    api: moneyInApi as unknown as MoneyApi,
    getParty: (id: string) => customersApi.get(id),
    openBills: (id: string) =>
      dueListsApi.receivables<OpenBill>({ customerId: id, onlyOutstanding: true, limit: 100 }),
    billNumber: (bill: OpenBill) => bill.salesInvoice?.invoiceNumber ?? "Opening balance",
    billHref: (bill: OpenBill) => (bill.salesInvoice ? DETAIL_ROUTES.sale(bill.salesInvoice.id) : null),
    partyHref: (id: string) => DETAIL_ROUTES.customer(id),
    paidWord: "Received",
    dueWord: "Pending",
    emptyTitle: "No money received yet",
    emptyDescription: "When a customer pays you, record it here so their balance comes down.",
    methods: [
      { value: "CASH", label: "Cash" },
      { value: "UPI", label: "UPI" },
      { value: "BANK", label: "Bank" },
      { value: "CHEQUE", label: "Cheque" },
      { value: "OTHER", label: "Other" },
    ],
  },
  out: {
    title: "Money Paid",
    description: "Payments you have made to suppliers.",
    addLabel: "Record payment to supplier",
    shortAdd: "Pay",
    partyKind: "supplier" as const,
    partyLabel: "Supplier",
    partyParam: "supplierId",
    billKey: "payableId",
    capability: "money.pay" as const,
    api: moneyOutApi as unknown as MoneyApi,
    getParty: (id: string) => suppliersApi.get(id),
    openBills: (id: string) =>
      dueListsApi.payables<OpenBill>({ supplierId: id, onlyOutstanding: true, limit: 100 }),
    billNumber: (bill: OpenBill) => bill.purchase?.purchaseNumber ?? "Opening balance",
    billHref: (bill: OpenBill) => (bill.purchase ? DETAIL_ROUTES.purchase(bill.purchase.id) : null),
    partyHref: (id: string) => DETAIL_ROUTES.supplier(id),
    paidWord: "Paid",
    dueWord: "To pay",
    emptyTitle: "No payments yet",
    emptyDescription: "When you pay a supplier, record it here so what you owe comes down.",
    methods: [
      { value: "CASH", label: "Cash" },
      { value: "UPI", label: "UPI" },
      { value: "BANK_TRANSFER", label: "Bank transfer" },
      { value: "CHEQUE", label: "Cheque" },
      { value: "OTHER", label: "Other" },
    ],
  },
};

const methodLabel = (kind: MoneyKind, value: string) =>
  CONFIG[kind].methods.find((method) => method.value === value)?.label ?? value;

const partyOf = (kind: MoneyKind, row: Payment) => (kind === "in" ? row.customer : row.supplier);

export function MoneyPage({ kind }: { kind: MoneyKind }) {
  const config = CONFIG[kind];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const list = useListState({ limit: 20 });

  // --- list filters -------------------------------------------------------
  const [range, setRange] = React.useState<DateRangeValue>({});
  const [filterParty, setFilterParty] = React.useState<{ id: string; label: string } | null>(null);
  const [method, setMethod] = React.useState("");
  const [status, setStatus] = React.useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["money", kind, list.page, range.fromDate, range.toDate, filterParty?.id, method, status],
    queryFn: () =>
      config.api.list({
        page: list.page,
        limit: list.limit,
        fromDate: range.fromDate,
        toDate: range.toDate,
        [config.partyParam]: filterParty?.id,
        paymentMethod: method || undefined,
        status: status || undefined,
      }),
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<{ id: string; label: string } | null>(null);
  const [action, setAction] = React.useState<{ type: "post" | "cancel"; row: Payment } | null>(null);
  const [viewId, setViewId] = React.useState<string | null>(null);

  // ?customerId= / ?supplierId= opens the form with that party chosen.
  const prefillId = searchParams?.get(config.partyParam) ?? null;
  React.useEffect(() => {
    if (!prefillId || !can(config.capability)) return;
    let cancelled = false;
    config
      .getParty(prefillId)
      .then((party) => {
        if (cancelled) return;
        setPrefill({ id: party.id, label: party.name });
        setFormOpen(true);
      })
      .catch(() => {
        if (!cancelled) toast.error(`That ${config.partyLabel.toLowerCase()} could not be found`);
      });
    return () => {
      cancelled = true;
    };
    // Runs when the query string changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillId, kind]);

  const closeForm = () => {
    setFormOpen(false);
    setPrefill(null);
    if (prefillId) router.replace(pathname ?? "");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["money"] });
    queryClient.invalidateQueries({ queryKey: ["credit"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: [config.partyKind] });
    queryClient.invalidateQueries({ queryKey: ["cash-bank"] });
  };

  const runAction = useMutation({
    mutationFn: ({ type, row }: { type: "post" | "cancel"; row: Payment }) =>
      type === "post" ? config.api.post(row.id) : config.api.cancel(row.id),
    onSuccess: (_saved, variables) => {
      toast.success(variables.type === "post" ? "Posted. Balances updated." : "Draft cancelled");
      setAction(null);
      invalidate();
    },
    onError: (err) => {
      setAction(null);
      toast.error("Could not do that", { description: err instanceof ApiError ? err.message : undefined });
    },
  });

  const rowActions = (row: Payment) =>
    row.status === "DRAFT" ? (
      <Can do={config.capability}>
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <Button size="sm" variant="outline" className="h-9 gap-1 px-2 text-xs" onClick={() => setAction({ type: "post", row })}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Post
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 px-2 text-xs text-destructive"
            onClick={() => setAction({ type: "cancel", row })}
            aria-label="Cancel draft"
          >
            <Ban className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Can>
    ) : null;

  const columns: Column<Payment>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.paymentNumber}</span> },
    { header: "Date", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.paymentDate)}</span> },
    {
      header: config.partyLabel,
      cell: (row) => <span className="block max-w-[12rem] truncate">{partyOf(kind, row)?.name ?? "—"}</span>,
    },
    { header: "How", hideOnMobile: true, cell: (row) => methodLabel(kind, row.paymentMethod) },
    { header: "Amount", numeric: true, cell: (row) => <Money value={row.amount} className="font-semibold" /> },
    {
      header: "Kept as advance",
      numeric: true,
      hideOnMobile: true,
      cell: (row) =>
        Number(row.unallocatedAmount) === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money value={row.unallocatedAmount} />
        ),
    },
    { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
    { header: "", cell: rowActions },
  ];

  const addButton = (full = false) => (
    <Button className="gap-1.5" onClick={() => setFormOpen(true)} aria-label={config.addLabel}>
      <Plus className="h-4 w-4" />
      <span className={full ? "" : "hidden sm:inline"}>{config.addLabel}</span>
      {full ? null : <span className="sm:hidden">{config.shortAdd}</span>}
    </Button>
  );

  const filtersActive = Boolean(range.fromDate || range.toDate || filterParty || method || status);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          title={config.title}
          description={config.description}
          actions={<Can do={config.capability}>{addButton()}</Can>}
        />
        <MoneyTabs />
      </div>

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        onRowClick={(row) => setViewId(row.id)}
        filters={
          <div className="w-full space-y-2">
            <DateRangeFilter
              value={range}
              onChange={(next) => {
                setRange(next);
                list.setPage(1);
              }}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="flex min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1">
                  <EntitySelect
                    kind={config.partyKind}
                    value={filterParty?.id}
                    valueLabel={filterParty?.label}
                    placeholder={`Any ${config.partyLabel.toLowerCase()}`}
                    onChange={(id, label) => {
                      setFilterParty({ id, label });
                      list.setPage(1);
                    }}
                  />
                </div>
                {filterParty ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={`Clear ${config.partyLabel.toLowerCase()}`}
                    onClick={() => {
                      setFilterParty(null);
                      list.setPage(1);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <NativeSelect
                aria-label="Payment method"
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value);
                  list.setPage(1);
                }}
              >
                <option value="">Any method</option>
                {config.methods.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  list.setPage(1);
                }}
              >
                <option value="">Any status</option>
                <option value="DRAFT">Draft</option>
                <option value="POSTED">Posted</option>
                <option value="CANCELLED">Cancelled</option>
              </NativeSelect>
            </div>
          </div>
        }
        mobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{partyOf(kind, row)?.name ?? "—"}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatDate(row.paymentDate)} · {row.paymentNumber} · {methodLabel(kind, row.paymentMethod)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money value={row.amount} className="text-sm font-semibold" />
                <StatusBadge status={row.status} />
              </div>
            </div>
            {rowActions(row)}
          </div>
        )}
        pagination={
          data?.pagination
            ? {
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
                total: data.pagination.total,
                onPageChange: list.setPage,
              }
            : undefined
        }
        emptyTitle={filtersActive ? "Nothing matches these filters" : config.emptyTitle}
        emptyDescription={filtersActive ? "Try a wider date range or clear a filter." : config.emptyDescription}
        emptyAction={filtersActive ? undefined : <Can do={config.capability}>{addButton(true)}</Can>}
      />

      {formOpen ? (
        <PaymentForm
          kind={kind}
          initialParty={prefill}
          onClose={closeForm}
          onSaved={invalidate}
          onPost={(row) => setAction({ type: "post", row })}
        />
      ) : null}

      <PaymentView kind={kind} id={viewId} onClose={() => setViewId(null)} />

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => (open ? null : setAction(null))}
        title={action?.type === "post" ? "Post this to the books?" : "Cancel this draft?"}
        confirmLabel={action?.type === "post" ? "Post" : "Cancel draft"}
        destructive={action?.type === "cancel"}
        isPending={runAction.isPending}
        onConfirm={() => action && runAction.mutate(action)}
        description={
          action?.type === "cancel"
            ? "The draft is abandoned. It was never posted, so no balance changes."
            : kind === "in"
              ? "The money goes into your cash or bank, and the customer's balance comes down. A posted receipt cannot be edited."
              : "The money goes out of your cash or bank, and what you owe the supplier comes down. A posted payment cannot be edited."
        }
      />
    </div>
  );
}

// --- the form -------------------------------------------------------------------

function PaymentForm({
  kind,
  initialParty,
  onClose,
  onSaved,
  onPost,
}: {
  kind: MoneyKind;
  initialParty: { id: string; label: string } | null;
  onClose: () => void;
  onSaved: () => void;
  onPost: (row: Payment) => void;
}) {
  const config = CONFIG[kind];
  const [partyId, setPartyId] = React.useState(initialParty?.id ?? "");
  const [partyLabel, setPartyLabel] = React.useState(initialParty?.label ?? "");
  const [amount, setAmount] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(toInputDate());
  const [method, setMethod] = React.useState(config.methods[0].value);
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [allocations, setAllocations] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState<Payment | null>(null);

  const bills = useQuery({
    queryKey: ["money", "open-bills", kind, partyId],
    queryFn: () => config.openBills(partyId),
    enabled: Boolean(partyId),
  });
  const openBills = bills.data?.items ?? [];

  const typed = Object.values(allocations).filter((value) => value.trim() !== "");
  const left = leftToAssign(amount, typed);
  const overAssigned = left.startsWith("-");

  const create = useMutation({
    mutationFn: () =>
      config.api.create({
        [config.partyParam]: partyId,
        paymentDate,
        amount: amount.trim(),
        paymentMethod: method,
        ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        allocations: Object.entries(allocations)
          .filter(([, value]) => isAmount(value) && Number(value) > 0)
          .map(([billId, value]) => ({ [config.billKey]: billId, amount: value.trim() })),
      }),
    onSuccess: (payment) => {
      setSaved(payment);
      onSaved();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) {
          const field = stripBodyPrefix(item.field);
          next[field.startsWith("allocations") ? "allocations" : field] = item.message;
        }
        setErrors(next);
        toast.error("Please check the form", { description: err.fieldErrors[0]?.message });
        return;
      }
      toast.error("Could not save", { description: err instanceof ApiError ? err.message : undefined });
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!partyId) next.party = `Choose a ${config.partyLabel.toLowerCase()}`;
    if (!isAmount(amount) || Number(amount) <= 0) next.amount = "Enter an amount, like 500 or 500.50";
    if (!paymentDate) next.paymentDate = "Pick a date";
    const badBill = Object.entries(allocations).find(([, value]) => value.trim() !== "" && !isAmount(value));
    if (badBill) next.allocations = "Amounts against bills must be numbers, like 500 or 500.50";
    else if (overAssigned) next.allocations = "You have put more against bills than the amount itself";
    else {
      const tooMuch = openBills.find((bill) => allocations[bill.id] && isMore(allocations[bill.id], bill.outstandingAmount));
      if (tooMuch) next.allocations = `More than is due on ${config.billNumber(tooMuch)}`;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => (open || create.isPending ? null : onClose())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle>Saved as a draft</DialogTitle>
              <DialogDescription>Post it to update the balances and your cash or bank.</DialogDescription>
            </DialogHeader>
            {/* The backend's own split, not the form's. */}
            <div className="space-y-1 rounded-lg border p-3">
              <DetailRow label="Number">{saved.paymentNumber}</DetailRow>
              <DetailRow label={config.partyLabel}>{partyOf(kind, saved)?.name ?? partyLabel}</DetailRow>
              <DetailRow label="Amount">
                <Money value={saved.amount} />
              </DetailRow>
              <DetailRow label="Against bills">
                <Money value={saved.allocatedAmount} />
              </DetailRow>
              <DetailRow label="Kept as advance">
                <Money value={saved.unallocatedAmount} />
              </DetailRow>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              <Can do={config.capability}>
                <Button
                  className="gap-1.5"
                  onClick={() => {
                    onPost(saved);
                    onClose();
                  }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Post now
                </Button>
              </Can>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{config.addLabel}</DialogTitle>
              <DialogDescription>
                Put the amount against the bills it pays. Anything not put against a bill is kept as an advance.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
              className="space-y-5"
              noValidate
            >
              <FormSection>
                <Field label={config.partyLabel} required error={errors.party ?? errors[config.partyParam]}>
                  <EntitySelect
                    kind={config.partyKind}
                    value={partyId}
                    valueLabel={partyLabel}
                    invalid={Boolean(errors.party)}
                    onChange={(id, label) => {
                      setPartyId(id);
                      setPartyLabel(label);
                      setAllocations({});
                    }}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Amount" htmlFor="money-amount" required error={errors.amount}>
                    <Input
                      id="money-amount"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </Field>
                  <Field label="Date" htmlFor="money-date" required error={errors.paymentDate}>
                    <Input
                      id="money-date"
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                    />
                  </Field>
                  <Field label="How" htmlFor="money-method" required error={errors.paymentMethod}>
                    <NativeSelect id="money-method" value={method} onChange={(event) => setMethod(event.target.value)}>
                      {config.methods.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Reference" htmlFor="money-ref" hint="Cheque or UPI number" error={errors.referenceNumber}>
                    <Input id="money-ref" value={reference} onChange={(event) => setReference(event.target.value)} />
                  </Field>
                </div>
                <Field label="Note" htmlFor="money-notes" hint="Optional" error={errors.notes}>
                  <Textarea
                    id="money-notes"
                    rows={2}
                    className="min-h-[56px]"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </Field>
              </FormSection>

              {partyId ? (
                <FormSection title="Which bills does this pay?">
                  {bills.isLoading ? (
                    <LoadingState rows={2} />
                  ) : bills.error ? (
                    <ErrorState error={bills.error} onRetry={() => bills.refetch()} />
                  ) : openBills.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Nothing is pending for {partyLabel || `this ${config.partyLabel.toLowerCase()}`}. The whole
                      amount will be kept as an advance.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {openBills.map((bill) => {
                        const href = config.billHref(bill);
                        return (
                          <li key={bill.id} className="space-y-2 rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                {href ? (
                                  <Link href={href} target="_blank" className="truncate text-sm font-medium hover:text-primary">
                                    {config.billNumber(bill)}
                                  </Link>
                                ) : (
                                  <p className="truncate text-sm font-medium">{config.billNumber(bill)}</p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  Due {bill.dueDate ? formatDate(bill.dueDate) : "—"}
                                </p>
                              </div>
                              <OverdueBadge dueDate={bill.dueDate} />
                            </div>
                            <PaidDue total={bill.originalAmount} paid={bill.paidAmount} due={bill.outstandingAmount} />
                            <div className="flex items-end gap-2">
                              <div className="min-w-0 flex-1 space-y-1">
                                <label htmlFor={`pay-${bill.id}`} className="text-xs font-medium">
                                  Paying now
                                </label>
                                <Input
                                  id={`pay-${bill.id}`}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="text-right"
                                  value={allocations[bill.id] ?? ""}
                                  onChange={(event) =>
                                    setAllocations((prev) => ({ ...prev, [bill.id]: event.target.value }))
                                  }
                                />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-10 shrink-0 px-3 text-xs"
                                onClick={() =>
                                  setAllocations((prev) => ({ ...prev, [bill.id]: bill.outstandingAmount }))
                                }
                              >
                                Full {config.dueWord.toLowerCase()}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {errors.allocations ? <p className="text-xs text-destructive">{errors.allocations}</p> : null}

                  {isAmount(amount) ? (
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm",
                        overAssigned && "bg-destructive/10",
                      )}
                    >
                      <span className="text-muted-foreground">
                        Not yet put against a bill
                        <span className="block text-[11px]">Form helper. Saved as advance.</span>
                      </span>
                      <Money value={left} className={cn("font-bold", overAssigned && "text-destructive")} />
                    </div>
                  ) : null}
                </FormSection>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save draft
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- one payment ------------------------------------------------------------------

function PaymentView({ kind, id, onClose }: { kind: MoneyKind; id: string | null; onClose: () => void }) {
  const config = CONFIG[kind];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["money", kind, "one", id],
    queryFn: () => config.api.get(id!),
    enabled: Boolean(id),
  });
  const party = data ? partyOf(kind, data) : undefined;

  return (
    <Dialog open={Boolean(id)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.paymentNumber ?? "Payment"}</DialogTitle>
          <DialogDescription>{data ? formatDate(data.paymentDate) : null}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <LoadingState rows={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data ? (
          <div className="space-y-4">
            <div>
              <DetailRow label={config.partyLabel}>
                {party ? (
                  <Link href={config.partyHref(party.id)} className="hover:text-primary">
                    {party.name}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Status">
                <StatusBadge status={data.status} />
              </DetailRow>
              <DetailRow label="How">{methodLabel(kind, data.paymentMethod)}</DetailRow>
              {data.referenceNumber ? <DetailRow label="Reference">{data.referenceNumber}</DetailRow> : null}
              <DetailRow label="Amount">
                <Money value={data.amount} />
              </DetailRow>
              <DetailRow label="Against bills">
                <Money value={data.allocatedAmount} />
              </DetailRow>
              <DetailRow label="Kept as advance">
                <Money value={data.unallocatedAmount} />
              </DetailRow>
              {data.notes ? <DetailRow label="Note">{data.notes}</DetailRow> : null}
            </div>
            {data.allocations?.length ? (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Bills paid</p>
                <ul className="divide-y rounded-lg border text-sm">
                  {data.allocations.map((allocation) => {
                    const doc = kind === "in" ? allocation.salesInvoice : allocation.purchase;
                    const label =
                      kind === "in"
                        ? allocation.salesInvoice?.invoiceNumber
                        : allocation.purchase?.purchaseNumber;
                    const href = doc
                      ? kind === "in"
                        ? DETAIL_ROUTES.sale(doc.id)
                        : DETAIL_ROUTES.purchase(doc.id)
                      : null;
                    return (
                      <li key={allocation.id} className="flex items-center justify-between gap-2 p-2.5">
                        {href ? (
                          <Link href={href} className="truncate hover:text-primary">
                            {label}
                          </Link>
                        ) : (
                          <span className="truncate">{label ?? "Opening balance"}</span>
                        )}
                        <Money value={allocation.amount} className="shrink-0 font-medium" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
