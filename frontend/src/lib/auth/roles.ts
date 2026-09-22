/**
 * WHAT A ROLE IS CALLED IN THE PLATFORM CONSOLE.
 *
 * This application is used by the SaaS operator's own people. The wording here
 * has to make one distinction impossible to miss:
 *
 *   PLATFORM_ADMIN  runs the PLATFORM. Every shop, every plan, the sales team.
 *   ADMIN           runs ONE SHOP. Nothing to do with the platform.
 *
 * Both were previously shown as "Administrator", which is how a support call
 * starts with everybody confused about who they are talking to. The database
 * enum is unchanged - thousands of rows say ADMIN, and renaming it would touch
 * every authorization check in the backend to fix a wording problem.
 */

export interface RoleDisplay {
  label: string;
  short: string;
  description: string;
}

const ROLE_DISPLAY: Record<string, RoleDisplay> = {
  PLATFORM_ADMIN: {
    label: "Platform Super Admin",
    short: "Super Admin",
    description:
      "Runs the whole platform: every business, plans and pricing, the sales team, and manual subscription grants.",
  },
  SALES_STAFF: {
    label: "Sales Representative",
    short: "Sales Rep",
    description:
      "Signs up shops and sells subscriptions, limited to the permissions they have been given.",
  },
  ADMIN: {
    label: "Shop Owner",
    short: "Shop Owner",
    description:
      "Owns one business and can only ever see that business. Not a platform account.",
  },
  STAFF: {
    label: "Shop Staff",
    short: "Shop Staff",
    description: "Works in one shop, preparing documents for its owner to post.",
  },
};

const FALLBACK: RoleDisplay = {
  label: "User",
  short: "User",
  description: "Signed in.",
};

function key(role: unknown): string | null {
  return typeof role === "string" ? role : null;
}

/** What to call a role on screen. Never renders a raw enum value. */
export function roleLabel(role: unknown): string {
  const k = key(role);
  return (k && ROLE_DISPLAY[k]?.label) || FALLBACK.label;
}

/** A shorter form, for a badge beside an avatar. */
export function roleShortLabel(role: unknown): string {
  const k = key(role);
  return (k && ROLE_DISPLAY[k]?.short) || FALLBACK.short;
}

export function roleDescription(role: unknown): string {
  const k = key(role);
  return (k && ROLE_DISPLAY[k]?.description) || FALLBACK.description;
}

/** Is this one of the operator's own people, rather than a shop's? */
export function isPlatformRole(role: unknown): boolean {
  return role === "PLATFORM_ADMIN" || role === "SALES_STAFF";
}

/** The one account that can do everything. */
export function isPlatformSuperAdmin(role: unknown): boolean {
  return role === "PLATFORM_ADMIN";
}
