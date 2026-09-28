"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, customersApi, suppliersApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, NotFoundState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/form-parts";
import { Can } from "@/components/shared/permission-gate";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { INDIAN_STATES, ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { toFormValues } from "@/features/customers/party-rules";
import { PartyForm } from "./party-form";
import { useCreditRows, type PartyKind } from "./party-credit";
import { CreditTab, HistoryTab, PaymentsTab, StatementTab } from "./party-tabs";

/**
 * One customer or supplier: what they owe, every bill and payment, their open
 * bills and a printable statement.
 *
 * The balance comes from the party's sub-ledger via the /outstanding endpoint,
 * credit terms and overdue from /credit, per-bill paid and due from the
 * registers. Nothing is added up here.
 */

const CONFIG = {
  customer: {
    api: customersApi,
    backHref: ROUTES.customers,
    backLabel: "Customers",
    owesLabel: "Owes you",
    advanceLabel: "Advance they have with you",
    historyLabel: "Sales",
  },
  supplier: {
    api: suppliersApi,
    backHref: ROUTES.suppliers,
    backLabel: "Suppliers",
    owesLabel: "You owe",
    advanceLabel: "Advance you have paid them",
    historyLabel: "Purchases",
  },
} as const;

interface Outstanding {
  totalSales?: string;
  totalPurchases?: string;
  totalPayments: string;
  totalReturns: string;
  outstandingAmount: string;
  unallocatedCredit?: string;
}

interface CustomerCredit {
  terms: { creditLimit: string; isUnlimited: boolean; creditDays: number | null };
  position: { outstanding: string; availableCredit: string | null; isOverLimit: boolean; openInvoiceCount: number };
  overdue: { amount: string; invoiceCount: number; daysPastDue: number | null };
}

const TABS = ["history", "payments", "credit", "statement"] as const;
type TabValue = (typeof TABS)[number];

export function PartyDetail({ kind, id }: { kind: PartyKind; id: string }) {
  const config = CONFIG[kind];
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const requested = searchParams?.get("tab") as TabValue | null;
  const [tab, setTab] = React.useState<TabValue>(requested && TABS.includes(requested) ? requested : "history");
  const [editOpen, setEditOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);

  const party = useQuery({ queryKey: [kind, id], queryFn: () => config.api.get(id) });

  const outstanding = useQuery({
    queryKey: [kind, id, "outstanding"],
    queryFn: () => config.api.outstanding(id) as unknown as Promise<Outstanding>,
  });

  const customerCredit = useQuery({
    queryKey: ["customer", id, "credit"],
    queryFn: () => customersApi.credit(id) as unknown as Promise<CustomerCredit>,
    enabled: kind === "customer",
  });

  // Suppliers have no /credit endpoint; the credit book row carries overdue.
  const supplierRows = useCreditRows("supplier", kind === "supplier");
  const supplierRow = kind === "supplier" ? supplierRows.byId.get(id) : undefined;

  const setStatus = useMutation({
    mutationFn: (isActive: boolean) => config.api.setStatus(id, isActive),
    onSuccess: (saved) => {
      toast.success(saved.isActive ? `${saved.name} is active again` : `${saved.name} is now inactive`);
      setStatusOpen(false);
      queryClient.invalidateQueries({ queryKey: [kind] });
    },
    onError: (err) => {
      setStatusOpen(false);
      toast.error("Could not change status", { description: err instanceof ApiError ? err.message : undefined });
    },
  });

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
      <Link href={config.backHref}>
        <ArrowLeft className="h-4 w-4" />
        {config.backLabel}
      </Link>
    </Button>
  );

  if (party.isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (party.error || !party.data) {
    const notFound = party.error instanceof ApiError && party.error.status === 404;
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <NotFoundState description={`This ${kind} does not exist, or belongs to another business.`} />
        ) : (
          <ErrorState error={party.error} onRetry={() => party.refetch()} />
        )}
      </div>
    );
  }

  const record = party.data;
  const balance = outstanding.data?.outstandingAmount;
  const isAdvance = balance != null && Number(balance) < 0;
  const stateName = INDIAN_STATES.find((state) => state.code === record.stateCode)?.name;

  const newDocHref =
    kind === "customer" ? `${ROUTES.newSale}?customerId=${id}` : `${ROUTES.newPurchase}?supplierId=${id}`;
  const payHref =
    kind === "customer" ? `${ROUTES.moneyReceived}?customerId=${id}` : `${ROUTES.moneyPaid}?supplierId=${id}`;

  return (
    <div className="space-y-6">
      {back}

      <PageHeader
        title={record.name}
        description={record.phone || record.email || undefined}
        actions={
          <div className="flex items-center gap-2" data-print-hide>
            {!record.isActive ? <StatusBadge status="INACTIVE" /> : null}
            <Can do="parties.manage">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)} aria-label="Edit">
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            </Can>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* The number a shop owner opened this page for. */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdvance ? config.advanceLabel : config.owesLabel}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {outstanding.isLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : outstanding.error ? (
              <ErrorState error={outstanding.error} onRetry={() => outstanding.refetch()} />
            ) : (
              <>
                <p className="text-3xl font-bold tabular sm:text-4xl">
                  {/* The backend sends a negative balance for an advance. The
                      label above says so; the figure is shown as sent. */}
                  <Money value={balance} className={isAdvance ? "text-success" : Number(balance) > 0 ? "text-warning" : ""} />
                </p>
                <PaidDue
                  total={kind === "customer" ? outstanding.data?.totalSales : outstanding.data?.totalPurchases}
                  paid={outstanding.data?.totalPayments}
                  due={isAdvance ? null : balance}
                />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {outstanding.data && Number(outstanding.data.totalReturns) !== 0 ? (
                    <span>
                      Returns: <Money value={outstanding.data.totalReturns} />
                    </span>
                  ) : null}
                  {kind === "customer" && customerCredit.data ? (
                    <>
                      {Number(customerCredit.data.overdue.amount) > 0 ? (
                        <span className="font-medium text-destructive">
                          Overdue: <Money value={customerCredit.data.overdue.amount} /> on{" "}
                          {customerCredit.data.overdue.invoiceCount} invoice
                          {customerCredit.data.overdue.invoiceCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      <span>
                        Credit limit:{" "}
                        {customerCredit.data.terms.isUnlimited ? (
                          "No limit"
                        ) : (
                          <Money value={customerCredit.data.terms.creditLimit} />
                        )}
                      </span>
                      {customerCredit.data.position.availableCredit != null ? (
                        <span>
                          Can still buy on credit: <Money value={customerCredit.data.position.availableCredit} />
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {supplierRow && Number(supplierRow.overdue) > 0 ? (
                    <span className="font-medium text-destructive">
                      Overdue: <Money value={supplierRow.overdue} /> on {supplierRow.overdueCount} bill
                      {supplierRow.overdueCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                {customerCredit.data?.position.isOverLimit ? (
                  <Badge variant="destructive">Over credit limit</Badge>
                ) : null}
              </>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-print-hide>
              <Can do={kind === "customer" ? "sales.draft" : "purchases.draft"}>
                <Button asChild className="min-h-[44px] gap-1.5">
                  <Link href={newDocHref}>
                    <Plus className="h-4 w-4" />
                    {kind === "customer" ? "New sale" : "New purchase"}
                  </Link>
                </Button>
              </Can>
              <Can do={kind === "customer" ? "money.receive" : "money.pay"}>
                <Button asChild variant="outline" className="min-h-[44px] gap-1.5">
                  <Link href={payHref}>
                    {kind === "customer" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    {kind === "customer" ? "Record payment" : "Pay supplier"}
                  </Link>
                </Button>
              </Can>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Details</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <DetailRow label="Phone">
              {record.phone ? (
                <a href={`tel:${record.phone}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                  <Phone className="h-3.5 w-3.5" />
                  {record.phone}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Email">
              {record.email ? (
                <a href={`mailto:${record.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-primary">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  {record.email}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Address">
              {record.address ? (
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {record.address}
                </span>
              ) : (
                "—"
              )}
            </DetailRow>
            {record.gstin ? <DetailRow label="GSTIN">{record.gstin}</DetailRow> : null}
            {stateName ? <DetailRow label="State">{stateName}</DetailRow> : null}
            <DetailRow label="Payment days">
              {record.creditDays == null ? "—" : `${record.creditDays} days`}
            </DetailRow>
            {record.createdAt ? <DetailRow label="Added on">{formatDate(record.createdAt)}</DetailRow> : null}
            <Can do="parties.manage">
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 min-h-[44px] w-full gap-1.5 text-muted-foreground"
                onClick={() => setStatusOpen(true)}
                data-print-hide
              >
                <Power className="h-4 w-4" />
                {record.isActive ? `Make ${kind} inactive` : `Make ${kind} active`}
              </Button>
            </Can>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" data-print-hide>
          <TabsList>
            <TabsTrigger value="history">{config.historyLabel}</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="credit">Pending bills</TabsTrigger>
            <TabsTrigger value="statement">Statement</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="history" className="mt-4">
          <HistoryTab kind={kind} id={id} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab kind={kind} id={id} />
        </TabsContent>
        <TabsContent value="credit" className="mt-4">
          <CreditTab kind={kind} id={id} />
        </TabsContent>
        <TabsContent value="statement" className="mt-4">
          <StatementTab kind={kind} id={id} name={record.name} />
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {kind}</DialogTitle>
            <DialogDescription>Changes apply to new bills. Posted bills keep what they were posted with.</DialogDescription>
          </DialogHeader>
          {editOpen ? (
            <PartyForm
              kind={kind}
              mode="update"
              initial={toFormValues(record)}
              save={(body) => config.api.update(id, body)}
              onCancel={() => setEditOpen(false)}
              onSaved={(saved) => {
                toast.success(`${saved.name} saved`);
                setEditOpen(false);
                queryClient.invalidateQueries({ queryKey: [kind] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title={record.isActive ? `Make ${record.name} inactive?` : `Make ${record.name} active?`}
        confirmLabel={record.isActive ? "Make inactive" : "Make active"}
        destructive={record.isActive}
        isPending={setStatus.isPending}
        onConfirm={() => setStatus.mutate(!record.isActive)}
        description={
          record.isActive
            ? `They will no longer appear when you pick a ${kind} for a new bill. Their history, balance and statement stay exactly as they are, and you can make them active again at any time.`
            : `They will appear again when you pick a ${kind} for a new bill.`
        }
      />
    </div>
  );
}
