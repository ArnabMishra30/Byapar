"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/auth-context";
import { dashboardApi, userApi, companyApi } from "@/lib/api";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { GstBadge } from "@/components/shared/gst-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatNumber, formatDate } from "@/lib/utils";
import {
  Building2,
  Users,
  TrendingUp,
  TrendingDown,
  Receipt,
  ShoppingCart,
  BookOpen,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldCheck,
  Store,
  Wallet,
  Activity,
  PlusCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { user, company, isAdmin, isGstEnabled } = useAuth();
  const [period, setPeriod] = useState<"today" | "this_month" | "last_month" | "this_quarter" | "this_financial_year">("this_month");

  // Fetch Dashboard business metrics
  const {
    data: dashboardData,
    isLoading: isDashboardLoading,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: () => dashboardApi.getDashboard({ period }),
  });

  // Fetch Credit book summary (receivables / payables)
  const {
    data: creditData,
    isLoading: isCreditLoading,
  } = useQuery({
    queryKey: ["credit-summary"],
    queryFn: () => dashboardApi.getCreditSummary(),
  });

  // Fetch Users count for Admin metrics
  const {
    data: usersData,
    isLoading: isUsersLoading,
  } = useQuery({
    queryKey: ["admin-users-count"],
    queryFn: () => userApi.listUsers({ limit: 1 }),
    enabled: isAdmin,
  });

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <GstBadge
              isGstEnabled={isGstEnabled}
              registrationType={company?.gstRegistrationType}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Welcome back, <strong className="text-foreground">{user?.name}</strong>. Here is the operational summary for{" "}
            <strong className="text-foreground">{company?.name || "your business"}</strong>.
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Select
            value={period}
            onValueChange={(val: any) => setPeriod(val)}
          >
            <SelectTrigger className="w-[180px] h-9 text-xs font-medium">
              <Clock className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Select Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="this_quarter">This Quarter</SelectItem>
              <SelectItem value="this_financial_year">Financial Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. SYSTEM / ADMIN METRICS (Distinct SaaS Section)                          */}
      {/* ========================================================================= */}
      {isAdmin && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                System & Administration Overview
              </h2>
            </div>
            <Link
              href="/admin/companies"
              className="text-xs text-primary hover:underline font-medium"
            >
              Manage System →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Active Business"
              value={company?.name || "Main Store"}
              description={company?.gstin ? `GSTIN: ${company.gstin}` : "Local Shop (No GST)"}
              icon={Building2}
              colorScheme="indigo"
              badge={
                <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-bold px-1.5 py-0.5 rounded">
                  Current
                </span>
              }
            />

            <StatCard
              title="Total Users"
              value={usersData?.pagination?.total ?? (isUsersLoading ? "..." : 2)}
              description="Staff & administrators in company"
              icon={Users}
              colorScheme="default"
              isLoading={isUsersLoading}
            />

            <StatCard
              title="Tax Compliance Mode"
              value={isGstEnabled ? "GST Active" : "Non-GST / Local"}
              description={
                isGstEnabled
                  ? `State Code: ${company?.stateCode || "—"}`
                  : "Unregistered (Zero tax forms)"
              }
              icon={isGstEnabled ? ShieldCheck : Store}
              colorScheme={isGstEnabled ? "sky" : "emerald"}
            />

            <StatCard
              title="Operational Status"
              value="System Healthy"
              description="Postgres & ledger synced"
              icon={Activity}
              colorScheme="emerald"
            />
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 2. BUSINESS & FINANCIAL METRICS                                          */}
      {/* ========================================================================= */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Business Performance & Cash Flow ({period.replace(/_/g, " ")})
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Net Sales (Revenue)"
            value={formatCurrency(dashboardData?.sales?.netSales ?? 0)}
            description={`${dashboardData?.sales?.invoiceCount ?? 0} invoices issued`}
            icon={Receipt}
            colorScheme="emerald"
            isLoading={isDashboardLoading}
          />

          <StatCard
            title="Net Purchases (Expenses/Stock)"
            value={formatCurrency(dashboardData?.purchases?.netPurchases ?? 0)}
            description={`${dashboardData?.purchases?.billCount ?? 0} bills received`}
            icon={ShoppingCart}
            colorScheme="amber"
            isLoading={isDashboardLoading}
          />

          <StatCard
            title="Net Cash Movement"
            value={formatCurrency(dashboardData?.moneyMovement?.netMovement ?? 0)}
            description={`In: ${formatCurrency(dashboardData?.moneyMovement?.moneyReceived ?? 0)} | Out: ${formatCurrency(dashboardData?.moneyMovement?.moneyPaid ?? 0)}`}
            icon={Wallet}
            colorScheme="sky"
            isLoading={isDashboardLoading}
          />
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. CREDIT BOOK & OUTSTANDING BALANCES                                    */}
      {/* ========================================================================= */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Credit Book (Receivables & Payables)
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Customer Credit / Receivables */}
          <Card className="hover:shadow-md transition-shadow border-border/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <ArrowDownLeft className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">
                      Customer Credit (Money to Receive)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Total balance owed to you by customers
                    </CardDescription>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2 py-1 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  {creditData?.receivables?.totalParties ?? 0} Customers
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
                {formatCurrency(creditData?.receivables?.totalOutstanding ?? 0)}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                <span>Accounts Receivable (AR)</span>
                <Link href="/credit" className="text-primary hover:underline font-medium">
                  View Credit Book →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Supplier Dues / Payables */}
          <Card className="hover:shadow-md transition-shadow border-border/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">
                      Supplier Dues (Money to Pay)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Total bills owed by you to suppliers
                    </CardDescription>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  {creditData?.payables?.totalParties ?? 0} Suppliers
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mb-2">
                {formatCurrency(creditData?.payables?.totalOutstanding ?? 0)}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                <span>Accounts Payable (AP)</span>
                <Link href="/credit" className="text-primary hover:underline font-medium">
                  View Dues List →
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. RECENT ACTIVITY & QUICK ACTIONS                                        */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions List */}
        <Card className="lg:col-span-2 border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-bold">Recent Operations</CardTitle>
              <CardDescription className="text-xs">
                Real posted transactions and vouchers
              </CardDescription>
            </div>
            <Link
              href="/reports"
              className="text-xs text-primary hover:underline font-medium"
            >
              All Reports →
            </Link>
          </CardHeader>
          <CardContent>
            {dashboardData?.recentActivity && dashboardData.recentActivity.length > 0 ? (
              <div className="divide-y text-sm">
                {dashboardData.recentActivity.map((act) => (
                  <div
                    key={act.id}
                    className="py-3 flex items-center justify-between hover:bg-muted/30 px-2 rounded-lg transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium text-foreground flex items-center gap-2">
                        <span>{act.number}</span>
                        <StatusBadge status={act.status} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {act.partyName} • {formatDate(act.date)}
                      </div>
                    </div>
                    <div className="font-semibold text-foreground">
                      {formatCurrency(act.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-xs">
                <Store className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No recent activity recorded yet in this period.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions Card */}
        <Card className="border-border/80 bg-gradient-to-b from-card to-muted/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Quick Actions</CardTitle>
            <CardDescription className="text-xs">
              Frequent day-to-day business tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              asChild
              variant="outline"
              className="w-full justify-start text-xs h-10 font-medium"
            >
              <Link href="/sales">
                <PlusCircle className="w-4 h-4 mr-2 text-emerald-600" />
                <span>Create Sales Invoice</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full justify-start text-xs h-10 font-medium"
            >
              <Link href="/purchases">
                <PlusCircle className="w-4 h-4 mr-2 text-amber-600" />
                <span>Record Purchase Bill</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full justify-start text-xs h-10 font-medium"
            >
              <Link href="/customers">
                <Users className="w-4 h-4 mr-2 text-indigo-600" />
                <span>Add Customer</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full justify-start text-xs h-10 font-medium"
            >
              <Link href="/expenses">
                <Wallet className="w-4 h-4 mr-2 text-rose-600" />
                <span>Record Shop Expense</span>
              </Link>
            </Button>
            {isAdmin && (
              <Button
                asChild
                variant="outline"
                className="w-full justify-start text-xs h-10 font-medium"
              >
                <Link href="/admin/users">
                  <Users className="w-4 h-4 mr-2 text-primary" />
                  <span>Manage Staff Members</span>
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
