"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { moneyAccountsApi } from "@/lib/api/money-accounts";
import { MoneyAccountSelect } from "@/components/shared/money-account-select";
import { Can } from "@/components/shared/permission-gate";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, toInputDate } from "@/lib/utils";

/**
 * Moving money between the shop's own accounts: cash deposited in the bank,
 * UPI wallet to bank... Recorded as one balanced entry, so every balance stays
 * true; nothing is an income or an expense.
 */
export function TransferSection() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [undoId, setUndoId] = React.useState<string | null>(null);
  const transfers = useQuery({ queryKey: ["money-accounts", "transfers"], queryFn: () => moneyAccountsApi.transfers() });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["money-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["cash-bank"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  const undo = useMutation({
    mutationFn: (id: string) => moneyAccountsApi.reverseTransfer(id),
    onSuccess: () => {
      toast.success("Transfer undone");
      setUndoId(null);
      refresh();
    },
    onError: (err) => {
      setUndoId(null);
      toast.error(err instanceof ApiError ? err.message : "Could not undo");
    },
  });

  const recent = (transfers.data ?? []).slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Transfers between your accounts</CardTitle>
        <Can do="money.pay">
          <Button size="sm" className="min-h-[40px] gap-1.5" onClick={() => setOpen(true)}>
            <ArrowRightLeft className="h-4 w-4" />
            Transfer
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="pt-0">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transfers yet. e.g. cash deposited in the bank.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${t.isReversed ? "line-through text-muted-foreground" : ""}`}>
                    {t.from?.name} → {t.to?.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.date)} · {t.number}
                    {t.isReversed ? " · undone" : ""}
                  </p>
                </div>
                <Money value={t.amount} className="shrink-0 font-semibold" />
                {!t.isReversed ? (
                  <Can do="settings.manage">
                    <Button size="sm" variant="ghost" aria-label="Undo transfer" onClick={() => setUndoId(t.id)}>
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  </Can>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <TransferDialog open={open} onOpenChange={setOpen} onDone={refresh} />
      <ConfirmDialog
        open={undoId !== null}
        onOpenChange={(next) => (!next ? setUndoId(null) : undefined)}
        title="Undo this transfer?"
        confirmLabel="Undo"
        destructive
        isPending={undo.isPending}
        onConfirm={() => undoId && undo.mutate(undoId)}
        description="The money goes back to the account it came from. The original stays in history, marked undone."
      />
    </Card>
  );
}

/** A v4 UUID for transfer idempotency, with a fallback where crypto is absent. */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function TransferDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(toInputDate());
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // One idempotency key per intended transfer: it survives a double-click or a
  // retry so the backend records the transfer once, and is cleared after a
  // success (and on reopen) so the NEXT transfer gets its own key. See M2.
  const idempotencyKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFrom("");
      setTo("");
      setAmount("");
      setDate(toInputDate());
      setNotes("");
      setError(null);
      idempotencyKeyRef.current = null;
    }
  }, [open]);

  const save = useMutation({
    mutationFn: (idempotencyKey: string) =>
      moneyAccountsApi.transfer({ fromAccountId: from, toAccountId: to, amount: amount.trim(), date, notes: notes.trim() || null, idempotencyKey }),
    onSuccess: () => {
      idempotencyKeyRef.current = null;
      toast.success("Transfer recorded");
      onDone();
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record the transfer"),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!from || !to) return setError("Choose both accounts");
    if (from === to) return setError("Choose two different accounts");
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) return setError("Enter an amount");
    setError(null);
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey();
    save.mutate(idempotencyKeyRef.current);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move money between accounts</DialogTitle>
          <DialogDescription>e.g. cash deposited in SBI, or PhonePe balance sent to the bank.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="tr-from">From</Label>
            <MoneyAccountSelect id="tr-from" value={from} onChange={setFrom} allowEmpty={false} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-to">To</Label>
            <MoneyAccountSelect id="tr-to" value={to} onChange={setTo} allowEmpty={false} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="tr-amount">Amount (₹)</Label>
              <Input id="tr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-date">Date</Label>
              <Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-notes">Note (optional)</Label>
            <Input id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Deposit slip 4471" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending} className="min-h-[44px] sm:min-h-0">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Record transfer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
