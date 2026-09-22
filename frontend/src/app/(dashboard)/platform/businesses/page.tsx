"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { platformApi, Business } from "@/lib/api/platform";
import {
  PlatformGuard,
  usePlatformUser,
  PERMISSION,
} from "@/features/platform/permission-guard";
import { OnboardBusinessDialog } from "@/features/platform/onboard-dialog";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { Store, Plus, Phone, MapPin } from "lucide-react";

// THE SHOPS. What a rep sees after a day on the road.

export default function BusinessesPage() {
  return (
    <PlatformGuard>
      <BusinessesContent />
    </PlatformGuard>
  );
}

function BusinessesContent() {
  const { can, isPlatformAdmin } = usePlatformUser();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // A rep defaults to their own shops; an operator sees everything.
  const [scope, setScope] = useState<"all" | "mine">(isPlatformAdmin ? "all" : "mine");
  const [onboardOpen, setOnboardOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "businesses", page, search, scope],
    queryFn: () =>
      platformApi.listBusinesses({
        page,
        limit: 20,
        search: search || undefined,
        mine: scope === "mine" ? true : undefined,
      }),
  });

  const columns: Column<Business>[] = [
    {
      header: "Business",
      cell: (business) => (
        <Link
          href={`/platform/businesses/${business.id}`}
          className="group block"
        >
          <div className="font-medium group-hover:text-primary transition-colors">
            {business.name}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
            {business.ownerName && <span>{business.ownerName}</span>}
            {business.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {business.phone}
              </span>
            )}
          </div>
        </Link>
      ),
    },
    {
      header: "Location",
      cell: (business) =>
        business.city ? (
          <span className="text-sm flex items-center gap-1">
            <MapPin className="w-3 h-3 text-muted-foreground" />
            {business.city}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">&mdash;</span>
        ),
    },
    {
      header: "GST",
      cell: (business) =>
        business.gstEnabled ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {business.gstin ?? "Registered"}
          </Badge>
        ) : (
          // Not a warning. Most small shops are not registered, and the product
          // works perfectly for them.
          <span className="text-xs text-muted-foreground">Not registered</span>
        ),
    },
    {
      header: "Signed up by",
      cell: (business) => (
        <span className="text-sm">{business.onboardedBy?.name ?? "—"}</span>
      ),
    },
    {
      header: "Since",
      cell: (business) => (
        <span className="text-sm tabular-nums">{formatDate(business.createdAt)}</span>
      ),
    },
    {
      header: "Status",
      cell: (business) => <StatusBadge status={business.isActive} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <Store className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
            Businesses
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Every shop on the platform, and who signed it up.
          </p>
        </div>

        {can(PERMISSION.BUSINESS_CREATE) && (
          <Button onClick={() => setOnboardOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Register a business
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={refetch}
        mobileCard={(business) => (
          <Link href={`/platform/businesses/${business.id}`} className="block">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{business.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {business.ownerName ?? "—"}
                  {business.city ? ` · ${business.city}` : ""}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Signed up by {business.onboardedBy?.name ?? "—"}
                </p>
              </div>
              <StatusBadge status={business.isActive} />
            </div>
          </Link>
        )}
        searchable
        searchPlaceholder="Search by name, owner or phone..."
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        filterSlot={
          <Select
            value={scope}
            onValueChange={(value) => {
              setScope(value as "all" | "mine");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All businesses</SelectItem>
              <SelectItem value="mine">Signed up by me</SelectItem>
            </SelectContent>
          </Select>
        }
        pagination={
          data?.pagination ? { ...data.pagination, onPageChange: setPage } : undefined
        }
        emptyTitle={scope === "mine" ? "You have not signed up a shop yet" : "No businesses yet"}
        emptyDescription={
          can(PERMISSION.BUSINESS_CREATE)
            ? "Register your first business to get started."
            : "Nothing matches this filter."
        }
      />

      <OnboardBusinessDialog
        open={onboardOpen}
        onOpenChange={setOnboardOpen}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["platform", "businesses"] });
        }}
      />
    </div>
  );
}
