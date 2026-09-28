import { describe, expect, it } from "vitest";
import { resolveApiTarget } from "../../api-target.mjs";
import { APP_CONFIG } from "../lib/constants";

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

  it("falls back to the local backend only outside production", () => {
    expect(resolveApiTarget({ NODE_ENV: "development" })).toBe("http://localhost:4000/api/v1");
    expect(resolveApiTarget({ NODE_ENV: "production" })).toBe("");
    expect(resolveApiTarget({ API_URL: "  ", NODE_ENV: "production" })).toBe("");
  });

  it("has the browser call its own origin, keeping session cookies first-party", () => {
    expect(APP_CONFIG.apiUrl).toBe("/api/v1");
  });
});
