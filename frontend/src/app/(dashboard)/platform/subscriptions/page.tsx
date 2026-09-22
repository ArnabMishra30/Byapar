"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { platformApi, Subscription } from "@/lib/api/platform";
import {
  PlatformGuard,
  usePlatformUser,
  PERMISSION,
} from "@/features/platform/permission-guard";
import { DataTable, Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CalendarClock, Ban, Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";

// SUBSCRIPTIONS. What each shop bought, and when it runs out.

const STATUS_VARIANT: Record<string, "success" | "destructive" | "outline" | "secondary"> = {
  ACTIVE: "success",
  EXPIRED: "destructive",
  CANCELLED: "secondary",
  PENDING: "outline",
};

export default function SubscriptionsPage() {
  return (
    <PlatformGuard>
      <SubscriptionsContent />
    </PlatformGuard>
  );
}

function SubscriptionsContent() {
  const { can } = usePlatformUser();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [window, setWindow] = useState<string>("");
  const [cancelling, setCancelling] = useState<Subscription | null>(null);
  const [reason, setReason] = useState("");
  const [collecting, setCollecting] = useState<Subscription | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "subscriptions", page, status, window],
    queryFn: () =>
      platformApi.listSubscriptions({
        page,
        limit: 20,
        status: status || undefined,
        expiringWithinDays: window || undefined,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["platform", "subscriptions"] });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason: why }: { id: string; reason: string }) =>
      platformApi.cancelSubscription(id, why),
    onSuccess: () => {
      toast.success("Subscription cancelled");
      setCancelling(null);
      setReason("");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; amount: string; method: string }) =>
      platformApi.recordPayment(id, payload),
    onSuccess: () => {
      toast.success("Payment recorded");
      setCollecting(null);
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["platform", "payments"] });
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: Column<Subscription>[] = [
    {
      header: "Business",
      cell: (row) =>
        row.company ? (
          <Link
            href={`/platform/businesses/${row.company.id}`}
            className="font-medium hover:text-primary transition-colors"
          >
            {row.company.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        ),
    },
    {
      header: "Plan",
      cell: (row) => (
        <div>
          {/* The name AS SOLD. If the plan has since been renamed, this still
              shows what the shop actually bought. */}
          <div className="text-sm font-medium">{row.plan?.name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">
            ₹{row.price} · {row.duration}
          </div>
        </div>
      ),
    },
    {
      header: "Period",
      cell: (row) => (
        <span className="text-sm tabular-nums">
          {row.startDate} &rarr; {row.endDate}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{row.status}</Badge>
          {row.status === "ACTIVE" && row.daysRemaining !== null && row.daysRemaining <= 15 && (
            <span className="text-xs text-amber-600">{row.daysRemaining}d left</span>
          )}
        </div>
      ),
    },
    {
      header: "Sold by",
      cell: (row) => <span className="text-sm">{row.soldBy?.name ?? "—"}</span>,
    },
    {
      header: "",
      className: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {can(PERMISSION.PAYMENT_CREATE) && row.status !== "CANCELLED" && (
            <Button
              variant="ghost"
              size="sm"
              title="Record a payment"
              onClick={() => {
                setCollecting(row);
                setAmount(row.price);
              }}
            >
              <Wallet className="w-4 h-4" />
            </Button>
          )}
          {can(PERMISSION.SUBSCRIPTION_CANCEL) && row.status !== "CANCELLED" && (
            <Button
              variant="ghost"
              size="sm"
              title="Cancel"
              onClick={() => setCancelling(row)}
            >
              <Ban className="w-4 h-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
          <CalendarClock className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
          Subscriptions
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          What each shop bought, and when it runs out.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={refetch}
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.company?.name ?? "—"}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.plan?.name} · ₹{row.price}
              </p>
              <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
                {row.startDate} → {row.endDate}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{row.status}</Badge>
              {row.status === "ACTIVE" && row.daysRemaining !== null && row.daysRemaining <= 15 ? (
                <span className="text-[11px] text-amber-600">{row.daysRemaining}d left</span>
              ) : null}
            </div>
          </div>
        )}
        searchable={false}
        filterSlot={
          <div className="flex gap-2">
            <Select
              value={status || "ALL"}
              onValueChange={(value) => {
                setStatus(value === "ALL" ? "" : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={window || "ANY"}
              onValueChange={(value) => {
                setWindow(value === "ANY" ? "" : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[170px]">
                <SelectValue placeholder="Any time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any time</SelectItem>
                <SelectItem value="7">Expiring in 7 days</SelectItem>
                <SelectItem value="15">Expiring in 15 days</SelectItem>
                <SelectItem value="30">Expiring in 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        pagination={
          data?.pagination ? { ...data.pagination, onPageChange: setPage } : undefined
        }
        emptyTitle="No subscriptions"
        emptyDescription="Nothing matches these filters."
      />

      {/* Cancelling */}
      <Dialog open={Boolean(cancelling)} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this subscription?</DialogTitle>
            <DialogDescription>
              {cancelling?.company?.name} will not be able to record new business once this is
              cancelled. Their existing records stay available to read and export &mdash; nothing
              is deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reason">Why is it being cancelled?</Label>
            <Textarea
              id="reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Shop closed down"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || cancelMutation.isPending}
              onClick={() =>
                cancelling && cancelMutation.mutate({ id: cancelling.id, reason: reason.trim() })
              }
            >
              {cancelMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collecting */}
      <Dialog open={Boolean(collecting)} onOpenChange={(open) => !open && setCollecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              Money taken from {collecting?.company?.name} for their subscription. This is your
              platform&apos;s revenue and never appears in the shop&apos;s own accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (₹)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="BANK">Bank transfer</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCollecting(null)}>
              Cancel
            </Button>
            <Button
              disabled={!/^\d+(\.\d{1,2})?$/.test(amount) || paymentMutation.isPending}
              onClick={() =>
                collecting && paymentMutation.mutate({ id: collecting.id, amount, method })
              }
            >
              {paymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
