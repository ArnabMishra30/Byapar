import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "@/lib/constants";

describe("resolveApiUrl", () => {
  it("uses the configured backend URL and drops a trailing slash", () => {
    expect(
      resolveApiUrl({ NEXT_PUBLIC_API_URL: "https://api.example.com/api/v1/", NODE_ENV: "production" }),
    ).toBe("https://api.example.com/api/v1");
  });

  it("falls back to the local backend outside production", () => {
    expect(resolveApiUrl({ NODE_ENV: "development" })).toBe("http://localhost:4000/api/v1");
    expect(resolveApiUrl({ NODE_ENV: "test" })).toBe("http://localhost:4000/api/v1");
  });

  it("never falls back to localhost in a production build", () => {
    expect(resolveApiUrl({ NODE_ENV: "production" })).toBe("");
  });

  it("treats a blank value as not configured", () => {
    expect(resolveApiUrl({ NEXT_PUBLIC_API_URL: "   ", NODE_ENV: "production" })).toBe("");
  });
});
