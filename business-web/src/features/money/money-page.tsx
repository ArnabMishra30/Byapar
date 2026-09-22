"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  moneyInApi,
  moneyOutApi,
  receivablesApi,
  payablesApi,
  ApiError,
} from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Can } from "@/components/shared/permission-gate";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatAmount, stripBodyPrefix } from "@/lib/utils";
import type { ListParams, ListResult } from "@/lib/api";
import type { Receivable, Payable } from "@/types/api";

/** What both payment APIs have in common, seen from this screen. */
interface MoneyApi {
  list: (p?: ListParams) => Promise<ListResult<Record<string, unknown>>>;
  create: (body: unknown) => Promise<Record<string, unknown>>;
  post: (id: string) => Promise<Record<string, unknown>>;
}

/**
 * Money received from customers, and money paid to suppliers.
 *
 * ALLOCATION IS THE POINT. A receipt is not just an amount - it says WHICH bills
 * it settles. Anything left over is an advance the party has with you, which the
 * backend records as credit rather than losing.
 *
 * The open bills are loaded once a party is chosen, and each row can be filled
 * in with a tap. Both sides work identically; only the words change.
 */

export type MoneyKind = "in" | "out";

const CONFIG = {
  in: {
    title: "Money received",
    description: "Payments customers have made to you.",
    addLabel: "Record money received",
    partyKind: "customer" as const,
    partyLabel: "Customer",
    partyField: "customerId",
    allocationIdField: "receivableId",
    capability: "money.receive" as const,
    api: moneyInApi as unknown as MoneyApi,
    openBills: (partyId: string) =>
      receivablesApi.list({ customerId: partyId, onlyOutstanding: "true", limit: 100 }) as unknown as Promise<
        ListResult<Receivable | Payable>
      >,
    billNumber: (row: Receivable) => row.salesInvoice?.invoiceNumber ?? "Opening balance",
    icon: ArrowDownLeft,
    emptyTitle: "No receipts yet",
    emptyDescription: "When a customer pays you, record it here so their balance goes down.",
    methods: [
      { value: "CASH", label: "Cash" },
      { value: "BANK", label: "Bank" },
      { value: "UPI", label: "UPI" },
      { value: "CHEQUE", label: "Cheque" },
      { value: "OTHER", label: "Other" },
    ],
  },
  out: {
    title: "Money paid",
    description: "Payments you have made to suppliers.",
    addLabel: "Record payment to supplier",
    partyKind: "supplier" as const,
    partyLabel: "Supplier",
    partyField: "supplierId",
    allocationIdField: "payableId",
    capability: "money.pay" as const,
    api: moneyOutApi as unknown as MoneyApi,
    openBills: (partyId: string) =>
      payablesApi.list({ supplierId: partyId, onlyOutstanding: "true", limit: 100 }) as unknown as Promise<
        ListResult<Receivable | Payable>
      >,
    billNumber: (row: Payable) => row.purchase?.purchaseNumber ?? "Opening balance",
    icon: ArrowUpRight,
    emptyTitle: "No payments yet",
    emptyDescription: "When you pay a supplier, record it here so what you owe goes down.",
    methods: [
      { value: "CASH", label: "Cash" },
      { value: "BANK_TRANSFER", label: "Bank transfer" },
      { value: "UPI", label: "UPI" },
      { value: "CHEQUE", label: "Cheque" },
      { value: "OTHER", label: "Other" },
    ],
  },
};

