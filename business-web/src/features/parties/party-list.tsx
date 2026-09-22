"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, UserCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { customersApi, suppliersApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Can } from "@/components/shared/permission-gate";
import { GstOnly } from "@/components/shared/gst-gate";
import { Field, FormSection } from "@/components/shared/form-parts";
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
import { INDIAN_STATES } from "@/lib/constants";
import { stripBodyPrefix } from "@/lib/utils";
import type { Customer } from "@/types/api";

/**
 * Customers and suppliers are the same screen.
 *
 * The backend models them identically - same fields, same credit terms, same
 * ledger and statement endpoints - so building two near-identical pages would
 * mean fixing every bug twice. One component, two configurations.
 */

export type PartyKind = "customer" | "supplier";

const CONFIG = {
  customer: {
    title: "Customers",
    description: "Everyone you sell to, and what they owe you.",
    singular: "customer",
    addLabel: "Add customer",
    icon: UserCheck,
    balanceLabel: "Owes you",
    api: customersApi,
    detailHref: (id: string) => `/shop/customers/${id}`,
    emptyTitle: "No customers yet",
    emptyDescription: "Add the people you sell to, so you can track who owes you money.",
  },
  supplier: {
    title: "Suppliers",
    description: "Everyone you buy from, and what you owe them.",
    singular: "supplier",
    addLabel: "Add supplier",
    icon: Truck,
    balanceLabel: "You owe",
    api: suppliersApi,
    detailHref: (id: string) => `/shop/suppliers/${id}`,
    emptyTitle: "No suppliers yet",
    emptyDescription: "Add the people you buy from, so you can track what you owe.",
  },
} as const;

/**
 * GST fields are optional at every level, and the form only shows them at all
 * when the business itself uses GST. A local shop never sees a GSTIN box.
 */
