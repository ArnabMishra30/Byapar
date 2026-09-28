"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileText,
  Loader2,
  Package,
  Search,
  ShoppingCart,
  Truck,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { customersApi, productsApi, purchasesApi, salesApi, suppliersApi } from "@/lib/api";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { useAuth } from "@/lib/auth/auth-context";
import { visibleSections } from "./nav-items";
import { NavIcon } from "./nav-icon";
import { cn } from "@/lib/utils";

/**
 * The global search / command menu. Ctrl+K (Cmd+K on a Mac) or "/" opens it.
 *
 * Pages and quick actions are matched locally - they are this app's own menu.
 * Records are found by asking the backend: each list endpoint's own `search`
 * filter, five results per kind, only once two characters are typed. Nothing
 * is downloaded in bulk to search through.
 */

interface Result {
  id: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
  icon?: LucideIcon;
  navIcon?: Parameters<typeof NavIcon>[0]["name"];
}

const PER_KIND = 5;

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Keys typed into a field belong to the field, not to the shortcut. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "/" && !mod && !isTyping(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-10 w-10 justify-center px-0 text-muted-foreground sm:w-64 sm:justify-start sm:px-3"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 text-left font-normal sm:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          Ctrl K
        </kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[10%] max-w-xl translate-y-0 gap-0 p-0 sm:top-[15%]">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Find a page, customer, supplier, product, invoice or purchase.
          </DialogDescription>
          {open ? <CommandBody onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CommandBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { isAdmin, isGstEnabled } = useAuth();
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const term = useDebounced(query.trim());
  const searching = term.length >= 2;

  const pages: Result[] = React.useMemo(() => {
    const actions: Result[] = [
      { id: "a-quick", group: "Actions", label: "Quick Billing", hint: "Make a bill fast", href: ROUTES.quickBilling, icon: Zap },
      { id: "a-sale", group: "Actions", label: "New sale", href: ROUTES.newSale, icon: FileText },
      { id: "a-purchase", group: "Actions", label: "New purchase", href: ROUTES.newPurchase, icon: ShoppingCart },
    ];
    const nav: Result[] = visibleSections(isAdmin, isGstEnabled).flatMap((section) =>
      section.items.map((item) => ({
        id: `p-${item.href}`,
        group: "Pages",
        label: item.title,
        hint: section.title,
        href: item.href,
        navIcon: item.icon,
      })),
    );
    const all = [...actions, ...nav];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 10);
    return all.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) || entry.hint?.toLowerCase().includes(q),
    );
  }, [query, isAdmin, isGstEnabled]);

  const records = useQuery({
    queryKey: ["command-search", term],
    enabled: searching,
    staleTime: 30_000,
    queryFn: async (): Promise<Result[]> => {
      const params = { search: term, limit: PER_KIND };
      const settle = <T,>(p: Promise<{ items: T[] }>) => p.then((r) => r.items).catch(() => [] as T[]);
      const [customers, suppliers, products, sales, purchases] = await Promise.all([
        settle(customersApi.list(params)),
        settle(suppliersApi.list(params)),
        settle(productsApi.list(params)),
        settle(salesApi.list(params)),
        settle(purchasesApi.list(params)),
      ]);
      return [
        ...customers.map((c) => ({
          id: `c-${c.id}`, group: "Customers", label: c.name, hint: c.phone ?? undefined,
          href: DETAIL_ROUTES.customer(c.id), icon: UserCheck,
        })),
        ...suppliers.map((s) => ({
          id: `s-${s.id}`, group: "Suppliers", label: s.name, hint: s.phone ?? undefined,
          href: DETAIL_ROUTES.supplier(s.id), icon: Truck,
        })),
        ...products.map((p) => ({
          id: `pr-${p.id}`, group: "Products", label: p.name, hint: p.sku ?? undefined,
          href: DETAIL_ROUTES.product(p.id), icon: Package,
        })),
        ...sales.map((s) => ({
          id: `sa-${s.id}`, group: "Sales invoices", label: s.invoiceNumber || "Draft sale",
          hint: s.customer?.name, href: DETAIL_ROUTES.sale(s.id), icon: FileText,
        })),
        ...purchases.map((p) => ({
          id: `pu-${p.id}`, group: "Purchases", label: p.purchaseNumber || p.invoiceNumber || "Draft purchase",
          hint: p.supplier?.name, href: DETAIL_ROUTES.purchase(p.id), icon: ShoppingCart,
        })),
      ];
    },
  });

  const results = React.useMemo(
    () => [...pages, ...(searching ? records.data ?? [] : [])],
    [pages, searching, records.data],
  );

  React.useEffect(() => setCursor(0), [query, records.data]);

  const go = (result: Result | undefined) => {
    if (!result) return;
    onDone();
    router.push(result.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[cursor]);
    }
  };

  let lastGroup = "";

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customers, products, invoices, pages…"
          aria-label="Search"
          className="h-14 w-full bg-transparent pr-8 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        />
        {records.isFetching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      <ul className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Results">
        {results.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            {searching && records.isFetching ? "Searching…" : "Nothing found. Try another word."}
          </li>
        ) : (
          results.map((result, index) => {
            const heading = result.group !== lastGroup ? result.group : null;
            lastGroup = result.group;
            const Icon = result.icon;
            return (
              <React.Fragment key={result.id}>
                {heading ? (
                  <li className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {heading}
                  </li>
                ) : null}
                <li role="option" aria-selected={index === cursor}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(result)}
                    className={cn(
                      "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                      index === cursor ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    {result.navIcon ? (
                      <NavIcon name={result.navIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : Icon ? (
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{result.label}</span>
                    {result.hint ? (
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {result.hint}
                      </span>
                    ) : null}
                    {index === cursor ? <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  </button>
                </li>
              </React.Fragment>
            );
          })
        )}
      </ul>
      <p className="hidden border-t px-4 py-2 text-[11px] text-muted-foreground sm:block">
        ↑ ↓ to move · Enter to open · Esc to close
      </p>
    </div>
  );
}
