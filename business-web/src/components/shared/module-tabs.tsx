"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface ModuleTab {
  label: string;
  href: string;
  /** Hidden when false. UX only; the backend still decides. */
  show?: boolean;
}

/**
 * The sub-pages of one module (Sales: Overview · Invoices · Returns), as a row
 * of links under the page header. Scrolls sideways on a phone instead of
 * wrapping, so it never pushes the page content down.
 *
 * The longest matching href is the active one, so a detail page keeps its tab.
 */
export function ModuleTabs({ tabs, className }: { tabs: ModuleTab[]; className?: string }) {
  const pathname = usePathname() ?? "";
  const visible = tabs.filter((tab) => tab.show !== false);
  const active = visible
    .filter((tab) => pathname === tab.href || pathname.startsWith(tab.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Section"
      className={cn("-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0", className)}
      data-print-hide
    >
      <div className="flex w-max min-w-full gap-1 border-b">
        {visible.map((tab) => {
          const isActive = tab.href === active;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
