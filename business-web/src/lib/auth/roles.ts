import type { UserRole } from "@/types/api";

/**
 * WHAT A ROLE IS CALLED, versus what it is stored as.
 *
 * The database has said ADMIN and STAFF since the first migration, and thousands
 * of rows say so. Renaming the enum would touch every authorization check in the
 * backend to fix a wording problem, so the enum stays and the WORDING is mapped
 * here instead.
 *
 * THE CONFUSION THIS EXISTS TO END:
 *
 *   "ADMIN" means the owner of ONE SHOP. It has never meant anything else in
 *   this application. But a shopkeeper who sees "Administrator" on their profile
 *   reasonably assumes they administer the platform, and a support conversation
 *   then starts from a false premise.
 *
 *   The person who administers the PLATFORM is PLATFORM_ADMIN, works for the
 *   operator, has no shop of their own, and never signs in here at all - the
 *   platform console is a different application on a different port.
 *
 * So in this project, ADMIN reads as "Shop Owner", full stop.
 */

export interface RoleDisplay {
  /** What to call this role on screen. */
  label: string;
  /** One line of plain English about what it can do. */
  description: string;
}

const ROLE_DISPLAY: Record<string, RoleDisplay> = {
  ADMIN: {
    label: "Shop Owner",
    description: "Full access to this business: records, money, staff and settings.",
  },
  STAFF: {
    label: "Shop Staff",
    description: "Can prepare sales, purchases and expenses. An owner posts them to the books.",
  },
  // These two belong to the platform operator and cannot sign in to the shop
  // application. They are mapped anyway so that a stray value never renders as a
  // raw enum on a screen a shopkeeper is looking at.
  PLATFORM_ADMIN: {
    label: "Platform Super Admin",
    description: "Operates the SaaS platform. Not a member of this business.",
  },
  SALES_STAFF: {
    label: "Sales Representative",
    description: "Works for the platform, not for this business.",
  },
};

const FALLBACK: RoleDisplay = {
  label: "User",
  description: "Signed in to this business.",
};

function key(role: unknown): string | null {
  return typeof role === "string" ? role : null;
}

/** What to call a role on screen. Never renders a raw enum value. */
export function roleLabel(role: unknown): string {
  const k = key(role);
  return (k && ROLE_DISPLAY[k]?.label) || FALLBACK.label;
}

export function roleDescription(role: unknown): string {
  const k = key(role);
  return (k && ROLE_DISPLAY[k]?.description) || FALLBACK.description;
}

export function roleDisplay(role: unknown): RoleDisplay {
  const k = key(role);
  return (k && ROLE_DISPLAY[k]) || FALLBACK;
}

/**
 * Whether this account belongs to the platform operator rather than a shop.
 *
 * Used to refuse a platform account at the shop login: they have no company, so
 * every screen in this application would be empty or broken for them.
 */
export function isPlatformRole(role: unknown): boolean {
  return role === "PLATFORM_ADMIN" || role === "SALES_STAFF";
}

export type { UserRole };
