import {
  BarChart3,
  BookOpen,
  Boxes,
  Camera,
  Landmark,
  LayoutDashboard,
  Receipt,
  ScanLine,
  ShoppingCart,
  Store,
  Truck,
  UserCheck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A product preview drawn in CSS, not a screenshot.
 *
 * It mirrors the REAL dashboard - the same four "today" figures, the same
 * sidebar names, the same scan-a-bill card - so a visitor who signs up finds
 * what they were shown. There are no trend percentages, because the product
 * does not show any.
 *
 * The figures are sample data and are marked as such, both visibly and for
 * screen readers. The drawing itself is aria-hidden: a screen reader should hear
 * "illustration", not a list of rupee amounts that belong to nobody.
 */

const SIDEBAR = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Receipt, label: "Sales" },
  { icon: ShoppingCart, label: "Purchases" },
  { icon: Boxes, label: "Stock" },
  { icon: UserCheck, label: "Customers" },
  { icon: Truck, label: "Suppliers" },
  { icon: BookOpen, label: "Credit Book" },
  { icon: Wallet, label: "Expenses" },
  { icon: Landmark, label: "Cash & Bank" },
  { icon: BarChart3, label: "Reports" },
];

const STATS = [
  { label: "Sales today", value: "₹12,450", hint: "8 bills" },
  { label: "Expenses today", value: "₹1,230", hint: "3 entries" },
  { label: "Money received", value: "₹8,500", hint: "5 receipts" },
  { label: "Money paid", value: "₹2,300", hint: "2 payments" },
];

const ACTIONS = [
  { icon: Receipt, label: "New sale" },
  { icon: ShoppingCart, label: "New purchase" },
  { icon: Wallet, label: "Add expense" },
  { icon: ScanLine, label: "Scan bill" },
];

function MiniStat({ label, value, hint, compact }: (typeof STATS)[number] & { compact?: boolean }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-2 sm:p-2.5">
      <p className={cn("truncate text-muted-foreground", compact ? "text-[8px]" : "text-[10px]")}>{label}</p>
      <p className={cn("mt-0.5 font-bold tabular-nums text-foreground", compact ? "text-[11px]" : "text-sm")}>
        {value}
      </p>
      <p className={cn("truncate text-muted-foreground", compact ? "text-[7px]" : "text-[9px]")}>{hint}</p>
    </div>
  );
}

export function DashboardPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-[34rem] lg:max-w-none">
      <figcaption className="sr-only">
        Illustration of the dashboard, showing sample figures.
      </figcaption>

      <div aria-hidden className="relative pb-6 lg:pb-10">
        {/* ---------- desktop window ---------- */}
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl shadow-primary/10 lg:mr-20">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Store className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-xs font-semibold text-foreground">Demo Kirana Store</span>
            </div>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
              DS
            </span>
          </div>

          <div className="flex">
            {/* Hidden at lg, where the hero is two half-width columns and the
                card is too narrow for a sidebar; back at xl. */}
            <aside className="hidden w-32 shrink-0 space-y-0.5 border-r border-border/70 bg-muted/30 p-2 sm:block lg:hidden xl:block">
              {SIDEBAR.map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px]",
                    item.active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </div>
              ))}
            </aside>

            {/*
              lg:pr-20 reserves the strip the phone sits over. The phone is w-40
              and the card has lg:mr-20, so it overlaps the card by exactly 80px
              - the width of this padding. It layers over empty card, never over
              text. Without this it cut figures mid-word ("₹1,23...").
            */}
            <div className="min-w-0 flex-1 p-3 sm:p-4 lg:pr-20">
              <p className="text-sm font-bold text-foreground">Good morning!</p>
              <p className="text-[10px] text-muted-foreground">Here is your business today.</p>

              {/* The scan CTA, exactly where the real dashboard puts it. */}
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <ScanLine className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-foreground">
                  Scan a bill
                </span>
                <span className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-1.5 py-1 text-[9px] font-semibold text-primary-foreground">
                  <Camera className="h-2.5 w-2.5" />
                  Take photo
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {STATS.map((stat) => (
                  <MiniStat key={stat.label} {...stat} />
                ))}
              </div>

              <p className="mt-3 text-[10px] font-semibold text-foreground">Quick actions</p>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {ACTIONS.map((action) => (
                  <div
                    key={action.label}
                    className="flex flex-col items-center gap-1 rounded-lg border border-border/70 bg-background px-1 py-2 text-center"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <action.icon className="h-3 w-3" />
                    </span>
                    <span className="text-[8px] leading-tight text-muted-foreground sm:text-[9px]">
                      {action.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ---------- phone, overlapping, large screens only ---------- */}
        <div className="absolute bottom-0 right-0 hidden w-40 rounded-[1.9rem] border-[6px] border-foreground bg-foreground shadow-2xl lg:block">
          <div className="overflow-hidden rounded-[1.45rem] bg-card">
            <div className="flex items-center justify-between border-b border-border/70 px-2.5 py-2">
              <span className="truncate text-[9px] font-semibold text-foreground">Demo Kirana Store</span>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[6px] font-bold text-primary">
                DS
              </span>
            </div>
            <div className="space-y-2 p-2.5">
              <p className="text-[10px] font-bold text-foreground">Good morning!</p>
              <div className="rounded-lg bg-primary p-2 text-primary-foreground">
                <p className="flex items-center gap-1 text-[9px] font-semibold">
                  <ScanLine className="h-3 w-3" />
                  Scan a bill
                </p>
                <p className="mt-0.5 text-[7px] opacity-90">We read it, you check it.</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {STATS.slice(0, 2).map((stat) => (
                  <MiniStat key={stat.label} {...stat} compact />
                ))}
              </div>
              <div className="space-y-1">
                {ACTIONS.slice(0, 3).map((action) => (
                  <div
                    key={action.label}
                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-1.5 py-1 text-[8px] text-muted-foreground"
                  >
                    <action.icon className="h-2.5 w-2.5 text-primary" />
                    {action.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground lg:mr-20">
        Sample figures shown for illustration
      </p>
    </figure>
  );
}
