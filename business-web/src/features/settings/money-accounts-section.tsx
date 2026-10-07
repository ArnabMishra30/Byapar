"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Check, IdCard, Landmark, Loader2, Pencil, Plus, Power, X } from "lucide-react";
import { toast } from "sonner";
import { moneyAccountsApi, type MoneyAccount, type MoneyAccountDetails } from "@/lib/api/money-accounts";
import {
  EMPTY_DETAILS,
  MoneyAccountDetailsDialog,
  MoneyAccountDetailsFields,
  accountReference,
  detailsError,
} from "./money-account-details-dialog";
import { stripBodyPrefix, toInputDate } from "@/lib/utils";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Cash, bank and UPI accounts: every place the shop's money sits.
 *
 * Each is a real account in the books. Expenses, money received and money paid
 * choose one, so each balance here is exactly what the ledger says.
 */
export function MoneyAccountsSection() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["money-accounts", "all"], queryFn: () => moneyAccountsApi.list() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["money-accounts"] });
  const onError = (error: Error) => toast.error(stripBodyPrefix(error.message));

  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"CASH" | "BANK">("BANK");
  const [opening, setOpening] = React.useState("");
  // Bank / UPI details are optional; shown only when asked for.
  const [details, setDetails] = React.useState<MoneyAccountDetails>(EMPTY_DETAILS);
  const [showDetails, setShowDetails] = React.useState(false);
  const [detailsFor, setDetailsFor] = React.useState<MoneyAccount | null>(null);
  const [addError, setAddError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      moneyAccountsApi.create({
        name: name.trim(),
        kind,
        ...(opening.trim() ? { openingBalance: opening.trim(), openingDate: toInputDate() } : {}),
        ...(kind === "BANK" && showDetails
          ? {
              bankName: details.bankName.trim(),
              accountNumber: details.accountNumber.trim(),
              ifsc: details.ifsc.trim().toUpperCase(),
              upiId: details.upiId.trim(),
              holderName: details.holderName.trim(),
            }
          : {}),
      }),
    onSuccess: (account) => {
      toast.success(`${account.name} added`);
      setName("");
      setOpening("");
      setDetails(EMPTY_DETAILS);
      setShowDetails(false);
      setAddError(null);
      refresh();
    },
    onError,
  });

  const toggle = useMutation({
    mutationFn: (account: MoneyAccount) => moneyAccountsApi.update(account.id, { isActive: !account.isActive }),
    onSuccess: (saved) => {
      toast.success(saved.isActive ? `${saved.name} is in use again` : `${saved.name} switched off`);
      refresh();
    },
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cash, bank &amp; UPI accounts</CardTitle>
        <CardDescription>
          Every place your money is kept - cash drawer, each bank, PhonePe / UPI. Expenses and payments choose one,
          so each balance stays right.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {accounts.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {(accounts.data ?? []).map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                onToggle={() => toggle.mutate(account)}
                onSaved={refresh}
                onDetails={() => setDetailsFor(account)}
              />
            ))}
          </ul>
        )}

        <Can do="settings.manage">
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim().length < 2) return;
              const problem = kind === "BANK" && showDetails ? detailsError(details) : null;
              setAddError(problem);
              if (!problem) create.mutate();
            }}
          >
            <Input aria-label="Account name" placeholder="e.g. SBI Current, PhonePe" value={name} onChange={(e) => setName(e.target.value)} />
            <NativeSelect aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as "CASH" | "BANK")}>
              <option value="BANK">Bank / UPI</option>
              <option value="CASH">Cash</option>
            </NativeSelect>
            <Input
              aria-label="Money in it today"
              inputMode="decimal"
              placeholder="Balance today ₹"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
            <Button type="submit" className="min-h-[44px] gap-1.5 sm:min-h-0" disabled={name.trim().length < 2 || create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
          {kind === "BANK" ? (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
                Add UPI ID / bank account number for reference
              </label>
              {showDetails ? <MoneyAccountDetailsFields value={details} onChange={setDetails} kind="BANK" /> : null}
            </div>
          ) : null}
          {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
          <p className="text-xs text-muted-foreground">
            &ldquo;Balance today&rdquo; is what is in the account right now; it is brought into your books as opening money.
          </p>
        </Can>
        <MoneyAccountDetailsDialog account={detailsFor} onClose={() => setDetailsFor(null)} onSaved={refresh} />
      </CardContent>
    </Card>
  );
}

function AccountRow({
  account,
  onToggle,
  onSaved,
  onDetails,
}: {
  account: MoneyAccount;
  onToggle: () => void;
  onSaved: () => void;
  onDetails: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(account.name);
  const save = useMutation({
    mutationFn: () => moneyAccountsApi.update(account.id, { name: name.trim() }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });
  const Icon = account.kind === "CASH" ? Banknote : Landmark;

  return (
    <li className="flex items-center gap-3 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      {editing ? (
        <div className="flex min-w-0 flex-1 gap-2">
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" />
          <Button size="sm" onClick={() => save.mutate()} disabled={name.trim().length < 2 || save.isPending} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {account.name}
              {!account.isActive ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(off)</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {account.kind === "CASH" ? "Cash" : "Bank / UPI"}
              {account.isSystem ? " · main account" : ""}
            </p>
            {accountReference(account) ? (
              <p className="truncate text-xs text-foreground/80">{accountReference(account)}</p>
            ) : null}
          </div>
          <Money value={account.balance} className="shrink-0 font-semibold" />
          <Can do="settings.manage">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${account.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            {account.kind === "BANK" ? (
              <Button size="sm" variant="ghost" onClick={onDetails} aria-label={`Details of ${account.name}`}>
                <IdCard className="h-4 w-4" />
              </Button>
            ) : null}
            {!account.isSystem ? (
              <Button size="sm" variant="ghost" onClick={onToggle} className="text-muted-foreground" aria-label={account.isActive ? "Switch off" : "Switch on"}>
                <Power className="h-4 w-4" />
              </Button>
            ) : null}
          </Can>
        </>
      )}
    </li>
  );
}
