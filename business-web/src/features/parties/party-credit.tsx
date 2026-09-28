"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { creditApi, creditBookApi, type CreditPartyRow } from "@/lib/api";

/**
 * The credit position of every party, for joining onto the master list.
 *
 * The customer and supplier LIST endpoints carry no balances - they are master
 * data. The credit book does (one row per party that has anything open), so
 * the list pages fetch it once and look each party up by id. Every figure
 * shown comes from these rows as the backend sent it.
 */
export type PartyKind = "customer" | "supplier";

export function useCreditRows(kind: PartyKind, enabled = true) {
  const rows = useQuery({
    queryKey: ["credit", kind === "customer" ? "customers" : "suppliers"],
    queryFn: () => (kind === "customer" ? creditBookApi.customers() : creditBookApi.suppliers()),
    enabled,
  });

  // Only customers have a credit limit the backend enforces.
  const exposure = useQuery({
    queryKey: ["credit", "exposure"],
    queryFn: () => creditApi.exposure(),
    enabled: enabled && kind === "customer",
  });

  const byId = new Map<string, CreditPartyRow>();
  for (const row of (kind === "customer" ? rows.data?.customers : rows.data?.suppliers) ?? []) {
    byId.set(row.partyId, row);
  }

  const overLimit = new Set<string>();
  const exposureRows = (exposure.data?.customers ?? []) as { customerId?: string; isOverLimit?: boolean }[];
  for (const row of exposureRows) {
    if (row.isOverLimit && row.customerId) overLimit.add(row.customerId);
  }

  return {
    byId,
    overLimit,
    isLoading: rows.isLoading,
    isError: rows.isError,
    summary: rows.data?.summary,
  };
}

/**
 * One word for where a party stands, in the order that matters most:
 * over the limit, then late, then simply owing, then nothing open.
 */
export function CreditBadge({
  row,
  isOverLimit,
  kind,
}: {
  row?: CreditPartyRow;
  isOverLimit?: boolean;
  kind: PartyKind;
}) {
  if (isOverLimit) return <Badge variant="destructive">Over limit</Badge>;
  if (row?.isOverdue) return <Badge variant="destructive">Overdue</Badge>;
  // A row exists only when the backend has an open bill for this party.
  if (row && Number(row.outstanding) !== 0) {
    return <Badge variant="warning">{kind === "customer" ? "Pending" : "To pay"}</Badge>;
  }
  return <Badge variant="outline">Clear</Badge>;
}
