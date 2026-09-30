"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, partiesApi, type PartyDetail } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, NotFoundState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/form-parts";
import { Can } from "@/components/shared/permission-gate";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntitySelect } from "@/components/shared/entity-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DETAIL_ROUTES, INDIAN_STATES, ROUTES } from "@/lib/constants";
import { HistoryTab, PaymentsTab, StatementTab } from "@/features/parties/party-tabs";
import { PartyMasterForm } from "./party-master-form";
import { RelationshipBadge } from "./relationship-badge";
import { EMPTY_PARTY_FORM, toUpdatePayload, type PartyFormValues } from "./party-payload";

type Side = "customer" | "supplier";

function toFormValues(party: PartyDetail): PartyFormValues {
  return {
    ...EMPTY_PARTY_FORM,
    relationship: party.relationship === "NONE" ? "CUSTOMER" : party.relationship,
    name: party.name,
    phone: party.phone ?? "",
    alternatePhone: party.alternatePhone ?? "",
    email: party.email ?? "",
    contactPerson: party.contactPerson ?? "",
    address: party.address ?? "",
    city: party.city ?? "",
    stateCode: party.stateCode ?? "",
    pincode: party.pincode ?? "",
    gstin: party.gstin ?? "",
    pan: party.pan ?? "",
    notes: party.notes ?? "",
    customerCreditDays: party.customer?.creditDays != null ? String(party.customer.creditDays) : "",
    customerCreditLimit: party.customer && !party.customer.isUnlimited ? party.customer.creditLimit : "",
    supplierCreditDays: party.supplier?.creditDays != null ? String(party.supplier.creditDays) : "",
  };
}

/**
 * One party, both sides.
 *
 * The customer card and the supplier card each show their own balance, from
 * their own ledger. They are never added together or netted: what a party
 * owes you and what you owe them stay two separate numbers until somebody
 * actually settles one against the other.
 */
