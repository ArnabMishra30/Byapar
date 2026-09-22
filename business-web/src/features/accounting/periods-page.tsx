"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Loader2, Lock, Plus, Unlock } from "lucide-react";
import { toast } from "sonner";
import { periodsApi, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
 * Accounting periods.
 *
 * Closing a month stops anybody entering or changing anything dated inside it.
 * It rewrites nothing - the books already balance - it simply refuses new
 * entries, which is what makes a finished month stay finished.
 */
export function PeriodsPage() {
  const queryClient = useQueryClient();
  const list = useListState({ limit: 20 });
  const [addOpen, setAddOpen] = React.useState(false);
  const [action, setAction] = React.useState<{ type: "close" | "reopen"; row: Record<string, unknown> } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["periods", list.page],
    queryFn: () => periodsApi.list({ page: list.page, limit: list.limit }),
  });

  const [form, setForm] = React.useState({ name: "", startDate: "", endDate: "" });
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => periodsApi.create(form),
    onSuccess: () => {
      toast.success("Period created");
      setAddOpen(false);
      setForm({ name: "", startDate: "", endDate: "" });
      setFormErrors({});
      queryClient.invalidateQueries({ queryKey: ["periods"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setFormErrors(next);
        return;
      }
      toast.error("Could not create the period", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const runAction = useMutation({
    mutationFn: ({ type, row }: { type: "close" | "reopen"; row: Record<string, unknown> }) =>
      type === "close"
        ? periodsApi.close(String(row.id))
        : periodsApi.reopen(String(row.id), "Reopened from the periods screen"),
    onSuccess: (_data, variables) => {
      toast.success(variables.type === "close" ? "Period closed" : "Period reopened");
      setAction(null);
      queryClient.invalidateQueries({ queryKey: ["periods"] });
    },
    onError: (err) => {
      setAction(null);
      toast.error("Could not do that", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const columns: Column<Record<string, unknown>>[] = [
    { header: "Period", cell: (row) => <span className="font-medium">{String(row.name)}</span> },
    {
      header: "From",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(String(row.startDate))}</span>,
    },
    {
      header: "To",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(String(row.endDate))}</span>,
    },
    { header: "Status", cell: (row) => <StatusBadge status={row.isClosed ? "CLOSED" : "ACTIVE"} /> },
    {
      header: "",
      cell: (row) => (
        <Can do="periods.manage">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => setAction({ type: row.isClosed ? "reopen" : "close", row })}
          >
            {row.isClosed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {row.isClosed ? "Reopen" : "Close"}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting periods"
        description="Close a month so nothing in it can change."
        actions={
          <Can do="periods.manage">
            <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              New period
            </Button>
          </Can>
        }
      />

      <Card>
        <CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
          <CalendarRange className="h-5 w-5 shrink-0" />
          <p>
            Periods are optional. If you never create one, everything works as normal. Once you
            close a period, bills and receipts dated inside it are refused — which is how a
            finished month stays finished.
          </p>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
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
        emptyTitle="No periods yet"
        emptyDescription="Create one when you want to lock a finished month."
      />

      <Dialog open={addOpen} onOpenChange={(open) => (create.isPending ? null : setAddOpen(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New accounting period</DialogTitle>
            <DialogDescription>Usually one month. Periods cannot overlap.</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
            className="space-y-4"
            noValidate
          >
            <FormSection>
              <Field label="Name" htmlFor="period-name" required error={formErrors.name}>
                <Input
                  id="period-name"
                  placeholder="e.g. March 2026"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" htmlFor="period-start" required error={formErrors.startDate}>
                  <Input
                    id="period-start"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </Field>
                <Field label="To" htmlFor="period-end" required error={formErrors.endDate}>
                  <Input
                    id="period-end"
                    type="date"
                    value={form.endDate}
                    min={form.startDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  />
                </Field>
              </div>
            </FormSection>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => (open ? null : setAction(null))}
        title={action?.type === "close" ? "Close this period?" : "Reopen this period?"}
        confirmLabel={action?.type === "close" ? "Close period" : "Reopen"}
        destructive={action?.type === "close"}
        isPending={runAction.isPending}
        onConfirm={() => action && runAction.mutate(action)}
        description={
          action?.type === "close"
            ? "New bills, receipts and expenses dated inside this period will be refused. Nothing already in the books changes."
            : "Entries dated inside this period will be allowed again. The fact that it was closed is kept in the record."
        }
      />
    </div>
  );
}
