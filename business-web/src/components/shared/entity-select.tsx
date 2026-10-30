"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { partiesApi, productsApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { QuickAddParty } from "./quick-add-party";

/**
 * Picking a customer, supplier or product.
 *
 * A dialog with a search box rather than a long native select: a shop can have
 * hundreds of customers, and scrolling a dropdown on a phone to find one is
 * unusable. Searching happens on the SERVER, so it works past the first page.
 */
type EntityKind = "customer" | "supplier" | "product";

interface Option {
  id: string;
  label: string;
  sublabel?: string;
  /** For a customer/supplier pick: the party, and its id on THIS side (null when the side does not exist yet). */
  partyId?: string;
  sideId?: string | null;
}

const LOADERS: Record<EntityKind, (search: string, productKind?: "ITEM" | "ALL") => Promise<Option[]>> = {
  // One unified list of people. Whether billing or buying, the shop picks a
  // party; the id the document needs - its customer side for a sale, its
  // supplier side for a purchase - is taken from the party, or created the
  // moment the party is chosen. So every party is pickable everywhere.
  customer: async (search) => {
    const { items } = await partiesApi.list({ limit: 20, search: search || undefined, isActive: "true", relationship: "ALL" });
    return items.map((p) => ({ id: p.id, label: p.name, sublabel: p.phone ?? undefined, partyId: p.id, sideId: p.customerId }));
  },
  supplier: async (search) => {
    const { items } = await partiesApi.list({ limit: 20, search: search || undefined, isActive: "true", relationship: "ALL" });
    return items.map((p) => ({ id: p.id, label: p.name, sublabel: p.phone ?? undefined, partyId: p.id, sideId: p.supplierId }));
  },
  product: async (search, productKind = "ALL") => {
    const { items } = await productsApi.list({ limit: 20, search: search || undefined, isActive: "true", kind: productKind });
    return items.map((p) => ({
      id: p.id,
      label: p.name,
      // A combo says so, and how many its contents' stock allows.
      sublabel: p.isCombo
        ? `Combo · can make ${p.availability?.total ?? 0}`
        : p.sku ?? undefined,
    }));
  },
};

// One unified party: whether the picker is for a sale or a purchase, the shop
// chooses a "party", never a "customer" or "supplier".
const TITLES: Record<EntityKind, string> = {
  customer: "Choose party",
  supplier: "Choose party",
  product: "Choose item",
};

export function EntitySelect({
  kind,
  value,
  valueLabel,
  onChange,
  placeholder,
  disabled,
  invalid,
  productKind = "ALL",
}: {
  kind: EntityKind;
  value?: string | null;
  /** Shown when a value is set, so the label survives without re-fetching. */
  valueLabel?: string | null;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** For products: ITEM leaves combos out (purchases, stock, combo contents). */
  productKind?: "ITEM" | "ALL";
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  // Adding a customer / supplier right here, without leaving the bill.
  const [adding, setAdding] = React.useState(false);
  // While a picked party is being resolved to the id this side needs (and that
  // side created if it does not exist yet): the option id in flight, and any error.
  const [resolving, setResolving] = React.useState<string | null>(null);
  const [selectError, setSelectError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canAdd = kind === "customer" ? can("customers.create") : kind === "supplier" && can("parties.manage");
  // A party when picking who to bill or buy from; an item when picking a product.
  const noun = kind === "product" ? "item" : "party";

  // Debounced so typing does not fire a request per keystroke.
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: options, isLoading } = useQuery({
    queryKey: [kind, "options", debounced, productKind],
    queryFn: () => LOADERS[kind](debounced, productKind),
    enabled: open,
  });

  const close = () => {
    setOpen(false);
    setSearch("");
    setSelectError(null);
    setResolving(null);
  };

  // Picking a party resolves the id the document needs. When the party has no
  // such side yet - a customer being bought from, a supplier being sold to -
  // that side is created now; the backend allows it for anyone who may add a
  // party. The two sub-ledgers stay separate; this only makes the party usable.
  const choose = async (option: Option) => {
    if (kind === "product") {
      onChange(option.id, option.label);
      close();
      return;
    }
    let sideId = option.sideId ?? null;
    if (!sideId && option.partyId) {
      try {
        setResolving(option.id);
        setSelectError(null);
        const role = kind === "customer" ? "CUSTOMER" : "SUPPLIER";
        const updated = await partiesApi.addRelationship(option.partyId, role);
        sideId = kind === "customer" ? updated.customerId : updated.supplierId;
        queryClient.invalidateQueries({ queryKey: ["parties"] });
        queryClient.invalidateQueries({ queryKey: [kind] });
      } catch (err) {
        setSelectError(err instanceof ApiError ? err.message : "Could not use that party. Please try again.");
        setResolving(null);
        return;
      }
      setResolving(null);
    }
    if (!sideId) {
      setSelectError("Could not use that party.");
      return;
    }
    onChange(sideId, option.label);
    close();
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-invalid={invalid}
        className={cn(
          // 44px on a phone: this picker is tapped constantly at a counter.
          "min-h-[44px] w-full justify-between font-normal sm:min-h-0",
          !value && "text-muted-foreground",
          invalid && "border-destructive",
        )}
      >
        <span className="truncate">{valueLabel || placeholder || TITLES[kind]}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setAdding(false);
            setSelectError(null);
            setResolving(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{adding ? `Add new ${noun}` : TITLES[kind]}</DialogTitle>
          </DialogHeader>

          {adding && kind !== "product" ? (
            <QuickAddParty
              kind={kind}
              initialName={search.trim()}
              onCancel={() => setAdding(false)}
              onCreated={(id, label) => {
                onChange(id, label);
                setAdding(false);
                setOpen(false);
                setSearch("");
              }}
            />
          ) : (
          <>
          {canAdd ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full justify-start gap-2 border-dashed text-primary"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-4 w-4" />
              {search.trim() ? `Add "${search.trim()}" as a new ${noun}` : `Add new ${noun}`}
            </Button>
          ) : null}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="pl-9"
            />
          </div>

          {selectError ? (
            <p className="text-xs text-destructive" role="alert">{selectError}</p>
          ) : null}

          <div className="-mx-1 max-h-72 overflow-y-auto px-1">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !options || options.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {search ? "Nothing matched that search." : "Nothing to choose from yet."}
              </p>
            ) : (
              <ul className="space-y-1">
                {options.map((option) => {
                  // A party is "selected" when the stored id matches its side id;
                  // a product, when it matches the option id itself.
                  const selected =
                    kind === "product" ? value === option.id : value != null && value === option.sideId;
                  const busy = resolving === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        disabled={resolving !== null}
                        onClick={() => void choose(option)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{option.label}</span>
                          {option.sublabel ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {option.sublabel}
                            </span>
                          ) : null}
                        </span>
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : selected ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