export function PartyProfile({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [linkSide, setLinkSide] = React.useState<Side | null>(null);
  const [savingEdit, setSavingEdit] = React.useState(false);

  const query = useQuery({ queryKey: ["parties", id], queryFn: () => partiesApi.get(id) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["parties"] });
    queryClient.invalidateQueries({ queryKey: ["customer"] });
    queryClient.invalidateQueries({ queryKey: ["supplier"] });
  };

  const addSide = useMutation({
    mutationFn: (side: Side) => partiesApi.addRelationship(id, side === "customer" ? "CUSTOMER" : "SUPPLIER"),
    onSuccess: (saved, side) => {
      toast.success(`${saved.name} is now a ${side} too`);
      refresh();
    },
    onError: (err) => toast.error("Could not add", { description: err instanceof ApiError ? err.message : undefined }),
  });

  const setStatus = useMutation({
    mutationFn: (isActive: boolean) => partiesApi.setStatus(id, isActive),
    onSuccess: (saved) => {
      toast.success(saved.isActive ? `${saved.name} is active again` : `${saved.name} is now inactive`);
      setStatusOpen(false);
      refresh();
    },
    onError: (err) => {
      setStatusOpen(false);
      toast.error("Could not change status", { description: err instanceof ApiError ? err.message : undefined });
    },
  });

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
      <Link href={ROUTES.parties}>
        <ArrowLeft className="h-4 w-4" />
        Parties
      </Link>
    </Button>
  );

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (query.error || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <NotFoundState description="This party does not exist, or belongs to another business." />
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        )}
      </div>
    );
  }

  const party = query.data;
  const stateName = INDIAN_STATES.find((state) => state.code === party.stateCode)?.name;

  const tabs: { value: string; label: string; content: React.ReactNode }[] = [];
  if (party.customerId) {
    tabs.push({ value: "sales", label: "Sales", content: <HistoryTab kind="customer" id={party.customerId} /> });
  }
  if (party.supplierId) {
    tabs.push({ value: "purchases", label: "Purchases", content: <HistoryTab kind="supplier" id={party.supplierId} /> });
  }
  if (party.customerId) {
    tabs.push({ value: "received", label: "Money received", content: <PaymentsTab kind="customer" id={party.customerId} /> });
  }
  if (party.supplierId) {
    tabs.push({ value: "paid", label: "Money paid", content: <PaymentsTab kind="supplier" id={party.supplierId} /> });
  }
  if (party.customerId) {
    tabs.push({
      value: "customer-statement",
      label: party.supplierId ? "Customer statement" : "Statement",
      content: <StatementTab kind="customer" id={party.customerId} name={party.name} />,
    });
  }
  if (party.supplierId) {
    tabs.push({
      value: "supplier-statement",
      label: party.customerId ? "Supplier statement" : "Statement",
      content: <StatementTab kind="supplier" id={party.supplierId} name={party.name} />,
    });
  }

  return (
    <div className="space-y-6">
      {back}

      <PageHeader
        title={party.name}
        description={[party.contactPerson, party.phone].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <RelationshipBadge relationship={party.relationship} />
            {!party.isActive ? <StatusBadge status="INACTIVE" /> : null}
            <Can do="parties.manage">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)} aria-label="Edit">
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            </Can>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SideCard
          side="customer"
          party={party}
          onAdd={() => addSide.mutate("customer")}
          onLink={() => setLinkSide("customer")}
          adding={addSide.isPending && addSide.variables === "customer"}
        />
        <SideCard
          side="supplier"
          party={party}
          onAdd={() => addSide.mutate("supplier")}
          onLink={() => setLinkSide("supplier")}
          adding={addSide.isPending && addSide.variables === "supplier"}
        />

        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contact</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <DetailRow label="Mobile">
              {party.phone ? (
                <a href={`tel:${party.phone}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                  <Phone className="h-3.5 w-3.5" />
                  {party.phone}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            {party.alternatePhone ? <DetailRow label="Other mobile">{party.alternatePhone}</DetailRow> : null}
            <DetailRow label="Email">
              {party.email ? (
                <a href={`mailto:${party.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-primary">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  {party.email}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Address">
              {party.address || party.city || stateName ? (
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {[party.address, party.city, stateName, party.pincode].filter(Boolean).join(", ")}
                </span>
              ) : (
                "—"
              )}
            </DetailRow>
            {party.gstin ? <DetailRow label="GSTIN">{party.gstin}</DetailRow> : null}
            {party.pan ? <DetailRow label="PAN">{party.pan}</DetailRow> : null}
            {party.notes ? <DetailRow label="Notes">{party.notes}</DetailRow> : null}
            <Can do="parties.manage">
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 min-h-[44px] w-full gap-1.5 text-muted-foreground"
                onClick={() => setStatusOpen(true)}
                data-print-hide
              >
                <Power className="h-4 w-4" />
                {party.isActive ? "Make party inactive" : "Make party active"}
              </Button>
            </Can>
          </CardContent>
        </Card>
      </div>

      {tabs.length > 0 ? (
        <Tabs defaultValue={tabs[0].value}>
          <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" data-print-hide>
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-4">
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit party</DialogTitle>
            <DialogDescription>
              Changes apply to both sides and to new bills. Bills already recorded keep their amounts.
            </DialogDescription>
          </DialogHeader>
          {editOpen ? (
            <PartyMasterForm
              mode="update"
              initial={toFormValues(party)}
              sides={{ isCustomer: party.isCustomer, isSupplier: party.isSupplier }}
              pending={savingEdit}
              submitLabel="Save"
              onCancel={() => setEditOpen(false)}
              onSubmit={async (values) => {
                setSavingEdit(true);
                try {
                  const saved = await partiesApi.update(
                    id,
                    toUpdatePayload(values, { isCustomer: party.isCustomer, isSupplier: party.isSupplier }),
                  );
                  toast.success(`${saved.name} saved`);
                  setEditOpen(false);
                  refresh();
                } catch (err) {
                  toast.error("Could not save", { description: err instanceof ApiError ? err.message : undefined });
                } finally {
                  setSavingEdit(false);
                }
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <LinkDialog
        partyId={id}
        side={linkSide}
        onClose={() => setLinkSide(null)}
        onLinked={() => {
          setLinkSide(null);
          refresh();
        }}
      />

      <ConfirmDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title={party.isActive ? `Make ${party.name} inactive?` : `Make ${party.name} active?`}
        confirmLabel={party.isActive ? "Make inactive" : "Make active"}
        destructive={party.isActive}
        isPending={setStatus.isPending}
        onConfirm={() => setStatus.mutate(!party.isActive)}
        description={
          party.isActive
            ? "They will no longer appear when you pick a customer or supplier for a new bill. Their history, balances and statements stay exactly as they are."
            : "They will appear again when you pick a customer or supplier for a new bill."
        }
      />
    </div>
  );
}

function SideCard({
  side,
  party,
  onAdd,
  onLink,
  adding,
}: {
  side: Side;
  party: PartyDetail;
  onAdd: () => void;
  onLink: () => void;
  adding: boolean;
}) {
  const isCustomer = side === "customer";
  const data = isCustomer ? party.customer : party.supplier;
  const roleId = isCustomer ? party.customerId : party.supplierId;
  const title = isCustomer ? "As a customer" : "As a supplier";

  if (!data || !roleId) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isCustomer
              ? "Not a customer yet. Make them one to sell to them."
              : "Not a supplier yet. Make them one to buy from them."}
          </p>
          <Can do="parties.manage">
            <div className="grid grid-cols-1 gap-2">
              <Button variant="outline" className="min-h-[44px] gap-1.5" onClick={onAdd} disabled={adding}>
                <Plus className="h-4 w-4" />
                {isCustomer ? "Make them a customer too" : "Make them a supplier too"}
              </Button>
              <Button variant="ghost" className="min-h-[44px] gap-1.5 text-muted-foreground" onClick={onLink}>
                <Link2 className="h-4 w-4" />
                {isCustomer ? "Already a customer? Link the record" : "Already a supplier? Link the record"}
              </Button>
            </div>
          </Can>
        </CardContent>
      </Card>
    );
  }

  const balance = isCustomer ? party.customer!.receivable : party.supplier!.payable;
  const isAdvance = Number(balance) < 0;
  const label = isCustomer
    ? isAdvance
      ? "Advance they have with you"
      : "Owes you"
    : isAdvance
      ? "Advance you have paid them"
      : "You owe";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Link
          href={isCustomer ? DETAIL_ROUTES.customer(roleId) : DETAIL_ROUTES.supplier(roleId)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          data-print-hide
        >
          Full account <ExternalLink className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tabular sm:text-3xl">
            <Money
              value={balance}
              className={isAdvance ? "text-success" : Number(balance) > 0 ? (isCustomer ? "text-success" : "text-warning") : ""}
            />
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {Number(data.overdue) > 0 ? (
            <span className="font-medium text-destructive">
              Overdue: <Money value={data.overdue} /> on {data.overdueCount} {isCustomer ? "invoice" : "bill"}
              {data.overdueCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span>Nothing overdue</span>
          )}
          {isCustomer ? (
            <span>
              Credit limit: {data.isUnlimited ? "No limit" : <Money value={data.creditLimit} />}
            </span>
          ) : null}
          {data.creditDays != null ? <span>{data.creditDays} days to pay</span> : null}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-print-hide>
          <Can do={isCustomer ? "sales.draft" : "purchases.draft"}>
            <Button asChild className="min-h-[44px] gap-1.5">
              <Link href={isCustomer ? `${ROUTES.newSale}?customerId=${roleId}` : `${ROUTES.newPurchase}?supplierId=${roleId}`}>
                <Plus className="h-4 w-4" />
                {isCustomer ? "New sale" : "New purchase"}
              </Link>
            </Button>
          </Can>
          <Can do={isCustomer ? "money.receive" : "money.pay"}>
            <Button asChild variant="outline" className="min-h-[44px] gap-1.5">
              <Link href={isCustomer ? `${ROUTES.moneyReceived}?customerId=${roleId}` : `${ROUTES.moneyPaid}?supplierId=${roleId}`}>
                {isCustomer ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                {isCustomer ? "Receive money" : "Pay supplier"}
              </Link>
            </Button>
          </Can>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The explicit merge: "this supplier record is the same business as this party".
 * The record keeps its id, so its bills and payments are untouched.
 */
function LinkDialog({
  partyId,
  side,
  onClose,
  onLinked,
}: {
  partyId: string;
  side: Side | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [recordId, setRecordId] = React.useState("");
  const [label, setLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRecordId("");
    setLabel(null);
  }, [side]);

  const link = useMutation({
    mutationFn: () =>
      partiesApi.link(partyId, side === "customer" ? { customerId: recordId } : { supplierId: recordId }),
    onSuccess: (saved) => {
      toast.success(`Linked to ${saved.name}`);
      onLinked();
    },
    onError: (err) => toast.error("Could not link", { description: err instanceof ApiError ? err.message : undefined }),
  });

  return (
    <Dialog open={side !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link an existing {side}</DialogTitle>
          <DialogDescription>
            Use this when the same business was added twice. Its bills, payments and balance stay exactly as they are;
            it simply becomes this party&apos;s {side} side. It takes this party&apos;s name.
          </DialogDescription>
        </DialogHeader>
        {side ? (
          <EntitySelect
            kind={side}
            value={recordId}
            valueLabel={label}
            onChange={(id, text) => {
              setRecordId(id);
              setLabel(text);
            }}
            placeholder={`Choose a ${side}`}
          />
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} className="min-h-[44px] sm:min-h-0">
            Cancel
          </Button>
          <Button onClick={() => link.mutate()} disabled={!recordId || link.isPending} className="min-h-[44px] sm:min-h-0">
            Link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
