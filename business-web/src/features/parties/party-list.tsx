"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { customersApi, suppliersApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTabs } from "@/components/shared/module-tabs";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PartyForm } from "./party-form";
import { CreditBadge, useCreditRows, type PartyKind } from "./party-credit";
import type { Customer } from "@/types/api";

export type { PartyKind };

/**
 * Customers and suppliers are the same screen.
 *
 * The backend models them identically - same fields, same credit terms, same
 * ledger and statement endpoints - so one component serves both, with the
 * words swapped. "Owes you" and "You owe" are read from the credit book, row
 * by row; this page adds nothing up.
 */
const CONFIG = {
  customer: {
    title: "Customers",
    description: "Everyone you sell to, and what they owe you.",
    singular: "customer",
    addLabel: "Add Customer",
    balanceLabel: "Owes you",
    api: customersApi,
    tabs: [
      { label: "Customers", href: ROUTES.customers },
      { label: "Credit Book", href: ROUTES.creditBook },
    ],
    emptyTitle: "No customers yet",
    emptyDescription: "Add the people you sell to, so you can track who owes you money.",
  },
  supplier: {
    title: "Suppliers",
    description: "Everyone you buy from, and what you owe them.",
    singular: "supplier",
    addLabel: "Add Supplier",
    balanceLabel: "You owe",
    api: suppliersApi,
    tabs: [
      { label: "Suppliers", href: ROUTES.suppliers },
      { label: "Credit Book", href: ROUTES.creditBook },
    ],
    emptyTitle: "No suppliers yet",
    emptyDescription: "Add the people you buy from, so you can track what you owe.",
  },
} as const;

const detailHref = (kind: PartyKind, id: string) =>
  kind === "customer" ? DETAIL_ROUTES.customer(id) : DETAIL_ROUTES.supplier(id);

