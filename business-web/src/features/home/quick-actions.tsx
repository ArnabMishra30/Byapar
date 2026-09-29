"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Receipt,
  ShoppingCart,
  Truck,
  UserPlus,
  Zap,
} from "lucide-react";
import { Can } from "@/components/shared/permission-gate";
import { ScanBillCta } from "@/features/bills/scan-bill-cta";
import { useAuth } from "@/lib/auth/auth-context";
import { ROUTES } from "@/lib/constants";
import type { Capability } from "@/lib/permissions";

/**
 * The things a shopkeeper does twenty times a day, one tap away.
 *
 * Each tile is gated on what the role can ACTUALLY do (read off the backend
 * route table): staff can draft a sale, a purchase or a bill, but only an admin
 * can record money in or out, or add a customer or supplier. Showing staff a
 * "Money Received" tile would only walk them into a refusal they cannot fix.
 */
const ACTIONS: {
  label: string;
  href: string;
  icon: React.ElementType;
  capability: Capability;
}[] = [
  { label: "Add Sale", href: ROUTES.newSale, icon: Receipt, capability: "sales.draft" },
  { label: "Add Purchase", href: ROUTES.newPurchase, icon: ShoppingCart, capability: "purchases.draft" },
  { label: "Money Received", href: ROUTES.moneyReceived, icon: ArrowDownLeft, capability: "money.receive" },
  { label: "Money Paid", href: ROUTES.moneyPaid, icon: ArrowUpRight, capability: "money.pay" },
  { label: "Add Customer", href: ROUTES.newCustomer, icon: UserPlus, capability: "parties.manage" },
  // There is no "open the new-supplier form" link in the shared contract, so
  // this goes to the supplier list, where the Add button lives.
  { label: "Add Supplier", href: ROUTES.suppliers, icon: Truck, capability: "parties.manage" },
];

export function QuickActions() {
  const { can } = useAuth();

  return (
    <section className="space-y-3" aria-labelledby="quick-actions-title">
      <h2 id="quick-actions-title" className="text-sm font-semibold text-foreground">
        Quick actions
      </h2>

      {/* The two fast paths get the big tiles, side by side from lg up:
          Quick Billing for a sale at the counter, Scan a Bill for a bill that
          already exists on paper. Stacked on phones and tablets. */}
      <div className="grid gap-2 lg:grid-cols-2">
      <Can do="sales.draft">
        <Link
          href={ROUTES.quickBilling}
          className="flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-xl bg-primary p-4 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
            <Zap className="h-6 w-6" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold sm:text-lg">Quick Billing</span>
            <span className="block truncate text-xs opacity-90 sm:text-sm">
              Make a counter bill in seconds
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 opacity-80" aria-hidden />
        </Link>
      </Can>
      <ScanBillCta />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ACTIONS.map((action) => (
          <Can key={action.label} do={action.capability}>
            <Link
              href={action.href}
              className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-3 text-center shadow-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <action.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-xs font-medium leading-tight">{action.label}</span>
            </Link>
          </Can>
        ))}
      </div>

      {!can("money.receive") ? (
        <p className="text-xs text-muted-foreground">
          Recording money received or paid, and adding customers or suppliers, is done by the shop
          owner. You can make bills and save them as drafts.
        </p>
      ) : null}
    </section>
  );
}
