"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { offersApi, type Offer } from "@/lib/api/offers";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { EntitySelect } from "@/components/shared/entity-select";
import { Can } from "@/components/shared/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { StockTabs } from "@/features/stock/stock-ui";

const qty = (value: string) => String(Number(value));

/**
 * Buy X get Y free.
 *
 * Set up once; every sale that qualifies gets the free item added automatically
 * when it is saved. The free item still leaves stock - only its price is zero.
 */
export function OffersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => offersApi.list() });

  const toggle = useMutation({
    mutationFn: (offer: Offer) => offersApi.setStatus(offer.id, !offer.isActive),
    onSuccess: (saved) => {
      toast.success(saved.isActive ? "Offer switched on" : "Offer switched off");
      queryClient.invalidateQueries({ queryKey: ["offers"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not change the offer"),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          title="Offers"
          description="Buy X, get Y free. The free item is added to the bill automatically and its stock goes out."
          actions={
            <Can do="offers.manage">
              <Button className="min-h-[44px] gap-1.5" onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" />
                New offer
              </Button>
            </Can>
          }
        />
        <StockTabs />
      </div>

      {offers.isLoading ? (
        <LoadingState rows={3} />
      ) : offers.error ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : (offers.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Gift className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No offers yet</p>
            <p className="text-sm text-muted-foreground">e.g. Buy 1 Soap, get 1 Soap free.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {offers.data!.map((offer) => (
            <li key={offer.id}>
              <Card className={offer.isRunning ? "" : "opacity-70"}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-semibold">{offer.name}</p>
                    {offer.isRunning ? (
                      <Badge variant="success">Running</Badge>
                    ) : offer.isActive ? (
                      <Badge variant="secondary">Not in dates</Badge>
                    ) : (
                      <Badge variant="secondary">Off</Badge>
                    )}
                  </div>
                  <p className="text-sm">
                    Buy <strong>{qty(offer.buyQuantity)}</strong> {offer.buyProduct.name} → get{" "}
                    <strong className="text-success">{qty(offer.freeQuantity)}</strong> {offer.freeProduct.name} free
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {offer.startDate || offer.endDate
                      ? `${offer.startDate ? formatDate(offer.startDate) : "Any time"} – ${offer.endDate ? formatDate(offer.endDate) : "no end"}`
                      : "No end date"}
                  </p>
                  <Can do="offers.manage">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 px-0 text-muted-foreground"
                      onClick={() => toggle.mutate(offer)}
                    >
                      <Power className="h-4 w-4" />
                      {offer.isActive ? "Switch off" : "Switch on"}
                    </Button>
                  </Can>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <NewOfferDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewOfferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [buy, setBuy] = React.useState<{ id: string; name: string } | null>(null);
  const [free, setFree] = React.useState<{ id: string; name: string } | null>(null);
  const [sameItem, setSameItem] = React.useState(true);
  const [buyQty, setBuyQty] = React.useState("1");
  const [freeQty, setFreeQty] = React.useState("1");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setBuy(null);
      setFree(null);
      setSameItem(true);
      setBuyQty("1");
      setFreeQty("1");
      setStartDate("");
      setEndDate("");
      setError(null);
    }
  }, [open]);

  const freeItem = sameItem ? buy : free;

  const create = useMutation({
    mutationFn: () =>
      offersApi.create({
        buyProductId: buy!.id,
        buyQuantity: buyQty.trim(),
        freeProductId: freeItem!.id,
        freeQuantity: freeQty.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
      }),
    onSuccess: (offer) => {
      toast.success(`${offer.name} - ready`);
      queryClient.invalidateQueries({ queryKey: ["offers"] });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the offer"),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!buy) return setError("Choose the item they buy");
    if (!freeItem) return setError("Choose the free item");
    if (!(Number(buyQty) > 0) || !(Number(freeQty) > 0)) return setError("Quantities must be more than zero");
    if (startDate && endDate && endDate < startDate) return setError("The offer cannot end before it starts");
    setError(null);
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New offer</DialogTitle>
          <DialogDescription>Added to the bill automatically whenever someone buys enough.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="offer-buy-qty">Buy</Label>
              <Input id="offer-buy-qty" inputMode="decimal" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
            </div>
            <EntitySelect
              kind="product"
              value={buy?.id ?? ""}
              valueLabel={buy?.name}
              placeholder="Item they buy"
              onChange={(id, name) => setBuy({ id, name })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Free item">
            {[
              { value: true, label: "Same item free" },
              { value: false, label: "A different item free" },
            ].map((option) => (
              <label
                key={String(option.value)}
                className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border px-2 text-sm ${
                  sameItem === option.value ? "border-primary bg-primary/5 font-medium ring-1 ring-primary" : ""
                }`}
              >
                <input type="radio" className="sr-only" checked={sameItem === option.value} onChange={() => setSameItem(option.value)} />
                {option.label}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="offer-free-qty">Get free</Label>
              <Input id="offer-free-qty" inputMode="decimal" value={freeQty} onChange={(e) => setFreeQty(e.target.value)} />
            </div>
            {sameItem ? (
              <div className="flex min-h-[40px] items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                {buy?.name ?? "The same item"}
              </div>
            ) : (
              <EntitySelect
                kind="product"
                value={free?.id ?? ""}
                valueLabel={free?.name}
                placeholder="Free item"
                onChange={(id, name) => setFree({ id, name })}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="offer-start">From (optional)</Label>
              <Input id="offer-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-end">Until (optional)</Label>
              <Input id="offer-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {buy && freeItem ? (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">
              Buy {qty(buyQty || "0")} {buy.name} → get {qty(freeQty || "0")} {freeItem.name} free. Buying twice as many
              gives twice the free items.
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending} className="min-h-[44px] sm:min-h-0">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save offer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
