"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { platformApi, SalesStaff } from "@/lib/api/platform";
import {
  PlatformGuard,
  PERMISSION_LABELS,
} from "@/features/platform/permission-guard";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UsersRound, Plus, Edit2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

// THE SALES TEAM.
//
// Who works for the platform, and what each of them is trusted to do. A rep can
// never open this page - only the operator hires, fires and grants permissions,
// which is what stops anyone widening their own access.

export default function SalesTeamPage() {
  return (
    <PlatformGuard adminOnly>
      <SalesTeamContent />
    </PlatformGuard>
  );
}

function SalesTeamContent() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalesStaff | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdminRole, setIsAdminRole] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "staff", page, search],
    queryFn: () => platformApi.listStaff({ page, limit: 20, search: search || undefined }),
  });

  // The catalogue comes from the server so this form never hardcodes the list.
  const { data: catalogue } = useQuery({
    queryKey: ["platform", "permissions"],
    queryFn: () => platformApi.listPermissions(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["platform", "staff"] });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editing) {
        return platformApi.updateStaff(editing.id, {
          name,
          role: isAdminRole ? "PLATFORM_ADMIN" : "SALES_STAFF",
          permissions: isAdminRole ? [] : permissions,
        });
      }
      return platformApi.createStaff({
        name,
        email,
        password,
        role: isAdminRole ? "PLATFORM_ADMIN" : "SALES_STAFF",
        permissions: isAdminRole ? undefined : permissions,
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Saved" : "Team member added");
      setDialogOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      platformApi.updateStaff(id, { isActive }),
    onSuccess: () => {
      toast.success("Updated");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setName("");
    setEmail("");
    setPassword("");
    setIsAdminRole(false);
    setPermissions(catalogue?.defaults ?? []);
    setDialogOpen(true);
  };

  const openEdit = (staff: SalesStaff) => {
    setEditing(staff);
    setName(staff.name);
    setEmail(staff.email);
    setPassword("");
    setIsAdminRole(staff.role === "PLATFORM_ADMIN");
    setPermissions(staff.permissions ?? []);
    setDialogOpen(true);
  };

  const togglePermission = (permission: string) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  };

  const columns: Column<SalesStaff>[] = [
    {
      header: "Name",
      cell: (staff) => (
        <div>
          <div className="font-medium">{staff.name}</div>
          <div className="text-xs text-muted-foreground">{staff.email}</div>
        </div>
      ),
    },
    {
      header: "Role",
      cell: (staff) =>
        staff.role === "PLATFORM_ADMIN" ? (
          <Badge variant="default" className="gap-1">
            <ShieldCheck className="w-3 h-3" />
            Platform admin
          </Badge>
        ) : (
          <Badge variant="outline">Sales staff</Badge>
        ),
    },
    {
      header: "Can do",
      cell: (staff) =>
        staff.role === "PLATFORM_ADMIN" ? (
          <span className="text-xs text-muted-foreground">Everything</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {staff.permissions?.length ?? 0} permission
            {(staff.permissions?.length ?? 0) === 1 ? "" : "s"}
          </span>
        ),
    },
    {
      header: "Status",
      cell: (staff) => <StatusBadge status={staff.isActive} />,
    },
    {
      header: "",
      className: "text-right",
      cell: (staff) => (
        <div className="flex items-center justify-end gap-2">
          <Switch
            checked={staff.isActive}
            onCheckedChange={(checked) =>
              toggleActive.mutate({ id: staff.id, isActive: checked })
            }
          />
          <Button variant="ghost" size="sm" onClick={() => openEdit(staff)}>
            <Edit2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <UsersRound className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
            Sales Team
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Who works for the platform, and what each of them is trusted to do.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Add team member
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={refetch}
        mobileCard={(staff) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{staff.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{staff.email}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {staff.role === "PLATFORM_ADMIN"
                  ? "Platform Super Admin"
                  : `${staff.permissions?.length ?? 0} permissions`}
              </p>
            </div>
            <StatusBadge status={staff.isActive} />
          </div>
        )}
        searchable
        searchPlaceholder="Search by name or email..."
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        pagination={
          data?.pagination ? { ...data.pagination, onPageChange: setPage } : undefined
        }
        emptyTitle="No team members yet"
        emptyDescription="Add your first sales rep to start signing up shops."
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a team member"}</DialogTitle>
            <DialogDescription>
              A platform team member has no shop of their own. They work across every business and
              can never open one&apos;s books.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staffName">Name</Label>
              <Input
                id="staffName"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            {!editing && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="staffEmail">Email</Label>
                  <Input
                    id="staffEmail"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staffPassword">Password</Label>
                  <Input
                    id="staffPassword"
                    type="text"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                </div>
              </>
            )}

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Platform administrator</p>
                <p className="text-xs text-muted-foreground">
                  Can do everything, including pricing and the team itself.
                </p>
              </div>
              <Switch checked={isAdminRole} onCheckedChange={setIsAdminRole} />
            </div>

            {!isAdminRole && (
              <div className="space-y-2">
                <Label>What they can do</Label>
                <div className="space-y-2 rounded-lg border p-3">
                  {(catalogue?.permissions ?? []).map((permission) => {
                    const meta = PERMISSION_LABELS[permission];
                    return (
                      <label
                        key={permission}
                        className="flex items-start gap-3 cursor-pointer"
                      >
                        <Checkbox
                          checked={permissions.includes(permission)}
                          onCheckedChange={() => togglePermission(permission)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="text-sm font-medium block">
                            {meta?.label ?? permission}
                          </span>
                          {meta?.description && (
                            <span className="text-xs text-muted-foreground">
                              {meta.description}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                saveMutation.isPending ||
                name.trim().length < 2 ||
                (!editing && (!email.includes("@") || password.length < 8))
              }
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? "Save changes" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
