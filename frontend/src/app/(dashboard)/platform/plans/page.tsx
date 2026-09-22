"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { platformApi, SubscriptionPlan } from "@/lib/api/platform";
import { PlatformGuard } from "@/features/platform/permission-guard";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tags, Plus, Edit2, Power, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

// PLANS AND PRICING.
//
// This page is the ONLY place a price is decided. Nothing in the codebase knows
// what "300" or "500" mean - they are rows an operator creates here, and a shop
// that bought one keeps the price it agreed even after the plan is repriced.

const planSchema = z.object({
  name: z.string().min(2, "Give the plan a name").max(100),
  description: z.string().max(1000).optional(),
  price: z
    .string()
    .min(1, "A price is required")
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 300 or 299.50"),
  durationValue: z
    .string()
    .min(1, "A duration is required")
    .regex(/^\d+$/, "Enter a whole number")
    .refine((v) => Number(v) > 0, "Duration must be more than zero"),
  durationUnit: z.enum(["DAY", "MONTH", "YEAR"]),
});

type PlanValues = z.infer<typeof planSchema>;

export default function PlansPage() {
  return (
    <PlatformGuard adminOnly>
      <PlansContent />
    </PlatformGuard>
  );
}

function PlansContent() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [toggling, setToggling] = useState<SubscriptionPlan | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "plans", page, search],
    queryFn: () => platformApi.listPlans({ page, limit: 20, search: search || undefined }),
  });

  const form = useForm<PlanValues>({
    resolver: zodResolver(planSchema),
    defaultValues: { name: "", description: "", price: "", durationValue: "", durationUnit: "MONTH" },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["platform", "plans"] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: PlanValues) => {
      const payload = {
        name: values.name,
        description: values.description || null,
        price: values.price,
        durationValue: Number(values.durationValue),
        durationUnit: values.durationUnit,
      };
      return editing
        ? platformApi.updatePlan(editing.id, payload)
        : platformApi.createPlan(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Plan updated" : "Plan created");
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      platformApi.setPlanActive(id, isActive),
    onSuccess: (plan) => {
      toast.success(plan.isActive ? "Plan is on sale again" : "Plan withdrawn from sale");
      setToggling(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", description: "", price: "", durationValue: "", durationUnit: "MONTH" });
    setDialogOpen(true);
  };

  const openEdit = (plan: SubscriptionPlan) => {
    setEditing(plan);
    form.reset({
      name: plan.name,
      description: plan.description ?? "",
      price: plan.price,
      durationValue: String(plan.durationValue),
      durationUnit: plan.durationUnit,
    });
    setDialogOpen(true);
  };

  const columns: Column<SubscriptionPlan>[] = [
    {
      header: "Plan",
      cell: (plan) => (
        <div>
          <div className="font-medium">{plan.name}</div>
          {plan.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">{plan.description}</div>
          )}
        </div>
      ),
    },
    {
      header: "Price",
      cell: (plan) => (
        <span className="font-semibold tabular-nums">
          ₹{plan.price}
        </span>
      ),
    },
    {
      header: "Duration",
      cell: (plan) => (
        <span className="text-sm">
          {plan.durationValue} {plan.durationUnit.toLowerCase()}
          {plan.durationValue > 1 ? "s" : ""}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (plan) => (
        <StatusBadge status={plan.isActive} />
      ),
    },
    {
      header: "",
      className: "text-right",
      cell: (plan) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(plan)}>
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setToggling(plan)}>
            <Power className={plan.isActive ? "w-4 h-4 text-amber-600" : "w-4 h-4 text-emerald-600"} />
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
            <Tags className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
            Plans &amp; Pricing
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            What you sell, and what it costs. Every price in the product comes from this list.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          New plan
        </Button>
      </div>

      <div className="flex gap-2 items-start rounded-lg border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          A plan that shops have already bought is never deleted &mdash; withdraw it from sale
          instead. Existing subscriptions keep the price and duration they were sold at, so
          changing a price here never rewrites what somebody already paid.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={refetch}
        mobileCard={(plan) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{plan.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {plan.durationValue} {plan.durationUnit.toLowerCase()}
                {plan.durationValue > 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-semibold tabular-nums">₹{plan.price}</span>
              <StatusBadge status={plan.isActive} />
            </div>
          </div>
        )}
        searchable
        searchPlaceholder="Search plans..."
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        pagination={
          data?.pagination
            ? { ...data.pagination, onPageChange: setPage }
            : undefined
        }
        emptyTitle="No plans yet"
        emptyDescription="Create your first plan to start selling subscriptions."
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit plan" : "New plan"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changing the price affects new sales only. Shops already on this plan keep what they agreed."
                : "Set any price and duration you like. Nothing is fixed in the software."}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Plan name</Label>
              <Input id="name" placeholder="3 Months" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="price">Price (₹)</Label>
                <Input id="price" inputMode="decimal" placeholder="300" {...form.register("price")} />
                {form.formState.errors.price && (
                  <p className="text-xs text-destructive">{form.formState.errors.price.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="durationValue">Duration</Label>
                <Input
                  id="durationValue"
                  inputMode="numeric"
                  placeholder="3"
                  {...form.register("durationValue")}
                />
                {form.formState.errors.durationValue && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.durationValue.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Unit</Label>
                <Select
                  value={form.watch("durationUnit")}
                  onValueChange={(value) =>
                    form.setValue("durationUnit", value as PlanValues["durationUnit"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">Days</SelectItem>
                    <SelectItem value="MONTH">Months</SelectItem>
                    <SelectItem value="YEAR">Years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                rows={2}
                placeholder="What a shop gets on this plan"
                {...form.register("description")}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editing ? "Save changes" : "Create plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(open) => !open && setToggling(null)}
        title={toggling?.isActive ? "Withdraw this plan from sale?" : "Put this plan back on sale?"}
        description={
          toggling?.isActive
            ? `"${toggling?.name}" will no longer be sellable. Shops already on it keep it until it ends — nothing is cancelled and nothing is deleted.`
            : `"${toggling?.name}" will be sellable again.`
        }
        confirmLabel={toggling?.isActive ? "Withdraw" : "Put on sale"}
        isLoading={toggleMutation.isPending}
        onConfirm={() => {
          if (toggling) toggleMutation.mutate({ id: toggling.id, isActive: !toggling.isActive });
        }}
      />
    </div>
  );
}
