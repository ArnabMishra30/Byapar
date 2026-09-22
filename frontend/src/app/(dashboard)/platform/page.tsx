"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { platformApi } from "@/lib/api/platform";
import { PlatformGuard, usePlatformUser } from "@/features/platform/permission-guard";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Store, Wallet, CalendarClock, AlertTriangle, ArrowRight } from "lucide-react";

// THE OPERATOR'S OVERVIEW.
//
// Every figure here is counted from real rows. Nothing is estimated, projected
// or filled in with a plausible-looking number - an empty platform shows zeros,
// which is the truth.

export default function PlatformOverviewPage() {
  return (
    <PlatformGuard>
      <OverviewContent />
    </PlatformGuard>
  );
}

function OverviewContent() {
  const { isPlatformAdmin, user } = usePlatformUser();

  const businesses = useQuery({
    queryKey: ["platform", "overview", "businesses"],
    queryFn: () => platformApi.listBusinesses({ limit: 1 }),
  });

  const mine = useQuery({
    queryKey: ["platform", "overview", "mine"],
    queryFn: () => platformApi.listBusinesses({ limit: 1, mine: true }),
  });

  const active = useQuery({
    queryKey: ["platform", "overview", "active"],
    queryFn: () => platformApi.listSubscriptions({ limit: 1, status: "ACTIVE" }),
  });

  const expiring = useQuery({
    queryKey: ["platform", "overview", "expiring"],
    queryFn: () => platformApi.listSubscriptions({ limit: 10, expiringWithinDays: 15 }),
  });

  const payments = useQuery({
    queryKey: ["platform", "overview", "payments"],
    queryFn: () => platformApi.listPayments({ limit: 8 }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight sm:text-2xl">
          {isPlatformAdmin ? "Platform overview" : `Hello, ${user?.name?.split(" ")[0] ?? "there"}`}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          {isPlatformAdmin
            ? "How the business is doing."
            : "Your shops, your collections, and who needs a renewal."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Businesses"
          value={businesses.data?.pagination.total ?? 0}
          description="On the platform"
          icon={Store}
          isLoading={businesses.isLoading}
          colorScheme="indigo"
        />
        <StatCard
          title="Signed up by me"
          value={mine.data?.pagination.total ?? 0}
          description="Your own shops"
          icon={Store}
          isLoading={mine.isLoading}
          colorScheme="sky"
        />
        <StatCard
          title="Active subscriptions"
          value={active.data?.pagination.total ?? 0}
          description="Currently running"
          icon={CalendarClock}
          isLoading={active.isLoading}
          colorScheme="emerald"
        />
        <StatCard
          title="Expiring soon"
          value={expiring.data?.pagination.total ?? 0}
          description="Within 15 days"
          icon={AlertTriangle}
          isLoading={expiring.isLoading}
          colorScheme="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Renewals to chase
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/platform/subscriptions">
                All <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {expiring.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (expiring.data?.data.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nothing expiring in the next fortnight.
              </p>
            ) : (
              <ul className="divide-y">
                {expiring.data?.data.map((subscription) => (
                  <li key={subscription.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {subscription.company?.name ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {subscription.plan?.name} · ends {subscription.endDate}
                      </p>
                    </div>
                    <Badge
                      variant={
                        (subscription.daysRemaining ?? 0) <= 3 ? "destructive" : "outline"
                      }
                      className="shrink-0"
                    >
                      {subscription.daysRemaining} days
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-500" />
              Recent collections
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/platform/payments">
                All <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {payments.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (payments.data?.data.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No payments recorded yet.
              </p>
            ) : (
              <ul className="divide-y">
                {payments.data?.data.map((payment) => (
                  <li key={payment.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {payment.subscription?.company?.name ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {payment.method} · {formatDate(payment.paidAt)} ·{" "}
                        {payment.collectedBy?.name ?? "—"}
                      </p>
                    </div>
                    <span className="font-semibold tabular-nums shrink-0">₹{payment.amount}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
