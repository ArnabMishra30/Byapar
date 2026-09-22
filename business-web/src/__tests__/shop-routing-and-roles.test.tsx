import { describe, it, expect } from "vitest";
import { NAVIGATION, ROUTES, SHOP_PREFIX, APP_CONFIG } from "@/lib/constants";
import {
  roleLabel,
  roleDescription,
  isPlatformRole,
} from "@/lib/auth/roles";
import { can, type Capability } from "@/lib/permissions";

// THE TWO SEPARATIONS THIS PHASE EXISTS TO MAKE OBVIOUS.
//
//   1. The PUBLIC site and the SHOP application share an origin, so the boundary
//      has to be visible in the URL: / is marketing, /shop/* is the application.
//
//   2. A SHOP OWNER is not a PLATFORM SUPER ADMIN. They were both called
//      "Administrator" before this phase, which is how a support call starts
//      with everybody confused about who they are talking to.
//
// Neither of these is security - the backend enforces that, and is tested there.
// These prove the wording and the routing cannot quietly drift back.

describe("the shop application lives under /shop", () => {
  it("prefixes every navigation link", () => {
    const links = NAVIGATION.flatMap((section) => section.items.map((item) => item.href));

    expect(links.length).toBeGreaterThan(10);
    for (const href of links) {
      expect(href, `${href} must live under ${SHOP_PREFIX}`).toMatch(/^\/shop\//);
    }
  });

  it("never leaves a bare app route in the navigation", () => {
    const links = NAVIGATION.flatMap((section) => section.items.map((item) => item.href));

    // "/dashboard" would collide with the marketing site's own space and would
    // 404 now that the app has moved.
    for (const href of links) {
      expect(href).not.toMatch(/^\/(dashboard|sales|purchases|bills|reports|settings)/);
    }
  });

  it("points login and the landing page at the right places", () => {
    expect(ROUTES.landing).toBe("/");
    expect(ROUTES.login).toBe("/shop/login");
    expect(ROUTES.dashboard).toBe("/shop/dashboard");
    expect(ROUTES.subscription).toBe("/shop/subscription");
  });

  it("keeps the marketing anchors OUT of the shop prefix", () => {
    // These are sections of the public page, not application routes.
    for (const href of [ROUTES.features, ROUTES.pricing, ROUTES.faq, ROUTES.howItWorks]) {
      expect(href).not.toMatch(/^\/shop/);
      expect(href.startsWith("/#")).toBe(true);
    }
  });

  it("never routes to the platform console, which is a different application", () => {
    const links = NAVIGATION.flatMap((section) => section.items.map((item) => item.href));
    for (const href of links) {
      expect(href).not.toMatch(/^\/admin/);
      expect(href).not.toMatch(/^\/platform/);
    }
  });
});

describe("a shop owner is never told they are a platform administrator", () => {
  it("calls ADMIN a Shop Owner", () => {
    expect(roleLabel("ADMIN")).toBe("Shop Owner");
  });

  // THE POINT OF THE WHOLE RENAME.
  it("never uses the word Administrator for a shop account", () => {
    for (const role of ["ADMIN", "STAFF"]) {
      expect(roleLabel(role)).not.toMatch(/administrator/i);
      expect(roleLabel(role)).not.toMatch(/super/i);
    }
  });

  it("calls STAFF Shop Staff", () => {
    expect(roleLabel("STAFF")).toBe("Shop Staff");
  });

  it("reserves Platform Super Admin for the platform role", () => {
    expect(roleLabel("PLATFORM_ADMIN")).toBe("Platform Super Admin");
    expect(roleLabel("SALES_STAFF")).toBe("Sales Representative");
  });

  it("says plainly that a platform account is not part of this business", () => {
    expect(roleDescription("PLATFORM_ADMIN")).toMatch(/not a member of this business/i);
    expect(roleDescription("SALES_STAFF")).toMatch(/not for this business/i);
  });

  it("never renders a raw enum value, whatever it is handed", () => {
    for (const value of [null, undefined, "", "WHATEVER", 42, {}]) {
      const label = roleLabel(value);
      expect(label).toBe("User");
      expect(label).not.toMatch(/_/);
    }
  });
});

describe("platform accounts are recognised as not belonging here", () => {
  it("identifies both platform roles", () => {
    expect(isPlatformRole("PLATFORM_ADMIN")).toBe(true);
    expect(isPlatformRole("SALES_STAFF")).toBe(true);
  });

  it("does not mistake a shop role for a platform one", () => {
    expect(isPlatformRole("ADMIN")).toBe(false);
    expect(isPlatformRole("STAFF")).toBe(false);
    expect(isPlatformRole(null)).toBe(false);
    expect(isPlatformRole(undefined)).toBe(false);
  });
});

describe("the shop permission mirror still matches the backend", () => {
  // Guards against the rename having quietly changed what a role can do. The
  // wording moved; the authorization did not.
  const ownerOnly: Capability[] = [
    "sales.post",
    "purchases.post",
    "expenses.post",
    "money.receive",
    "money.pay",
    "parties.manage",
  ];

  it("lets a shop owner post to the books", () => {
    for (const capability of ownerOnly) {
      expect(can("ADMIN", capability), capability).toBe(true);
    }
  });

  it("refuses shop staff the same actions", () => {
    for (const capability of ownerOnly) {
      expect(can("STAFF", capability), capability).toBe(false);
    }
  });

  it("still lets staff prepare drafts", () => {
    for (const capability of ["sales.draft", "purchases.draft", "expenses.draft"] as Capability[]) {
      expect(can("STAFF", capability), capability).toBe(true);
    }
  });
});

describe("configuration carries no secrets", () => {
  // The AI key is server-side only. Nothing in this project may reference it,
  // and the one public value is an API URL, which is not a secret.
  it("exposes only the API URL to the browser", () => {
    expect(APP_CONFIG.apiUrl).toMatch(/^https?:\/\//);
  });

  it("has no AI credentials anywhere in the config", () => {
    const serialised = JSON.stringify(APP_CONFIG).toUpperCase();
    for (const forbidden of ["LLAMA", "API_KEY", "SECRET", "BEARER"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
