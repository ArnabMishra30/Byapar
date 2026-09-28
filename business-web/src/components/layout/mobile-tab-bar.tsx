"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Boxes, LayoutDashboard, Receipt, Zap } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The phone's bottom bar: the five places a shopkeeper goes all day, within
 * thumb reach. Quick Billing sits in the middle and stands out, because it is
 * the thing done most often at a counter. Hidden from lg up, where the sidebar
 * is always visible.
 */
const TABS = [
  { label: "Home", href: ROUTES.dashboard, icon: LayoutDashboard },
  { label: "Sales", href: ROUTES.sales, icon: Receipt },
  { label: "Bill", href: ROUTES.quickBilling, icon: Zap, primary: true },
  { label: "Stock", href: ROUTES.stock, icon: Boxes },
  { label: "Credit", href: ROUTES.creditBook, icon: BookOpen },
];

export function MobileTabBar() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Quick navigation"
      data-app-chrome
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {tab.primary ? (
                  <span className="-mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-4 ring-background">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                ) : (
                  <Icon className="h-5 w-5" aria-hidden />
                )}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