export function MoneyPage({ kind }: { kind: MoneyKind }) {
  const config = CONFIG[kind];
  const queryClient = useQueryClient();
  const list = useListState({ limit: 20 });
  const [addOpen, setAddOpen] = React.useState(false);
  const [postTarget, setPostTarget] = React.useState<Record<string, unknown> | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["money", kind, list.page],
    queryFn: () => config.api.list({ page: list.page, limit: list.limit }),
  });

  // --- the form -----------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const [partyId, setPartyId] = React.useState("");
  const [partyLabel, setPartyLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(today);
  const [method, setMethod] = React.useState(config.methods[0].value);
  const [reference, setReference] = React.useState("");
  const [allocations, setAllocations] = React.useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const openBills = useQuery({
    queryKey: ["open-bills", kind, partyId],
    queryFn: () => config.openBills(partyId),
    enabled: addOpen && Boolean(partyId),
  });

  const resetForm = () => {
    setPartyId("");
    setPartyLabel("");
    setAmount("");
    setPaymentDate(today);
    setMethod(config.methods[0].value);
    setReference("");
    setAllocations({});
    setFormErrors({});
  };

  const allocatedTotal = Object.values(allocations).reduce((total, value) => {
    const n = Number(value);
    return total + (Number.isFinite(n) ? n : 0);
  }, 0);

  const unallocated = Number(amount || 0) - allocatedTotal;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["money"] });
    queryClient.invalidateQueries({ queryKey: ["credit"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["open-bills"] });
  };

  const create = useMutation({
    mutationFn: () =>
      config.api.create({
        [config.partyField]: partyId,
        paymentDate,
        amount,
        paymentMethod: method,
        ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
        allocations: Object.entries(allocations)
          .filter(([, value]) => value && Number(value) > 0)
          .map(([billId, value]) => ({ [config.allocationIdField]: billId, amount: value })),
      }),
    onSuccess: () => {
      toast.success("Saved as a draft", { description: "Post it to update the balances." });
      setAddOpen(false);
      resetForm();
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setFormErrors(next);
        toast.error("Please check the form", { description: err.fieldErrors[0]?.message });
        return;
      }
      toast.error("Could not save", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const post = useMutation({
    mutationFn: (id: string) => config.api.post(id),
    onSuccess: () => {
      toast.success("Posted. Balances updated.");
      setPostTarget(null);
      invalidate();
    },
    onError: (err) => {
      setPostTarget(null);
      toast.error("Could not post", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!partyId) next.party = `Choose a ${config.partyLabel.toLowerCase()}`;
    if (!amount || Number(amount) <= 0) next.amount = "Enter an amount";
    if (allocatedTotal > Number(amount || 0)) {
      next.allocations = "You have allocated more than the amount received";
    }
    setFormErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  const columns: Column<Record<string, unknown>>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{String(row.paymentNumber)}</span> },
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(String(row.paymentDate))}</span>,
    },
    {
      header: config.partyLabel,
      cell: (row) => {
        const party = row[config.partyKind] as { name?: string } | undefined;
        return <span className="block max-w-[12rem] truncate">{party?.name ?? "—"}</span>;
      },
    },
    { header: "Amount", numeric: true, cell: (row) => <Money value={String(row.amount)} /> },
    {
      header: "Not allocated",
      numeric: true,
      hideOnMobile: true,
      cell: (row) =>
        row.unallocatedAmount === "0.00" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money value={String(row.unallocatedAmount)} />
        ),
    },
    { header: "Status", cell: (row) => <StatusBadge status={String(row.status)} /> },
    {
      header: "",
      cell: (row) =>
        row.status === "DRAFT" ? (
          <Can do={config.capability}>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => setPostTarget(row)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Post
            </Button>
          </Can>
        ) : null,
    },
  ];

  const bills = (openBills.data?.items ?? []) as (Receivable | Payable)[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <Can do={config.capability}>
            <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              {config.addLabel}
            </Button>
          </Can>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {(row[config.partyKind] as { name?: string } | undefined)?.name ?? "—"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(String(row.paymentDate))} · {String(row.paymentNumber)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Money value={String(row.amount)} className="text-sm font-semibold" />
              <StatusBadge status={String(row.status)} />
            </div>
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
        emptyTitle={config.emptyTitle}
        emptyDescription={config.emptyDescription}
        emptyAction={
          <Can do={config.capability}>
            <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              {config.addLabel}
            </Button>
          </Can>
        }
      />

      <Dialog open={addOpen} onOpenChange={(open) => (create.isPending ? null : setAddOpen(open))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{config.addLabel}</DialogTitle>
            <DialogDescription>
              Tick off the bills this settles. Anything left over stays as credit.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="space-y-4"
            noValidate
          >
            <FormSection>
              <Field label={config.partyLabel} required error={formErrors.party}>
                <EntitySelect
                  kind={config.partyKind}
                  value={partyId}
                  valueLabel={partyLabel}
                  invalid={Boolean(formErrors.party)}
                  onChange={(id, label) => {
                    setPartyId(id);
                    setPartyLabel(label);
                    setAllocations({});
                  }}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount" htmlFor="money-amount" required error={formErrors.amount}>
                  <Input
                    id="money-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                <Field label="Date" htmlFor="money-date" required error={formErrors.paymentDate}>
                  <Input
                    id="money-date"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How" htmlFor="money-method" required>
                  <select
                    id="money-method"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    {config.methods.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference" htmlFor="money-ref" hint="Cheque or UPI number">
                  <Input
                    id="money-ref"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </div>
            </FormSection>

            {partyId ? (
              <FormSection title="Which bills does this settle?">
                {openBills.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading open bills…</p>
                ) : bills.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    Nothing outstanding. The whole amount will be kept as credit for them.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bills.map((bill) => (
                      <div key={bill.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {kind === "in"
                              ? CONFIG.in.billNumber(bill as Receivable)
                              : CONFIG.out.billNumber(bill as Payable)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {bill.dueDate ? `Due ${formatDate(bill.dueDate)} · ` : ""}
                            <Money value={bill.outstandingAmount} /> left
                          </p>
                        </div>
                        <Input
                          inputMode="decimal"
                          placeholder="0"
                          className="h-9 w-24 text-right"
                          value={allocations[bill.id] ?? ""}
                          onChange={(e) =>
                            setAllocations((prev) => ({ ...prev, [bill.id]: e.target.value }))
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 px-2 text-xs"
                          onClick={() =>
                            setAllocations((prev) => ({
                              ...prev,
                              [bill.id]: bill.outstandingAmount,
                            }))
                          }
                        >
                          All
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {formErrors.allocations ? (
                  <p className="text-xs text-destructive">{formErrors.allocations}</p>
                ) : null}

                <div className="flex justify-between rounded-lg bg-muted/40 p-3 text-sm">
                  <span className="text-muted-foreground">Left over (kept as credit)</span>
                  <span className={unallocated < 0 ? "font-bold text-destructive" : "font-bold"}>
                    ₹{formatAmount(unallocated)}
                  </span>
                </div>
              </FormSection>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={postTarget !== null}
        onOpenChange={(open) => (open ? null : setPostTarget(null))}
        title="Post this to the books?"
        confirmLabel="Post"
        isPending={post.isPending}
        onConfirm={() => postTarget && post.mutate(String(postTarget.id))}
        description={
          kind === "in"
            ? "The money will go into your cash or bank, and the customer's balance will come down. This cannot be undone."
            : "The money will go out of your cash or bank, and what you owe the supplier will come down. This cannot be undone."
        }
      />
    </div>
  );
}
