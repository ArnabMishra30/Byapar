"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Phone,
} from "lucide-react";
import { subscriptionApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingState, ErrorState } from "@/components/shared/states";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * "What is happening to my subscription?"
 *
 * WHAT THIS PAGE IS CAREFUL ABOUT. A shopkeeper who has lost the ability to
 * record sales is having a bad day, and a screen that just says NO makes it
 * worse. So it says three things plainly:
 *
 *   what stopped        recording NEW business
 *   what did NOT stop   every record they already have, and every report
 *   what to do          contact whoever sold them the subscription
 *
 * There is no self-service renewal here because there is no payment gateway in
 * this product. Pretending otherwise with a dead "Pay now" button would be worse
 * than saying who to call.
 */
export function SubscriptionScreen() {
  const query = useQuery({
    queryKey: ["my-subscription"],
    queryFn: () => subscriptionApi.getMine(),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={query.refetch} />;
  }

  const data = query.data!;
  const active = data.isEntitled;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription"
        description="Your access to this application."
      />

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {active ? (
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
              )}
              <div>
                <p className="text-lg font-semibold">
                  {active
                    ? "Your subscription is active"
                    : data.status === "CANCELLED"
                      ? "Your subscription was cancelled"
                      : data.status === "NONE"
                        ? "No subscription on record"
                        : "Your subscription has ended"}
                </p>
                {data.plan && (
                  <p className="text-sm text-muted-foreground">
                    {data.plan}
                    {data.endDate ? ` · until ${data.endDate}` : ""}
                  </p>
                )}
              </div>
            </div>

            <Badge variant={active ? "success" : "destructive"} className="shrink-0">
              {data.status}
            </Badge>
          </div>

          {active && data.daysRemaining !== null && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                {data.daysRemaining === 0
                  ? "Ends today."
                  : `${data.daysRemaining} day${data.daysRemaining === 1 ? "" : "s"} remaining.`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {!active && (
        <>
          {/* THE REASSURANCE, first. Nothing has been taken away. */}
          <Card>
            <CardContent className="flex items-start gap-3 pt-6">
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">Your records are safe and still yours</p>
                <p className="text-muted-foreground">
                  Nothing has been deleted. You can still open every sale, purchase, bill and
                  ledger you have recorded, run every report, and export your data. What has
                  stopped is <span className="font-medium text-foreground">recording new
                  business</span> &mdash; new sales, purchases, expenses and payments.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-start gap-3 pt-6">
              <Phone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-2 text-sm">
                <p className="font-medium">How to get access back</p>
                <p className="text-muted-foreground">
                  Contact your sales representative or administrator to renew. They can reactivate
                  this business straight away &mdash; you do not need to do anything in the app.
                </p>
                <p className="text-xs text-muted-foreground">
                  Renewals are arranged directly with your representative; there is no online
                  payment in this application.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/shop/reports">
                View your reports
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/shop/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
