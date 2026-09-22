"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { companyApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { GstBadge } from "@/components/shared/gst-badge";
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
import { formatDate } from "@/lib/utils";
import { Company } from "@/types/api";
import {
  Building2,
  Plus,
  ArrowRight,
  ShieldCheck,
  Store,
  Loader2,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const createCompanySchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
  gstin: z.string().optional(),
  adminName: z.string().min(2, "Admin name is required"),
  adminEmail: z.string().email("Valid admin email is required"),
  adminPassword: z.string().min(6, "Password must be at least 6 characters"),
});

type CreateCompanyValues = z.infer<typeof createCompanySchema>;

export default function CompaniesPage() {
  const { company: currentCompany } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [gstFilter, setGstFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Fetch current company
  const {
    data: currentComp,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["current-company"],
    queryFn: () => companyApi.getCurrentCompany(),
  });

  // Companies array (current company + any future multi-tenant list)
  const companies: Company[] = currentComp ? [currentComp] : [];

  // Filter companies
  const filteredCompanies = companies.filter((comp) => {
    if (gstFilter === "gst" && comp.gstRegistrationType === "UNREGISTERED") return false;
    if (gstFilter === "non-gst" && comp.gstRegistrationType !== "UNREGISTERED") return false;
    if (statusFilter === "active" && !comp.isActive) return false;
    if (statusFilter === "inactive" && comp.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        comp.name.toLowerCase().includes(q) ||
        (comp.gstin && comp.gstin.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Create Company Form
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateCompanyValues>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: {
      name: "",
      gstin: "",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateCompanyValues) =>
      companyApi.createCompany({
        name: values.name,
        gstin: values.gstin || undefined,
        admin: {
          name: values.adminName,
          email: values.adminEmail,
          password: values.adminPassword,
        },
      }),
    onSuccess: (data) => {
      toast.success("Company created successfully", {
        description: `${data.company.name} and admin account ${data.admin.email} created.`,
      });
      reset();
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["current-company"] });
    },
    onError: (err: any) => {
      toast.error("Failed to create company", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  const columns: Column<Company>[] = [
    {
      header: "Business Name",
      accessorKey: "name",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
            {row.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-foreground flex items-center gap-2">
              <span>{row.name}</span>
              {row.id === currentCompany?.id && (
                <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded">
                  Current
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.legalName || "No registered legal name"}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "GST Compliance",
      accessorKey: "gstRegistrationType",
      cell: (row) => (
        <div className="space-y-1">
          <GstBadge
            isGstEnabled={Boolean(row.stateCode && row.gstRegistrationType !== "UNREGISTERED")}
            registrationType={row.gstRegistrationType}
          />
          {row.gstin && (
            <div className="text-xs font-mono text-muted-foreground">
              {row.gstin}
            </div>
          )}
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
      cell: (row) => (
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Link href={`/admin/companies/${row.id}`}>
            <span>Manage</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Building2 className="w-7 h-7 text-primary" />
            <span>Companies & Businesses</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Manage your registered companies, tenant settings, and tax profiles.
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start sm:self-auto shadow-sm">
          <Plus className="w-4 h-4" />
          <span>New Company</span>
        </Button>
      </div>

      {/* Filter Bar & DataTable */}
      <DataTable
        columns={columns}
        data={filteredCompanies}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        searchable={true}
        searchPlaceholder="Search by business name or GSTIN..."
        searchValue={search}
        onSearchChange={setSearch}
        emptyTitle="No companies found"
        emptyDescription="Create a new business company to get started."
        emptyActionLabel="Add Company"
        onEmptyAction={() => setCreateOpen(true)}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={gstFilter} onValueChange={setGstFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="GST Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tax Types</SelectItem>
                <SelectItem value="gst">GST Registered</SelectItem>
                <SelectItem value="non-gst">Non-GST (Local)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
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

      {/* Create Company Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              <span>Create New Business Company</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add a new business profile. GSTIN is completely optional for local non-GST shops.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))}>
            <div className="space-y-4 py-3 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-semibold">
                  Company Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g. Royal General Store"
                  {...register("name")}
                  className={errors.name ? "border-destructive" : ""}
                />
                {errors.name && (
                  <p className="text-[11px] text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="gstin" className="text-xs font-semibold">
                    GSTIN (Optional)
                  </Label>
                  <span className="text-[11px] text-muted-foreground italic">
                    Leave blank for local/non-GST shop
                  </span>
                </div>
                <Input
                  id="gstin"
                  placeholder="e.g. 27AABCU9603R1ZM (15 chars)"
                  {...register("gstin")}
                />
              </div>

              <div className="pt-2 border-t space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  First Admin User
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="adminName" className="text-xs font-semibold">
                      Admin Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="adminName"
                      placeholder="e.g. Rahul Sharma"
                      {...register("adminName")}
                      className={errors.adminName ? "border-destructive" : ""}
                    />
                    {errors.adminName && (
                      <p className="text-[11px] text-destructive">
                        {errors.adminName.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="adminEmail" className="text-xs font-semibold">
                      Admin Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="adminEmail"
                      type="email"
                      placeholder="admin@store.com"
                      {...register("adminEmail")}
                      className={errors.adminEmail ? "border-destructive" : ""}
                    />
                    {errors.adminEmail && (
                      <p className="text-[11px] text-destructive">
                        {errors.adminEmail.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="adminPassword" className="text-xs font-semibold">
                    Password <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    placeholder="••••••••"
                    {...register("adminPassword")}
                    className={errors.adminPassword ? "border-destructive" : ""}
                  />
                  {errors.adminPassword && (
                    <p className="text-[11px] text-destructive">
                      {errors.adminPassword.message}
                    </p>
                  )}
                </div>
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
                <span>Create Company</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
