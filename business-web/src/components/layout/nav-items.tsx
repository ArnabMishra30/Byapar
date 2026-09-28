"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { NAVIGATION, type NavItem, type NavSection } from "@/lib/constants";
import { useAuth } from "@/lib/auth/auth-context";
import { NavIcon } from "./nav-icon";
import { cn } from "@/lib/utils";

/**
 * The navigation, filtered for who is looking at it.
 *
 * Two filters, and neither is security:
 *
 *   GST sections vanish for a company that does not use GST, so a local shop
 *   never sees a tax menu it has no use for.
 *
 *   Admin-only items vanish for staff, so they are not led to a 403.
 *
 * The backend refuses the underlying requests regardless of what is drawn here.
 */
function visibleItems(items: NavItem[], isAdmin: boolean, isGstEnabled: boolean) {
  return items.filter((item) => {
    if (item.requireGst && !isGstEnabled) return false;
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });
}

export function visibleSections(isAdmin: boolean, isGstEnabled: boolean): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: visibleItems(section.items, isAdmin, isGstEnabled),
  })).filter((section) => {
    if (section.requireGst && !isGstEnabled) return false;
    if (section.adminOnly && !isAdmin) return false;
    return section.items.length > 0;
  });
}

/**
 * Which item is "the page you are on". The LONGEST matching href wins, so
 * /shop/sales/returns highlights Sales Returns and not also Sales.
 */
export function activeHref(pathname: string | null, sections: NavSection[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(item.href + "/");
      if (matches && (!best || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}

const COLLAPSE_KEY = "byapar_nav_collapsed";

function readCollapsed(): string[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isAdmin, isGstEnabled } = useAuth();
  const sections = visibleSections(isAdmin, isGstEnabled);
  const current = activeHref(pathname, sections);

  // Sections fold away so a long menu stays scannable. The section holding
  // the current page is always open, whatever was folded before.
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  React.useEffect(() => setCollapsed(readCollapsed()), []);

  const toggle = (title: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title];
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* a preference, not data */
      }
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-3 p-3" aria-label="Main">
      {sections.map((section) => {
        const holdsCurrent = section.items.some((item) => item.href === current);
        const open = holdsCurrent || !collapsed.includes(section.title);
        const listId = `nav-${section.title.replace(/\W+/g, "-").toLowerCase()}`;

        return (
        <div key={section.title} className="space-y-0.5">
          <button
            type="button"
            onClick={() => toggle(section.title)}
            disabled={holdsCurrent}
            aria-expanded={open}
            aria-controls={listId}
            className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
          >
            {section.title}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
              aria-hidden
            />
          </button>
          <div id={listId} hidden={!open} className="space-y-0.5">
          {section.items.map((item) => {
            const active = item.href === current;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <NavIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{item.title}</span>
              </Link>
            );
          })}
          </div>
        </div>
        );
      })}
    </nav>
  );
}
