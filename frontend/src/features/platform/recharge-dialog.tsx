"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { platformApi } from "@/lib/api/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ArrowRight, Gift, Loader2, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";

// MANUAL RECHARGE / GRANT.
//
// An admin gives a shop a subscription by hand: cash taken at the counter, a
// bank transfer that arrived last week, or an outright gift. There is no payment
// gateway in this product and none is involved here.
//
// TWO THINGS THIS DIALOG IS CAREFUL ABOUT:
//
//   1. It shows what WILL happen before it happens. "30 Sep 2026 → 31 Dec 2026",
//      computed by the SERVER using the same arithmetic that will run on submit,
//      so the preview cannot drift from the outcome.
//
//   2. It says plainly that this is an authorised manual operation, and it will
//      not proceed without a reason. A subscription nobody paid for is exactly
//      the thing somebody will ask about a year from now.

interface Props {
  businessId: string;
  businessName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

/** Neither of these is a gateway. See the note above. */
const PAYMENT_METHODS = [
  { value: "MANUAL", label: "Manual / offline" },
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
];

export function RechargeDialog({
  businessId,
  businessName,
  open,
  onOpenChange,
  onDone,
}: Props) {
  const [planId, setPlanId] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("MANUAL");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["platform", "plans", "grantable"],
    queryFn: () => platformApi.listPlans({ limit: 100 }),
    enabled: open,
  });

  // The preview comes from the SERVER so it cannot disagree with the outcome.
  const {
    data: preview,
    isLoading: previewLoading,
    isError: previewError,
  } = useQuery({
    queryKey: ["platform", "recharge-preview", businessId, planId],
    queryFn: () => platformApi.previewRecharge(businessId, { planId }),
    enabled: open && Boolean(planId),
  });

  // Reset every time it opens, so a previous attempt never leaks into the next.
  useEffect(() => {
    if (open) {
      setPlanId("");
      setIsFree(false);
      setAmount("");
      setMethod("MANUAL");
      setReference("");
      setReason("");
    }
  }, [open]);

  const selectedPlan = plans?.data.find((plan) => plan.id === planId);

  const mutation = useMutation({
    mutationFn: () =>
      platformApi.grantSubscription({
        companyId: businessId,
        planId,
        reason: reason.trim(),
        // A free grant sends no amount at all, and the server records no
        // payment - rather than a ₹0 payment dressing a gift up as a sale.
        ...(isFree
          ? { method: "ADMIN_GRANT" }
          : { amount, method, reference: reference.trim() || null }),
      }),
    onSuccess: (data) => {
      toast.success(
        `${businessName} is active until ${data.subscription.endDate}` +
          (data.reactivated ? " and has been switched back on" : "")
      );
      onDone?.();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const amountValid = isFree || /^\d+(\.\d{1,2})?$/.test(amount);
  const canSubmit = Boolean(planId) && reason.trim().length >= 3 && amountValid;

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recharge {businessName}</DialogTitle>
          <DialogDescription>
            Give this shop a subscription directly. No payment gateway is involved.
          </DialogDescription>
        </DialogHeader>

        {/* Section 9: say plainly that this is an authorised manual operation. */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-muted-foreground">
            This is an <span className="font-medium text-foreground">administrator-authorised
            manual operation</span>. It is recorded against your account with the reason you give,
            and appears permanently in this shop&apos;s subscription history.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plan">Plan</Label>
            {plansLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="plan">
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans?.data.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} &mdash; ₹{plan.price} for {plan.durationValue}{" "}
                      {plan.durationUnit.toLowerCase()}
                      {plan.durationValue > 1 ? "s" : ""}
                      {!plan.isActive ? " (withdrawn)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {plans && plans.data.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No plans exist yet. Create one under Plans &amp; Pricing first.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <Gift className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Free / promotional grant</p>
                <p className="text-xs text-muted-foreground">
                  No money changed hands. Nothing is recorded as a payment.
                </p>
              </div>
            </div>
            <Switch checked={isFree} onCheckedChange={setIsFree} />
          </div>

          {!isFree && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder={selectedPlan?.price ?? "0.00"}
                  onChange={(event) => setAmount(event.target.value)}
                />
                {amount && !amountValid && (
                  <p className="text-xs text-destructive">Enter an amount like 500</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="method">Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reference">Reference</Label>
                <Input
                  id="reference"
                  value={reference}
                  placeholder="OFFLINE-001"
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              rows={2}
              value={reason}
              placeholder={
                isFree ? "Promotional access" : "Cash collected by sales staff"
              }
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Required. This is the only record of why this shop has access.
            </p>
          </div>

          {/* THE PREVIEW. Computed by the server, so it agrees with the result. */}
          {planId && (
            <div className="rounded-lg border bg-muted/40 p-3">
              {previewLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : previewError ? (
                <p className="text-sm text-muted-foreground">
                  Could not work out the new expiry. You can still continue &mdash; the server
                  decides the dates.
                </p>
              ) : preview ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Current expiry
                      </p>
                      <p className="text-sm font-medium tabular-nums">
                        {preview.current?.endDate ?? "None"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        New expiry
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-emerald-600">
                        {preview.endDate}
                      </p>
                    </div>
                    {preview.extending && (
                      <Badge variant="outline" className="ml-auto">
                        Extends existing
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{preview.explanation}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isFree ? (
              <Gift className="mr-2 h-4 w-4" />
            ) : (
              <Wallet className="mr-2 h-4 w-4" />
            )}
            {isFree ? "Grant access" : "Confirm recharge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
