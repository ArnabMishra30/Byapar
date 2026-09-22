"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { userApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/lib/utils";
import { User, UserRole, ShopUserRole } from "@/types/api";
import {
  Users,
  Plus,
  Edit2,
  Power,
  Loader2,
  Shield,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email address is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["ADMIN", "STAFF"]),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  role: z.enum(["ADMIN", "STAFF"]),
});

type EditUserValues = z.infer<typeof editUserSchema>;

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [toggleStatusUser, setToggleStatusUser] = useState<User | null>(null);

  // Fetch Users
  const {
    data: usersResult,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["users", page, search, roleFilter, statusFilter],
    queryFn: () =>
      userApi.listUsers({
        page,
        limit: 10,
        search: search || undefined,
        role: roleFilter !== "all" ? (roleFilter as ShopUserRole) : undefined,
        isActive:
          statusFilter === "active"
            ? true
            : statusFilter === "inactive"
            ? false
            : undefined,
      }),
  });

  // Create User Form
  const {
    register: registerCreate,
    handleSubmit: handleSubmitCreate,
    reset: resetCreate,
    formState: { errors: createErrors },
    setValue: setCreateValue,
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "STAFF",
    },
  });

  // Edit User Form
  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    reset: resetEdit,
    setValue: setEditValue,
    formState: { errors: editErrors },
  } = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateUserValues) => userApi.createUser(values),
    onSuccess: (newUser) => {
      toast.success("User added successfully", {
        description: `${newUser.name} (${newUser.email}) has been created.`,
      });
      resetCreate();
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: any) => {
      toast.error("Failed to create user", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditUserValues }) =>
      userApi.updateUser(id, values),
    onSuccess: (updated) => {
      toast.success("User updated successfully", {
        description: `${updated.name}'s profile was updated.`,
      });
      setEditUser(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: any) => {
      toast.error("Failed to update user", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      userApi.updateUserStatus(id, isActive),
    onSuccess: (updated) => {
      toast.success(
        `User ${updated.isActive ? "activated" : "deactivated"} successfully`
      );
      setToggleStatusUser(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: any) => {
      toast.error("Failed to change user status", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  const openEditModal = (target: User) => {
    setEditUser(target);
    setEditValue("name", target.name);
    // This screen manages a SHOP's own people, who are only ever ADMIN or
    // STAFF. Platform roles never appear in this list.
    setEditValue("role", target.role === "ADMIN" ? "ADMIN" : "STAFF");
  };

  const columns: Column<User>[] = [
    {
      header: "User / Staff",
      accessorKey: "name",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
              {getInitials(row.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <span>{row.name}</span>
              {row.id === currentUser?.id && (
                <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded">
                  You
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      header: "System Role",
      accessorKey: "role",
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          {row.role === "ADMIN" ? (
            <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          ) : (
            <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold uppercase">
            {row.role === "ADMIN" ? "Administrator" : "Staff Member"}
          </span>
        </div>
      ),
    },
    {
      header: "Status",
      accessorKey: "isActive",
      cell: (row) => <StatusBadge status={row.isActive} />,
    },
    {
      header: "Created Date",
      accessorKey: "createdAt",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.createdAt)}
        </span>
      ),
    },
    {
      header: "Actions",
      cell: (row) => {
        const isSelf = row.id === currentUser?.id;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => openEditModal(row)}
              title="Edit User"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={isSelf}
              className={`h-8 w-8 ${
                row.isActive
                  ? "text-muted-foreground hover:text-destructive"
                  : "text-muted-foreground hover:text-emerald-600"
              }`}
              onClick={() => setToggleStatusUser(row)}
              title={
                isSelf
                  ? "Cannot deactivate your own account"
                  : row.isActive
                  ? "Deactivate User"
                  : "Activate User"
              }
            >
              <Power className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Users className="w-7 h-7 text-primary" />
            <span>Staff & User Management</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Manage company team members, assign operational roles, and manage access.
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start sm:self-auto shadow-sm">
          <Plus className="w-4 h-4" />
          <span>Add Staff Member</span>
        </Button>
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={usersResult?.users || []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        searchable={true}
        searchPlaceholder="Search users by name or email..."
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        pagination={
          usersResult?.pagination
            ? {
                ...usersResult.pagination,
                onPageChange: setPage,
              }
            : undefined
        }
        emptyTitle="No users found"
        emptyDescription="Add staff members to your company to collaborate."
        emptyActionLabel="Add User"
        onEmptyAction={() => setCreateOpen(true)}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={roleFilter}
              onValueChange={(val) => {
                setRoleFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="ADMIN">Administrator</SelectItem>
                <SelectItem value="STAFF">Staff Member</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[120px] h-9 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Add User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <span>Add Staff Member</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Create a login account for a team member in your company.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitCreate((d) => createMutation.mutate(d))}>
            <div className="space-y-4 py-3 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="createName" className="text-xs font-semibold">
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="createName"
                  placeholder="e.g. Ramesh Kumar"
                  {...registerCreate("name")}
                  className={createErrors.name ? "border-destructive" : ""}
                />
                {createErrors.name && (
                  <p className="text-[11px] text-destructive">
                    {createErrors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="createEmail" className="text-xs font-semibold">
                  Email Address <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="createEmail"
                  type="email"
                  placeholder="staff@store.com"
                  {...registerCreate("email")}
                  className={createErrors.email ? "border-destructive" : ""}
                />
                {createErrors.email && (
                  <p className="text-[11px] text-destructive">
                    {createErrors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="createPassword" className="text-xs font-semibold">
                  Initial Password <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="createPassword"
                  type="password"
                  placeholder="••••••••"
                  {...registerCreate("password")}
                  className={createErrors.password ? "border-destructive" : ""}
                />
                {createErrors.password && (
                  <p className="text-[11px] text-destructive">
                    {createErrors.password.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Role</Label>
                <Select
                  defaultValue="STAFF"
                  onValueChange={(val: "ADMIN" | "STAFF") =>
                    setCreateValue("role", val)
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STAFF">
                      Staff Member (Sales, Bills & Stock)
                    </SelectItem>
                    <SelectItem value="ADMIN">
                      Administrator (Full Access & Settings)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="gap-2"
              >
                {createMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                <span>Add User</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-primary" />
              <span>Edit User Profile</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update user details for {editUser?.email}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmitEdit((d) => {
              if (editUser) {
                updateMutation.mutate({ id: editUser.id, values: d });
              }
            })}
          >
            <div className="space-y-4 py-3 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="editName" className="text-xs font-semibold">
                  Full Name
                </Label>
                <Input
                  id="editName"
                  {...registerEdit("name")}
                  className={editErrors.name ? "border-destructive" : ""}
                />
                {editErrors.name && (
                  <p className="text-[11px] text-destructive">
                    {editErrors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Role</Label>
                <Select
                  defaultValue={editUser?.role || "STAFF"}
                  onValueChange={(val: "ADMIN" | "STAFF") =>
                    setEditValue("role", val)
                  }
                  disabled={editUser?.id === currentUser?.id}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STAFF">Staff Member</SelectItem>
                    <SelectItem value="ADMIN">Administrator</SelectItem>
                  </SelectContent>
                </Select>
                {editUser?.id === currentUser?.id && (
                  <p className="text-[11px] text-muted-foreground italic">
                    You cannot change your own role.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditUser(null)}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="gap-2"
              >
                {updateMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                <span>Save Changes</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Toggle Status Confirmation Dialog */}
      <ConfirmDialog
        open={!!toggleStatusUser}
        onOpenChange={(open) => !open && setToggleStatusUser(null)}
        title={
          toggleStatusUser?.isActive
            ? "Deactivate User Account?"
            : "Reactivate User Account?"
        }
        description={
          toggleStatusUser?.isActive
            ? `Deactivating ${toggleStatusUser?.name} will prevent them from signing in immediately. Historical records created by them will remain preserved.`
            : `Reactivating ${toggleStatusUser?.name} will restore their access to the company.`
        }
        confirmLabel={
          toggleStatusUser?.isActive ? "Deactivate User" : "Activate User"
        }
        variant={toggleStatusUser?.isActive ? "destructive" : "default"}
        isLoading={statusMutation.isPending}
        onConfirm={() => {
          if (toggleStatusUser) {
            statusMutation.mutate({
              id: toggleStatusUser.id,
              isActive: !toggleStatusUser.isActive,
            });
          }
        }}
      />
    </div>
  );
}
