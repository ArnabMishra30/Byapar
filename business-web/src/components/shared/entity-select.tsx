"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { customersApi, suppliersApi, productsApi } from "@/lib/api";
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
}

const LOADERS: Record<EntityKind, (search: string, productKind?: "ITEM" | "ALL") => Promise<Option[]>> = {
  customer: async (search) => {
    const { items } = await customersApi.list({ limit: 20, search: search || undefined, isActive: "true" });
    return items.map((c) => ({ id: c.id, label: c.name, sublabel: c.phone ?? undefined }));
  },
  supplier: async (search) => {
    const { items } = await suppliersApi.list({ limit: 20, search: search || undefined, isActive: "true" });
    return items.map((s) => ({ id: s.id, label: s.name, sublabel: s.phone ?? undefined }));
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

const TITLES: Record<EntityKind, string> = {
  customer: "Choose customer",
  supplier: "Choose supplier",
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
  const { can } = useAuth();
  const canAdd = kind === "customer" ? can("customers.create") : kind === "supplier" && can("parties.manage");

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
          if (!next) setAdding(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{adding ? `Add new ${kind}` : TITLES[kind]}</DialogTitle>
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
              {search.trim() ? `Add "${search.trim()}" as a new ${kind}` : `Add new ${kind}`}
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
                {options.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(option.id, option.label);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{option.label}</span>
                        {option.sublabel ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.sublabel}
                          </span>
                        ) : null}
                      </span>
                      {value === option.id ? <Check className="h-4 w-4 text-primary" /> : null}
                    </button>
                  </li>
                ))}
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
