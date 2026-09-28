import { describe, expect, it } from "vitest";
import { resolveApiTarget } from "../../api-target.mjs";
import { APP_CONFIG } from "@/lib/constants";

describe("resolveApiTarget (the /api/v1 proxy destination)", () => {
  it("uses the configured backend URL and drops a trailing slash", () => {
    expect(
      resolveApiTarget({ API_URL: "https://api.example.com/api/v1/", NODE_ENV: "production" }),
    ).toBe("https://api.example.com/api/v1");
  });

  it("still honours NEXT_PUBLIC_API_URL from an existing deployment", () => {
    expect(
      resolveApiTarget({ NEXT_PUBLIC_API_URL: "https://old.example.com/api/v1", NODE_ENV: "production" }),
    ).toBe("https://old.example.com/api/v1");
  });

  it("prefers API_URL when both are set", () => {
    expect(
      resolveApiTarget({
        API_URL: "https://new.example.com/api/v1",
        NEXT_PUBLIC_API_URL: "https://old.example.com/api/v1",
        NODE_ENV: "production",
      }),
    ).toBe("https://new.example.com/api/v1");
  });

  it("falls back to the local backend outside production", () => {
    expect(resolveApiTarget({ NODE_ENV: "development" })).toBe("http://localhost:4000/api/v1");
    expect(resolveApiTarget({ NODE_ENV: "test" })).toBe("http://localhost:4000/api/v1");
  });

  it("never falls back to localhost in a production build", () => {
    expect(resolveApiTarget({ NODE_ENV: "production" })).toBe("");
  });

  it("treats a blank value as not configured", () => {
    expect(resolveApiTarget({ API_URL: "   ", NODE_ENV: "production" })).toBe("");
  });
});

describe("the browser only ever calls its own origin", () => {
  // Same-origin is what keeps the httpOnly session cookies first-party.
  it("uses a relative API path", () => {
    expect(APP_CONFIG.apiUrl).toBe("/api/v1");
  });
});
