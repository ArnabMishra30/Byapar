"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { platformApi } from "@/lib/api/platform";
import {
  PlatformGuard,
  usePlatformUser,
  PERMISSION,
} from "@/features/platform/permission-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RechargeDialog } from "@/features/platform/recharge-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/shared/error-state";
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
import { formatDate } from "@/lib/utils";
import {
  ArrowLeft,
  Store,
  Phone,
  MapPin,
  Mail,
  Power,
  Plus,
  Loader2,
  Zap,
  Gift,
  History,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

// ONE SHOP, as the platform sees it.
//
// Its contact details, its subscription history, and the buttons to renew or
// switch it off. NOTHING about its accounting appears here: the platform sells
// access, it does not read the books.

const STATUS_VARIANT: Record<string, "success" | "destructive" | "outline" | "secondary"> = {
  ACTIVE: "success",
  EXPIRED: "destructive",
  CANCELLED: "secondary",
  PENDING: "outline",
};

export default function BusinessDetailPage() {
  return (
    <PlatformGuard>
      <BusinessDetail />
    </PlatformGuard>
  );
}

function BusinessDetail() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = usePlatformUser();

  const id = String(params.id);
  const [sellOpen, setSellOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [collect, setCollect] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const { data: business, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "business", id],
    queryFn: () => platformApi.getBusiness(id),
  });

  const history = useQuery({
    queryKey: ["platform", "business-history", id],
    queryFn: () => platformApi.getBusinessHistory(id),
  });

  const { data: plans } = useQuery({
    queryKey: ["platform", "plans", "sellable"],
    queryFn: () => platformApi.listPlans({ isActive: true, limit: 100 }),
    enabled: sellOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["platform", "business", id] });
    queryClient.invalidateQueries({ queryKey: ["platform", "subscriptions"] });
    queryClient.invalidateQueries({ queryKey: ["platform", "business-history", id] });
  };

  const sellMutation = useMutation({
    mutationFn: () =>
      platformApi.createSubscription({
        companyId: id,
        planId,
        payment: collect && amount ? { amount, method } : undefined,
      }),
    onSuccess: (data) => {
      toast.success(`Subscription active until ${data.subscription.endDate}`);
      setSellOpen(false);
      setPlanId("");
      setAmount("");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (isActive: boolean) => platformApi.setBusinessActive(id, isActive),
    onSuccess: () => {
      toast.success("Updated");
      setToggling(false);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !business) {
    return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/platform/businesses")}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        All businesses
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <Store className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
            {business.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
            {business.ownerName && <span>{business.ownerName}</span>}
            {business.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                {business.phone}
              </span>
            )}
            {business.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                {business.email}
              </span>
            )}
            {business.city && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {business.city}
                {business.pincode ? ` ${business.pincode}` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={business.isActive} />
          {/* THE PRIMARY ACTION. An admin looking at an expired shop almost
              always wants this one. */}
          {can(PERMISSION.SUBSCRIPTION_GRANT) && (
            <Button onClick={() => setRechargeOpen(true)}>
              <Zap className="w-4 h-4 mr-2" />
              Recharge
            </Button>
          )}
          {can(PERMISSION.SUBSCRIPTION_CREATE) && (
            <Button variant="outline" onClick={() => setSellOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Sell a plan
            </Button>
          )}
          {can(PERMISSION.BUSINESS_EDIT) && (
            <Button variant="outline" onClick={() => setToggling(true)}>
              <Power className="w-4 h-4 mr-2" />
              {business.isActive ? "Deactivate" : "Activate"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current subscription</CardTitle>
          </CardHeader>
          <CardContent>
            {business.currentSubscription ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{business.currentSubscription.plan}</span>
                  <Badge
                    variant={STATUS_VARIANT[business.currentSubscription.status] ?? "outline"}
                  >
                    {business.currentSubscription.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Runs until {business.currentSubscription.endDate}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No subscription yet. This shop can still use the application &mdash; it was never
                sold a plan, so nothing has expired.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">GST</CardTitle>
          </CardHeader>
          <CardContent>
            {business.gstEnabled ? (
              <div>
                <p className="font-mono text-sm">{business.gstin}</p>
                <p className="text-xs text-muted-foreground mt-1">Registered</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not registered. The shop records everything without tax, which is exactly right for
                them.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signed up</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{formatDate(business.createdAt)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              by {business.onboardedBy?.name ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {/* THE AUDIT TRAIL. Every subscription this shop has had and every
              payment it has made, including who granted what and why. */}
          <Tabs defaultValue="subscriptions">
            <TabsList className="mb-4">
              <TabsTrigger value="subscriptions" className="gap-1.5">
                <History className="w-3.5 h-3.5" />
                Subscriptions
              </TabsTrigger>
              <TabsTrigger value="payments" className="gap-1.5">
                <Wallet className="w-3.5 h-3.5" />
                Payments
              </TabsTrigger>
            </TabsList>

            <TabsContent value="subscriptions">
              {history.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (history.data?.subscriptions.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nothing has been sold or granted to this shop yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {history.data?.subscriptions.map((subscription) => (
                    <li key={subscription.id} className="py-3 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium flex items-center gap-2">
                            {subscription.plan?.name}
                            {subscription.origin === "ADMIN_GRANT" && (
                              <Badge variant="outline" className="gap-1 text-amber-600">
                                <Gift className="w-3 h-3" />
                                Admin grant
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {subscription.startDate} &rarr; {subscription.endDate}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-semibold tabular-nums">
                            ₹{subscription.price}
                          </span>
                          <Badge variant={STATUS_VARIANT[subscription.status] ?? "outline"}>
                            {subscription.status}
                          </Badge>
                        </div>
                      </div>

                      {/* Who did it and why - the whole point of recording a
                          grant as a real subscription rather than a moved date. */}
                      {subscription.grantReason && (
                        <p className="text-xs text-muted-foreground">
                          &ldquo;{subscription.grantReason}&rdquo;
                          {subscription.soldBy ? ` — ${subscription.soldBy.name}` : ""}
                        </p>
                      )}
                      {!subscription.grantReason && subscription.soldBy && (
                        <p className="text-xs text-muted-foreground">
                          Sold by {subscription.soldBy.name}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="payments">
              {history.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (history.data?.payments.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No money has been recorded against this shop. A free grant records
                  no payment, which is why one may not appear here.
                </p>
              ) : (
                <ul className="divide-y">
                  {history.data?.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium tabular-nums">₹{payment.amount}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(payment.paidAt)}
                          {payment.collectedBy ? ` · ${payment.collectedBy.name}` : ""}
                          {payment.reference ? ` · ${payment.reference}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {payment.method}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Sell / renew */}
      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sell a plan to {business.name}</DialogTitle>
            <DialogDescription>
              If a subscription is still running, the new one starts the day after it ends &mdash;
              the shop keeps every day it has already paid for.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select
                value={planId}
                onValueChange={(value) => {
                  setPlanId(value);
                  const plan = plans?.data.find((item) => item.id === value);
                  if (plan) setAmount(plan.price);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans?.data.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} &mdash; ₹{plan.price} for {plan.durationValue}{" "}
                      {plan.durationUnit.toLowerCase()}
                      {plan.durationValue > 1 ? "s" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {can(PERMISSION.PAYMENT_CREATE) && (
              <>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={collect}
                    onChange={(event) => setCollect(event.target.checked)}
                    className="rounded border-input"
                  />
                  Record a payment now
                </label>

                {collect && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="sellAmount">Amount (₹)</Label>
                      <Input
                        id="sellAmount"
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
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSellOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!planId || sellMutation.isPending} onClick={() => sellMutation.mutate()}>
              {sellMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sell plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RechargeDialog
        businessId={id}
        businessName={business.name}
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={business.isActive ? "Deactivate this business?" : "Activate this business?"}
        description={
          business.isActive
            ? "Its people will not be able to sign in. Nothing is deleted — every record stays exactly where it is, and turning the account back on restores access to all of it."
            : "Its people will be able to sign in again."
        }
        confirmLabel={business.isActive ? "Deactivate" : "Activate"}
        variant={business.isActive ? "destructive" : "default"}
        isLoading={toggleMutation.isPending}
        onConfirm={() => toggleMutation.mutate(!business.isActive)}
      />
    </div>
  );
}
