"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Loader2, Plus, RotateCcw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { expensesApi, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Can } from "@/components/shared/permission-gate";
import { Field, FormSection } from "@/components/shared/form-parts";
import { EntitySelect } from "@/components/shared/entity-select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, stripBodyPrefix } from "@/lib/utils";
import type { Expense } from "@/types/api";

/**
 * Expenses: rent, electricity, salaries, tea for the shop.
 *
 * Same lifecycle as every other document — draft, then post — plus one extra
 * action: a POSTED expense can be REVERSED. It has no "return" document, so
 * without reversal a mistyped rent payment would be wrong forever.
 *
 * There is no GST anywhere on this screen, for either kind of business. The
 * backend records no tax on an expense at all.
 */
export function ExpensesPage() {
  const queryClient = useQueryClient();
  const list = useListState({ limit: 20 });
  const [range, setRange] = React.useState<DateRangeValue>({});
  const [status, setStatus] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [action, setAction] = React.useState<{ type: "post" | "cancel" | "reverse"; row: Expense } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["expenses", list.page, range.fromDate, range.toDate, status],
    queryFn: () =>
      expensesApi.list({
        page: list.page,
        limit: list.limit,
        fromDate: range.fromDate,
        toDate: range.toDate,
        status: status || undefined,
      }),
  });

  const categories = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => expensesApi.categories(),
    enabled: addOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // --- the add form -------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = React.useState({
    expenseDate: today,
    expenseAccountId: "",
    amount: "",
    paymentMode: "CASH",
    description: "",
    supplierId: "",
    supplierLabel: "",
  });
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const resetForm = () =>
    setForm({
      expenseDate: today,
      expenseAccountId: "",
      amount: "",
      paymentMode: "CASH",
      description: "",
      supplierId: "",
      supplierLabel: "",
    });

  const create = useMutation({
    mutationFn: () =>
      expensesApi.create({
        expenseDate: form.expenseDate,
        expenseAccountId: form.expenseAccountId,
        amount: form.amount,
        paymentMode: form.paymentMode,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.supplierId ? { supplierId: form.supplierId } : {}),
      }),
    onSuccess: () => {
      toast.success("Expense saved as a draft");
      setAddOpen(false);
      resetForm();
      setFormErrors({});
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setFormErrors(next);
        toast.error("Please check the form");
        return;
      }
      toast.error("Could not save", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const runAction = useMutation({
    mutationFn: ({ type, row }: { type: "post" | "cancel" | "reverse"; row: Expense }) =>
      type === "post"
        ? expensesApi.post(row.id)
        : type === "cancel"
          ? expensesApi.cancel(row.id)
          : expensesApi.reverse(row.id),
    onSuccess: (_data, variables) => {
      toast.success(
        variables.type === "post"
          ? "Expense posted"
          : variables.type === "cancel"
            ? "Draft cancelled"
            : "Expense reversed",
      );
      setAction(null);
      invalidate();
    },
    onError: (err) => {
      setAction(null);
      toast.error("Could not do that", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const submitAdd = () => {
    const next: Record<string, string> = {};
    if (!form.expenseAccountId) next.expenseAccountId = "Choose what this expense is for";
    if (!form.amount || Number(form.amount) <= 0) next.amount = "Enter an amount";
    if (!form.expenseDate) next.expenseDate = "Pick a date";
    setFormErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  const columns: Column<Expense>[] = [
    {
      header: "Number",
      cell: (row) => <span className="font-medium">{row.expenseNumber}</span>,
    },
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.expenseDate)}</span>,
    },
    {
      header: "What for",
      cell: (row) => (
        <span className="block max-w-[12rem] truncate">
          {row.category?.name}
          {row.description ? (
            <span className="block truncate text-xs text-muted-foreground">{row.description}</span>
          ) : null}
        </span>
      ),
    },
    {
      header: "Paid by",
      hideOnMobile: true,
      cell: (row) => (row.paymentMode === "CASH" ? "Cash" : "Bank"),
    },
    {
      header: "Amount",
      numeric: true,
      cell: (row) => <Money value={row.amount} />,
    },
    {
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      header: "",
      cell: (row) => {
        const canAct = row.status === "DRAFT" || row.status === "POSTED";
        if (!canAct) return null;
        return (
          <Can do="expenses.post">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {row.status === "DRAFT" ? (
                  <>
                    <DropdownMenuItem onSelect={() => setAction({ type: "post", row })}>
                      <CheckCircle2 className="h-4 w-4" />
                      Post to books
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setAction({ type: "cancel", row })}
                      className="text-destructive focus:text-destructive"
                    >
                      <Ban className="h-4 w-4" />
                      Cancel draft
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => setAction({ type: "reverse", row })}
                    className="text-destructive focus:text-destructive"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reverse
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </Can>
        );
      },
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Expenses"
        description="Rent, electricity, salaries and other business spending."
        actions={
          <Can do="expenses.draft">
            {/* Icon-only on a phone so the title keeps its room; labelled from
                sm up. aria-label carries the meaning either way. */}
            <Button className="gap-1.5" onClick={() => setAddOpen(true)} aria-label="Add expense">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add expense</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </Can>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.category?.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(row.expenseDate)} · {row.expenseNumber}
              </p>
              {row.description ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Money value={row.amount} className="text-sm font-semibold" />
              <StatusBadge status={row.status} />
            </div>
          </div>
        )}
        filters={
          <div className="w-full space-y-2">
            <DateRangeFilter
              value={range}
              onChange={(next) => {
                setRange(next);
                list.setPage(1);
              }}
            />
            {/* Status sits on the same visual tier as the date row rather than
                carrying its own stacked label, which cost a whole row before. */}
            <select
              id="exp-status"
              aria-label="Filter by status"
              className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs sm:w-auto sm:text-sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                list.setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </div>
        }
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
        emptyTitle="No expenses yet"
        emptyDescription="Record your shop costs so your profit figure is real."
        emptyAction={
          <Can do="expenses.draft">
            <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add expense
            </Button>
          </Can>
        }
      />

      {/* --- add expense --- */}
      <Dialog open={addOpen} onOpenChange={(open) => (create.isPending ? null : setAddOpen(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add expense</DialogTitle>
            <DialogDescription>
              Saved as a draft. An admin posts it to the books.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitAdd();
            }}
            className="space-y-4"
            noValidate
          >
            <FormSection>
              <Field
                label="What was it for"
                htmlFor="category"
                required
                error={formErrors.expenseAccountId}
              >
                <select
                  id="category"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                  value={form.expenseAccountId}
                  onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {categories.data?.map((category) => (
                    <option key={category.accountId} value={category.accountId}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount" htmlFor="amount" required error={formErrors.amount}>
                  <Input
                    id="amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </Field>
                <Field label="Date" htmlFor="expenseDate" required error={formErrors.expenseDate}>
                  <Input
                    id="expenseDate"
                    type="date"
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Paid by" htmlFor="paymentMode" required>
                <select
                  id="paymentMode"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                  value={form.paymentMode}
                  onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                >
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank</option>
                </select>
              </Field>

              <Field label="Note" htmlFor="description" hint="Optional">
                <Input
                  id="description"
                  value={form.description}
                  placeholder="e.g. September shop rent"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>

              <Field label="Paid to" hint="Optional. Recording a supplier here creates no bill.">
                <EntitySelect
                  kind="supplier"
                  value={form.supplierId}
                  valueLabel={form.supplierLabel}
                  placeholder="Nobody in particular"
                  onChange={(id, label) => setForm({ ...form, supplierId: id, supplierLabel: label })}
                />
              </Field>
            </FormSection>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={create.isPending}
              >
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
        open={action !== null}
        onOpenChange={(open) => (open ? null : setAction(null))}
        title={
          action?.type === "post"
            ? "Post this expense?"
            : action?.type === "cancel"
              ? "Cancel this draft?"
              : "Reverse this expense?"
        }
        confirmLabel={
          action?.type === "post" ? "Post" : action?.type === "cancel" ? "Cancel draft" : "Reverse"
        }
        destructive={action?.type !== "post"}
        isPending={runAction.isPending}
        onConfirm={() => action && runAction.mutate(action)}
        description={
          action?.type === "post"
            ? "The money will come out of your cash or bank balance, and this will show in your profit."
            : action?.type === "cancel"
              ? "The draft is abandoned. Nothing was posted, so nothing needs undoing."
              : "A new, opposite entry will be written. The original stays in the books — nothing is deleted."
        }
      />
    </div>
  );
}
