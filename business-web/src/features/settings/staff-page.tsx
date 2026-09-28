"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Power, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { staffApi, staffAdminApi, ApiError } from "@/lib/api";
import { isPlatformRole, roleDescription, roleLabel } from "@/lib/auth/roles";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/select-native";
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
 *
 * Nobody is ever deleted: an account is switched off, which stops the sign-in
 * and keeps everything that person recorded. The backend also refuses to let
 * you change your own role or switch yourself off, and refuses to leave the
 * shop with no active owner; the screen hides the first two so nobody tries.
 */

type StaffRow = Record<string, unknown>;
type ShopRole = "ADMIN" | "STAFF";

function fieldErrorsFrom(err: unknown): Record<string, string> | null {
  if (!(err instanceof ApiError) || !err.fieldErrors?.length) return null;
  const next: Record<string, string> = {};
  for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
  return next;
}

export function StaffPage() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const list = useListState({ limit: 20 });
  const [addOpen, setAddOpen] = React.useState(false);

  const isMe = (row: StaffRow) => Boolean(me && row.id === me.id);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["staff", list.page, list.search],
    queryFn: () => staffApi.list({ page: list.page, limit: list.limit, search: list.search || undefined }),
  });

  // --- add -------------------------------------------------------------------

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
      const fields = fieldErrorsFrom(err);
      if (fields) return setFormErrors(fields);
      toast.error("Could not create the account", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  // --- edit ------------------------------------------------------------------

  const [editing, setEditing] = React.useState<StaffRow | null>(null);
  const [editForm, setEditForm] = React.useState<{ name: string; role: ShopRole }>({ name: "", role: "STAFF" });
  const [editErrors, setEditErrors] = React.useState<Record<string, string>>({});

  const openEdit = (row: StaffRow) => {
    setEditing(row);
    setEditForm({ name: String(row.name ?? ""), role: row.role === "ADMIN" ? "ADMIN" : "STAFF" });
    setEditErrors({});
  };

  const update = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("No staff member selected");
      const body: { name?: string; role?: ShopRole } = {};
      if (editForm.name.trim() !== String(editing.name ?? "")) body.name = editForm.name.trim();
      // The backend refuses a change to your own role; do not even send one.
      if (!isMe(editing) && editForm.role !== editing.role) body.role = editForm.role;
      return staffAdminApi.update(String(editing.id), body);
    },
    onSuccess: () => {
      toast.success("Staff details saved");
      setEditing(null);
      setEditErrors({});
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => {
      const fields = fieldErrorsFrom(err);
      if (fields) return setEditErrors(fields);
      toast.error("Could not save the changes", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const editUnchanged =
    editing !== null &&
    editForm.name.trim() === String(editing.name ?? "") &&
    (isMe(editing) || editForm.role === editing.role);

  // --- switch on / off --------------------------------------------------------

  const [statusTarget, setStatusTarget] = React.useState<StaffRow | null>(null);

  const setStatus = useMutation({
    mutationFn: (row: StaffRow) => staffAdminApi.setStatus(String(row.id), !row.isActive),
    onSuccess: (_data, row) => {
      toast.success(row.isActive ? "Account switched off" : "Account switched on");
      setStatusTarget(null);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => {
      setStatusTarget(null);
      toast.error("Could not change the account", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  // Platform accounts have no business in a shop and are never shown here.
  const rows = data?.items.filter((row) => !isPlatformRole(row.role));

  const nameCell = (row: StaffRow) => (
    <>
      {String(row.name)}
      {isMe(row) ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
    </>
  );

  const actions = (row: StaffRow) => (
    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      <Button variant="ghost" size="sm" className="h-10 gap-1.5" onClick={() => openEdit(row)}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>
      {isMe(row) ? null : (
        <Button
          variant="ghost"
          size="sm"
          className={row.isActive ? "h-10 gap-1.5 text-destructive" : "h-10 gap-1.5"}
          onClick={() => setStatusTarget(row)}
        >
          <Power className="h-4 w-4" />
          {row.isActive ? "Switch off" : "Switch on"}
        </Button>
      )}
    </div>
  );

  const columns: Column<StaffRow>[] = [
    {
      header: "Name",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{nameCell(row)}</span>
          <span className="block text-xs text-muted-foreground">{String(row.email)}</span>
        </span>
      ),
    },
    {
      header: "Role",
      cell: (row) => (
        <Badge variant={row.role === "ADMIN" ? "default" : "secondary"}>{roleLabel(row.role)}</Badge>
      ),
    },
    {
      header: "Status",
      cell: (row) => <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    { header: "Actions", className: "text-right", cell: actions },
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
            {roleLabel("ADMIN")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Everything: posting bills to the books, recording money in and out, adding customers and
            suppliers, closing months, and managing staff.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <User className="h-4 w-4 text-muted-foreground" />
            {roleLabel("STAFF")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{roleDescription("STAFF")}</p>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search staff…"
        mobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{nameCell(row)}</p>
                <p className="truncate text-xs text-muted-foreground">{String(row.email)}</p>
              </div>
              <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={row.role === "ADMIN" ? "default" : "secondary"}>{roleLabel(row.role)}</Badge>
              {actions(row)}
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
        emptyTitle="No staff yet"
        emptyDescription="Add an account for anyone else who works in the shop."
        emptyAction={
          <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add staff
          </Button>
        }
      />

      {/* Add */}
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
                <Input id="staff-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                hint="At least 8 characters. Tell them, and ask them to keep it private."
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
                <NativeSelect
                  id="staff-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="STAFF">{roleLabel("STAFF")}</option>
                  <option value="ADMIN">{roleLabel("ADMIN")}</option>
                </NativeSelect>
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

      {/* Edit */}
      <Dialog open={editing !== null} onOpenChange={(open) => (update.isPending || open ? null : setEditing(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit staff</DialogTitle>
            <DialogDescription>{editing ? String(editing.email) : ""}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate();
            }}
            className="space-y-4"
            noValidate
          >
            <FormSection>
              <Field label="Name" htmlFor="edit-staff-name" required error={editErrors.name}>
                <Input
                  id="edit-staff-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </Field>
              <Field
                label="Role"
                htmlFor="edit-staff-role"
                error={editErrors.role}
                hint={
                  editing && isMe(editing)
                    ? "You cannot change your own role. Another shop owner can."
                    : roleDescription(editForm.role)
                }
              >
                <NativeSelect
                  id="edit-staff-role"
                  disabled={Boolean(editing && isMe(editing))}
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as ShopRole })}
                >
                  <option value="STAFF">{roleLabel("STAFF")}</option>
                  <option value="ADMIN">{roleLabel("ADMIN")}</option>
                </NativeSelect>
              </Field>
            </FormSection>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={update.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending || editUnchanged}>
                {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Switch on / off */}
      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(open) => (open ? null : setStatusTarget(null))}
        title={statusTarget?.isActive ? "Switch off this account?" : "Switch this account back on?"}
        confirmLabel={statusTarget?.isActive ? "Switch off" : "Switch on"}
        destructive={Boolean(statusTarget?.isActive)}
        isPending={setStatus.isPending}
        onConfirm={() => {
          if (statusTarget) setStatus.mutate(statusTarget);
        }}
        description={
          statusTarget?.isActive
            ? `${String(statusTarget.name ?? "They")} will not be able to sign in. Everything they recorded stays in your books, and you can switch the account back on at any time.`
            : `${String(statusTarget?.name ?? "They")} will be able to sign in again with their existing password.`
        }
      />
    </div>
  );
}
