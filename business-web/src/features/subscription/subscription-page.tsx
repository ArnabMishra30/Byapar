"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BookOpen, CalendarDays, CheckCircle2, Clock, Phone } from "lucide-react";
import { subscriptionApi, type Entitlement } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingState, ErrorState } from "@/components/shared/states";
import { DetailRow } from "@/components/shared/form-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const STATUS_LABEL: Record<Entitlement["status"], string> = {
  ACTIVE: "Active",
  EXPIRED: "Ended",
  CANCELLED: "Cancelled",
  NONE: "None",
};

function headline(data: Entitlement): string {
  if (data.isEntitled) return "Your subscription is active";
  if (data.status === "CANCELLED") return "Your subscription was cancelled";
  if (data.status === "NONE") return "No subscription on record";
  return "Your subscription has ended";
}

export function SubscriptionScreen() {
  const query = useQuery({
    queryKey: ["my-subscription"],
    queryFn: () => subscriptionApi.getMine(),
  });

  const data = query.data;
  const active = Boolean(data?.isEntitled);
  // A few days' warning so a renewal can be arranged before posting stops.
  const endingSoon = active && data?.daysRemaining != null && data.daysRemaining <= 7;

  return (
    <div className="space-y-6">
      <PageHeader title="Subscription" description="Your plan, and what it lets you do." />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading || !data ? (
        <LoadingState rows={2} />
      ) : (
        <>
          <Card className={active ? undefined : "border-destructive/30"}>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {active ? (
                    <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-base font-semibold sm:text-lg">{headline(data)}</p>
                    {data.reason && !active ? (
                      <p className="text-sm text-muted-foreground">{data.reason}</p>
                    ) : null}
                  </div>
                </div>
                <Badge variant={active ? "success" : "destructive"} className="shrink-0">
                  {STATUS_LABEL[data.status] ?? data.status}
                </Badge>
              </div>

              {active && data.daysRemaining !== null ? (
                <div
                  className={
                    endingSoon
                      ? "mt-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
                      : "mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
                  }
                >
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    {data.daysRemaining === 0
                      ? "Ends today."
                      : `${data.daysRemaining} day${data.daysRemaining === 1 ? "" : "s"} remaining.`}
                    {endingSoon ? " Contact your representative to renew in time." : ""}
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
                Plan details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DetailRow label="Plan">{data.plan ?? "—"}</DetailRow>
              {data.startDate ? <DetailRow label="Started">{formatDate(data.startDate)}</DetailRow> : null}
              <DetailRow label={active ? "Renews or ends" : "Ended"}>{formatDate(data.endDate)}</DetailRow>
            </CardContent>
          </Card>

          {!active ? (
            <>
              {/* THE REASSURANCE, first. Nothing has been taken away. */}
              <Card>
                <CardContent className="flex items-start gap-3 p-4 sm:p-6">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Your records are safe and still yours</p>
                    <p className="text-muted-foreground">
                      Nothing has been deleted. You can still open every sale, purchase, bill and ledger you have
                      recorded, and run, print or download every report. What has stopped is{" "}
                      <span className="font-medium text-foreground">recording new business</span> &mdash; new
                      sales, purchases, expenses and payments.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex items-start gap-3 p-4 sm:p-6">
                  <Phone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="space-y-2 text-sm">
                    <p className="font-medium">How to get access back</p>
                    <p className="text-muted-foreground">
                      Contact your sales representative or administrator to renew. They can reactivate this business
                      straight away &mdash; you do not need to do anything in the app.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Renewals are arranged directly with your representative; there is no online payment in this
                      application.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button variant="outline" asChild>
                  <Link href={ROUTES.salesReport}>
                    View your reports
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={ROUTES.dashboard}>Back to home</Link>
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
