"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { staffApi, ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/auth/roles";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { stripBodyPrefix } from "@/lib/utils";

/**
 * Staff accounts.
 *
 * There are exactly two roles, because the backend has exactly two. What each
 * can do is spelled out on this screen rather than left for someone to discover
 * by hitting a wall.
 */
export function StaffPage() {
  const queryClient = useQueryClient();
  const list = useListState({ limit: 20 });
  const [addOpen, setAddOpen] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["staff", list.page, list.search],
    queryFn: () => staffApi.list({ page: list.page, limit: list.limit, search: list.search || undefined }),
  });

  const [form, setForm] = React.useState({ name: "", email: "", password: "", role: "STAFF" });
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => staffApi.create(form),
    onSuccess: () => {
      toast.success("Staff account created");
      setAddOpen(false);
      setForm({ name: "", email: "", password: "", role: "STAFF" });
      setFormErrors({});
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setFormErrors(next);
        return;
      }
      toast.error("Could not create the account", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const columns: Column<Record<string, unknown>>[] = [
    {
      header: "Name",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{String(row.name)}</span>
          <span className="block text-xs text-muted-foreground">{String(row.email)}</span>
        </span>
      ),
    },
    {
      header: "Role",
      cell: (row) => (
        <Badge variant={row.role === "ADMIN" ? "default" : "secondary"}>
          {roleLabel(row.role)}
        </Badge>
      ),
    },
    {
      header: "Status",
      cell: (row) => <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Who can use this account, and what they can do."
        actions={
          <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add staff
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Shop Owner
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Everything: posting bills to the books, recording money in and out, adding customers and
            suppliers, closing months, and managing staff.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <User className="h-4 w-4 text-muted-foreground" />
            Staff
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Can see everything, and prepare sales, purchases and expenses as drafts. An admin posts
            them and records money.
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search staff…"
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
        emptyTitle="No staff yet"
        emptyDescription="Add an account for anyone else who works in the shop."
      />

      <Dialog open={addOpen} onOpenChange={(open) => (create.isPending ? null : setAddOpen(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
            <DialogDescription>They will sign in with this email and password.</DialogDescription>
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
              <Field label="Name" htmlFor="staff-name" required error={formErrors.name}>
                <Input
                  id="staff-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor="staff-email" required error={formErrors.email}>
                <Input
                  id="staff-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field
                label="Password"
                htmlFor="staff-password"
                required
                hint="They can be told this, and should change it later"
                error={formErrors.password}
              >
                <Input
                  id="staff-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
              <Field label="Role" htmlFor="staff-role" required error={formErrors.role}>
                <select
                  id="staff-role"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="STAFF">Staff</option>
                  <option value="ADMIN">Shop Owner</option>
                </select>
              </Field>
            </FormSection>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
