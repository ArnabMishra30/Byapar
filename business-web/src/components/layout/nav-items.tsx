"use client";

import Link from "next/link";
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

export function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isAdmin, isGstEnabled } = useAuth();
  const sections = visibleSections(isAdmin, isGstEnabled);

  return (
    <nav className="flex flex-col gap-6 p-3" aria-label="Main">
      {sections.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </p>
          {section.items.map((item) => {
            // startsWith so a detail page keeps its parent highlighted, but
            // never let "/" match everything.
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname?.startsWith(item.href + "/"));

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
      ))}
    </nav>
  );
}
