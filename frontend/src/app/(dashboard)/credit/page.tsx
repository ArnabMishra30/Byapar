"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/shared/stat-card";
import { formatCurrency } from "@/lib/utils";
import { BookOpen, ArrowDownLeft, ArrowUpRight, Users, Truck } from "lucide-react";

export default function CreditBookPage() {
  const { data: creditSummary, isLoading } = useQuery({
    queryKey: ["credit-summary"],
    queryFn: () => dashboardApi.getCreditSummary(),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <BookOpen className="w-7 h-7 text-primary" />
          <span>Credit Book (Customer Credit & Supplier Dues)</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          Simple shopkeeper credit tracking — easily view who owes you money and who you owe.
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Customer Credit (Receivables)"
          value={formatCurrency(creditSummary?.receivables?.totalOutstanding ?? 0)}
          description={`${creditSummary?.receivables?.totalParties ?? 0} customers with outstanding balance`}
          icon={ArrowDownLeft}
          colorScheme="emerald"
          isLoading={isLoading}
        />

        <StatCard
          title="Supplier Dues (Payables)"
          value={formatCurrency(creditSummary?.payables?.totalOutstanding ?? 0)}
          description={`${creditSummary?.payables?.totalParties ?? 0} suppliers with unpaid bills`}
          icon={ArrowUpRight}
          colorScheme="amber"
          isLoading={isLoading}
        />

        <StatCard
          title="Net Credit Position"
          value={formatCurrency(creditSummary?.netPosition ?? 0)}
          description="Customer credit minus supplier dues"
          icon={BookOpen}
          colorScheme="indigo"
          isLoading={isLoading}
        />
      </div>

      {/* Explanatory Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              <span>Customer Credit (Udhaar Diya)</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Every posted sales invoice increases what a customer owes. Payments and sales returns reduce it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              Credit terms set on each customer automatically calculate invoice due dates for aging reports and overdue reminders.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Truck className="w-4 h-4 text-amber-600" />
              <span>Supplier Dues (Udhaar Liya)</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Every posted purchase bill raises a payable. Payments allocated to bills reduce the outstanding balance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              Advance payments made to suppliers remain securely tracked as advances until allocated to future bills.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
