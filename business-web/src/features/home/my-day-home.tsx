"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { billerReportApi } from "@/lib/api/staff";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PersonCard } from "@/features/reports/biller-report";
import { QuickActions } from "./quick-actions";

/**
 * Home for someone who may not see the shop's totals - a cashier, say. Their own
 * day only: how many bills they made and the money they took. Never anyone
 * else's figures and never the shop's.
 */
export function MyDayHome() {
  const { user, company } = useAuth();
  const day = useQuery({ queryKey: ["my-day"], queryFn: () => billerReportApi.myDay() });
  const firstName = user?.name?.trim().split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Hello"}
        description={`${company?.name ?? "Your business"} · ${formatDate(day.data?.date ?? new Date())}`}
      />
      <QuickActions />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Your day</h2>
        {day.isLoading ? (
          <LoadingState rows={2} />
        ) : day.error || !day.data ? (
          <ErrorState error={day.error} onRetry={() => day.refetch()} />
        ) : (
          <PersonCard person={day.data} title="Your sales today" />
        )}
        <Button asChild variant="outline" className="min-h-[44px] gap-1.5">
          <Link href={ROUTES.salesInvoices}>
            <FileText className="h-4 w-4" />
            Your bills
          </Link>
        </Button>
      </section>
    </div>
  );
}