export function PartyList({ kind }: { kind: PartyKind }) {
  const config = CONFIG[kind];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const list = useListState({ limit: 20 });
  const [active, setActive] = React.useState<"true" | "false" | "">("true");

  // Suppliers are added in a dialog; ?new=1 (from the command menu or another
  // page) opens it straight away. Customers have their own page.
  const [addOpen, setAddOpen] = React.useState(false);
  React.useEffect(() => {
    if (kind === "supplier" && searchParams?.get("new") === "1") setAddOpen(true);
  }, [kind, searchParams]);
  const closeAdd = () => {
    setAddOpen(false);
    if (searchParams?.get("new")) router.replace(pathname ?? ROUTES.suppliers);
  };

  // Debounced so a request does not fire on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(list.search.trim()), 300);
    return () => clearTimeout(timer);
  }, [list.search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [kind, "list", list.page, debouncedSearch, active],
    queryFn: () =>
      config.api.list({
        page: list.page,
        limit: list.limit,
        search: debouncedSearch || undefined,
        isActive: active || undefined,
      }),
  });

  const credit = useCreditRows(kind);

  const owed = (row: Customer) => {
    if (credit.isLoading) return <span className="text-muted-foreground">…</span>;
    const entry = credit.byId.get(row.id);
    if (!entry) return <span className="text-muted-foreground">—</span>;
    return <Money value={entry.outstanding} className="font-semibold" />;
  };

  const columns: Column<Customer>[] = [
    {
      header: "Name",
      cell: (row) => (
        <Link href={detailHref(kind, row.id)} className="font-medium text-foreground hover:text-primary">
          {row.name}
          {!row.isActive ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inactive)</span> : null}
        </Link>
      ),
    },
    { header: "Phone", cell: (row) => row.phone || <span className="text-muted-foreground">—</span> },
    {
      header: "Email",
      hideOnMobile: true,
      cell: (row) => <span className="block max-w-[14rem] truncate">{row.email || "—"}</span>,
    },
    {
      header: "Address",
      hideOnMobile: true,
      cell: (row) => <span className="block max-w-[14rem] truncate text-muted-foreground">{row.address || "—"}</span>,
    },
    { header: config.balanceLabel, numeric: true, cell: owed },
    {
      header: "Credit",
      cell: (row) => (
        <CreditBadge kind={kind} row={credit.byId.get(row.id)} isOverLimit={credit.overLimit.has(row.id)} />
      ),
    },
    {
      header: "Last payment",
      hideOnMobile: true,
      cell: (row) => {
        const last = credit.byId.get(row.id)?.lastPayment;
        return last ? (
          <span className="whitespace-nowrap">{formatDate(last.date)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
  ];

  const addButton = (full = false) =>
    kind === "customer" ? (
      <Button asChild className="gap-1.5">
        <Link href={ROUTES.newCustomer} aria-label={config.addLabel}>
          <Plus className="h-4 w-4" />
          <span className={full ? "" : "hidden sm:inline"}>{config.addLabel}</span>
          {full ? null : <span className="sm:hidden">Add</span>}
        </Link>
      </Button>
    ) : (
      <Button className="gap-1.5" onClick={() => setAddOpen(true)} aria-label={config.addLabel}>
        <Plus className="h-4 w-4" />
        <span className={full ? "" : "hidden sm:inline"}>{config.addLabel}</span>
        {full ? null : <span className="sm:hidden">Add</span>}
      </Button>
    );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          title={config.title}
          description={config.description}
          actions={
            <Can do="parties.manage">
              {kind === "customer" ? (
                <Button asChild variant="outline" className="gap-1.5" aria-label="Bulk upload">
                  <Link href={ROUTES.importCustomers}>
                    <Upload className="h-4 w-4" />
                    <span className="hidden sm:inline">Bulk upload</span>
                  </Link>
                </Button>
              ) : null}
              {addButton()}
            </Can>
          }
        />
        <ModuleTabs tabs={[...config.tabs]} />
      </div>

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={`Search name, phone or email…`}
        filters={
          <NativeSelect
            aria-label="Show"
            className="w-full sm:w-44"
            value={active}
            onChange={(event) => {
              setActive(event.target.value as "true" | "false" | "");
              list.setPage(1);
            }}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </NativeSelect>
        }
        onRowClick={(row) => router.push(detailHref(kind, row.id))}
        mobileCard={(row) => {
          const entry = credit.byId.get(row.id);
          return (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.phone || "No phone"}</p>
                {entry?.lastPayment ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    Last payment {formatDate(entry.lastPayment.date)}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {entry ? <Money value={entry.outstanding} className="text-sm font-semibold" /> : null}
                <CreditBadge kind={kind} row={entry} isOverLimit={credit.overLimit.has(row.id)} />
              </div>
            </div>
          );
        }}
        pagination={
          data?.pagination
            ? {
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
                total: data.pagination.total,
                onPageChange: list.setPage,
              }
            : undefined
        }
        emptyTitle={active === "false" ? `No inactive ${config.singular}s` : config.emptyTitle}
        emptyDescription={active === "false" ? undefined : config.emptyDescription}
        emptyAction={
          active === "false" ? undefined : <Can do="parties.manage">{addButton(true)}</Can>
        }
      />

      {credit.isError ? (
        <p className="text-xs text-muted-foreground">
          Balances could not be loaded just now, so the {config.balanceLabel.toLowerCase()} column is blank.
        </p>
      ) : null}

      {kind === "supplier" ? (
        <Dialog open={addOpen} onOpenChange={(open) => (open ? setAddOpen(true) : closeAdd())}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{config.addLabel}</DialogTitle>
              <DialogDescription>Only the name is needed. Everything else can be added later.</DialogDescription>
            </DialogHeader>
            <PartyForm
              kind="supplier"
              mode="create"
              save={(body) => suppliersApi.create(body)}
              onCancel={closeAdd}
              onSaved={(saved) => {
                toast.success(`${saved.name} added`);
                queryClient.invalidateQueries({ queryKey: ["supplier"] });
                setAddOpen(false);
                router.push(DETAIL_ROUTES.supplier(saved.id));
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
