"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyAccountsApi, type MoneyAccount } from "@/lib/api/money-accounts";
import { NativeSelect } from "@/components/ui/select-native";

/** The shop's active money accounts. One cached query for every picker. */
export function useMoneyAccounts() {
  return useQuery({ queryKey: ["money-accounts", "active"], queryFn: () => moneyAccountsApi.list(true) });
}

/**
 * Which cash / bank / UPI account money came into or went out of.
 *
 * Blank means "the main Cash or Bank account, by payment method" - exactly
 * what the app did before there could be more than one of each, so a shop with
 * one cash box and one bank never has to touch this.
 */
export function MoneyAccountSelect({
  id,
  value,
  onChange,
  emptyLabel = "Main Cash / Bank (by method)",
  allowEmpty = true,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  allowEmpty?: boolean;
}) {
  const accounts = useMoneyAccounts();
  const items = accounts.data ?? [];
  const group = (kind: MoneyAccount["kind"]) => items.filter((a) => a.kind === kind);

  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={accounts.isLoading}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : <option value="">Choose an account</option>}
      {(["CASH", "BANK"] as const).map((kind) =>
        group(kind).length > 0 ? (
          <optgroup key={kind} label={kind === "CASH" ? "Cash" : "Bank & UPI"}>
            {group(kind).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </NativeSelect>
  );
}