const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "That name is too long"),
  phone: z.string().trim().max(20, "That phone number is too long").optional().or(z.literal("")),
  email: z.string().trim().email("That does not look like an email").optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  gstin: z.string().trim().optional().or(z.literal("")),
  stateCode: z.string().trim().optional().or(z.literal("")),
  creditLimit: z
    .string()
    .trim()
    .regex(/^\d*\.?\d{0,2}$/, "Enter an amount like 20000 or 20000.50")
    .optional()
    .or(z.literal("")),
  creditDays: z
    .string()
    .trim()
    .regex(/^\d*$/, "Enter a whole number of days")
    .optional()
    .or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export function PartyList({ kind }: { kind: PartyKind }) {
  const config = CONFIG[kind];
  const { isGstEnabled } = useAuth();
  const queryClient = useQueryClient();
  const list = useListState({ limit: 20 });
  const [addOpen, setAddOpen] = React.useState(false);

  // Search is debounced so a request does not fire on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(list.search), 300);
    return () => clearTimeout(timer);
  }, [list.search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [kind, "list", list.page, debouncedSearch],
    queryFn: () =>
      config.api.list({
        page: list.page,
        limit: list.limit,
        search: debouncedSearch || undefined,
      }),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      gstin: "",
      stateCode: "",
      creditLimit: "",
      creditDays: "",
    },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      config.api.create({
        name: values.name,
        phone: values.phone || undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        // Only ever sent when the business uses GST. A non-GST shop cannot
        // accidentally submit a blank GSTIN.
        ...(isGstEnabled
          ? {
              gstin: values.gstin || undefined,
              stateCode: values.stateCode || undefined,
            }
          : {}),
        creditLimit: values.creditLimit || undefined,
        creditDays: values.creditDays ? Number(values.creditDays) : undefined,
      } as Partial<Customer>),
    onSuccess: (created) => {
      toast.success(`${created.name} added`);
      setAddOpen(false);
      form.reset();
      // Refetch rather than patch the cache: the backend fills in defaults.
      queryClient.invalidateQueries({ queryKey: [kind] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        for (const item of err.fieldErrors) {
          const field = stripBodyPrefix(item.field) as keyof FormValues;
          if (field in form.getValues()) {
            form.setError(field, { message: item.message });
          }
        }
        toast.error("Please check the form");
        return;
      }
      toast.error(`Could not add ${config.singular}`, {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const columns: Column<Customer>[] = [
    {
      header: "Name",
      cell: (row) => (
        <Link href={config.detailHref(row.id)} className="font-medium text-foreground hover:text-primary">
          {row.name}
        </Link>
      ),
    },
    {
      header: "Phone",
      cell: (row) => row.phone || <span className="text-muted-foreground">—</span>,
      hideOnMobile: true,
    },
    {
      header: "Credit limit",
      numeric: true,
      hideOnMobile: true,
      cell: (row) =>
        row.isUnlimited ? (
          <span className="text-xs text-muted-foreground">No limit</span>
        ) : (
          <Money value={row.creditLimit} />
        ),
    },
    {
      header: "Terms",
      numeric: true,
      hideOnMobile: true,
      cell: (row) =>
        row.creditDays === null || row.creditDays === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          `${row.creditDays} days`
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
        title={config.title}
        description={config.description}
        actions={
          <Can do="parties.manage">
            <Button onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {config.addLabel}
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
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={`Search ${config.title.toLowerCase()}…`}
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.phone || "No phone"}
              </p>
            </div>
            <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />
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
          <Can do="parties.manage">
            <Button onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {config.addLabel}
            </Button>
          </Can>
        }
      />

      <Dialog open={addOpen} onOpenChange={(open) => (create.isPending ? null : setAddOpen(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{config.addLabel}</DialogTitle>
            <DialogDescription>
              Only the name is required. Everything else can be filled in later.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
            className="space-y-5"
            noValidate
          >
            <FormSection>
              <Field label="Name" htmlFor="name" required error={form.formState.errors.name?.message}>
                <Input id="name" autoFocus {...form.register("name")} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone" htmlFor="phone" error={form.formState.errors.phone?.message}>
                  <Input id="phone" type="tel" inputMode="tel" {...form.register("phone")} />
                </Field>
                <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
                  <Input id="email" type="email" inputMode="email" {...form.register("email")} />
                </Field>
              </div>

              <Field label="Address" htmlFor="address" error={form.formState.errors.address?.message}>
                <Input id="address" {...form.register("address")} />
              </Field>
            </FormSection>

            <FormSection
              title="Credit"
              description="Leave blank if you do not give this party credit terms."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Credit limit"
                  htmlFor="creditLimit"
                  hint="Blank or 0 means no limit"
                  error={form.formState.errors.creditLimit?.message}
                >
                  <Input id="creditLimit" inputMode="decimal" placeholder="0" {...form.register("creditLimit")} />
                </Field>
                <Field
                  label="Payment days"
                  htmlFor="creditDays"
                  hint="Used to work out due dates"
                  error={form.formState.errors.creditDays?.message}
                >
                  <Input id="creditDays" inputMode="numeric" placeholder="30" {...form.register("creditDays")} />
                </Field>
              </div>
            </FormSection>

            {/* Shown ONLY for a GST-registered business. A local shop never sees
                a GSTIN field, and never has to fill one in. */}
            <GstOnly>
              <FormSection title="GST" description="Optional, even for a registered business.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="GSTIN" htmlFor="gstin" error={form.formState.errors.gstin?.message}>
                    <Input id="gstin" className="uppercase" {...form.register("gstin")} />
                  </Field>
                  <Field label="State" htmlFor="stateCode" error={form.formState.errors.stateCode?.message}>
                    <select
                      id="stateCode"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                      {...form.register("stateCode")}
                    >
                      <option value="">Not set</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state.code} value={state.code}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </FormSection>
            </GstOnly>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              {/* Disabled while in flight, so a double tap cannot create two. */}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
