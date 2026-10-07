"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { moneyAccountsApi, type MoneyAccount, type MoneyAccountDetails } from "@/lib/api/money-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const EMPTY_DETAILS: MoneyAccountDetails = {
  bankName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",
  holderName: "",
};

/** Problems with the reference details, before sending them. */
export function detailsError(d: MoneyAccountDetails): string | null {
  if (d.accountNumber && !/^\d{6,18}$/.test(d.accountNumber.trim())) return "An account number is 6 to 18 digits";
  if (d.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(d.ifsc.trim())) return "An IFSC looks like SBIN0001234";
  if (d.upiId && !/^[\w.-]{2,}@[a-zA-Z][a-zA-Z0-9.]{1,}$/.test(d.upiId.trim())) return "A UPI ID looks like shopname@ybl";
  return null;
}

/** The fields, shared by "add account" and "edit details". */
export function MoneyAccountDetailsFields({
  value,
  onChange,
  kind,
}: {
  value: MoneyAccountDetails;
  onChange: (next: MoneyAccountDetails) => void;
  kind: "CASH" | "BANK";
}) {
  const set = (key: keyof MoneyAccountDetails) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.value });

  if (kind === "CASH") {
    return <p className="text-sm text-muted-foreground">A cash account has no bank details.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="ma-upi">UPI ID</Label>
        <Input id="ma-upi" placeholder="e.g. shopname@ybl" value={value.upiId} onChange={set("upiId")} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ma-bank">Bank name</Label>
        <Input id="ma-bank" placeholder="e.g. State Bank of India" value={value.bankName} onChange={set("bankName")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ma-holder">Account holder</Label>
        <Input id="ma-holder" value={value.holderName} onChange={set("holderName")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ma-number">Account number</Label>
        <Input id="ma-number" inputMode="numeric" value={value.accountNumber} onChange={set("accountNumber")} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ma-ifsc">IFSC</Label>
        <Input id="ma-ifsc" className="uppercase" placeholder="e.g. SBIN0001234" value={value.ifsc} onChange={set("ifsc")} autoComplete="off" />
      </div>
    </div>
  );
}

/** Edit an account's reference details (owner only). */
export function MoneyAccountDetailsDialog({
  account,
  onClose,
  onSaved,
}: {
  account: MoneyAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = React.useState<MoneyAccountDetails>(EMPTY_DETAILS);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (account) {
      setValue({
        bankName: account.bankName ?? "",
        accountNumber: account.accountNumber ?? "",
        ifsc: account.ifsc ?? "",
        upiId: account.upiId ?? "",
        holderName: account.holderName ?? "",
      });
      setError(null);
    }
  }, [account]);

  const save = useMutation({
    mutationFn: () =>
      moneyAccountsApi.update(account!.id, {
        bankName: value.bankName.trim(),
        accountNumber: value.accountNumber.trim(),
        ifsc: value.ifsc.trim().toUpperCase(),
        upiId: value.upiId.trim(),
        holderName: value.holderName.trim(),
      }),
    onSuccess: () => {
      toast.success("Details saved");
      onSaved();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save"),
  });

  return (
    <Dialog open={account !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account?.name} - details</DialogTitle>
          <DialogDescription>For reference: who to pay, and where money comes in. Leave blank what you do not need.</DialogDescription>
        </DialogHeader>
        {account ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const problem = detailsError(value);
              if (problem) return setError(problem);
              save.mutate();
            }}
          >
            <MoneyAccountDetailsFields value={value} onChange={setValue} kind={account.kind} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {account.kind === "BANK" ? (
                <Button type="submit" disabled={save.isPending} className="min-h-[44px] sm:min-h-0">
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save details
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** One line under the account name: "SBI · ••••2145 · SBIN0001234 · shop@ybl". */
export function accountReference(account: MoneyAccount): string | null {
  const parts = [
    account.bankName,
    account.accountNumberMasked,
    account.ifsc,
    account.upiId ? `UPI ${account.upiId}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
