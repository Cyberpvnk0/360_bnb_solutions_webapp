import { afterEach, describe, expect, it, vi } from "vitest";

import { isFresh, readMarketStore, STORE_TTL_MS } from "./market-store";

describe("isFresh", () => {
  it("accepts a timestamp inside the window and rejects one outside", () => {
    const now = Date.now();
    expect(isFresh(new Date(now - 1000).toISOString())).toBe(true);
    expect(isFresh(new Date(now - STORE_TTL_MS - 1000).toISOString())).toBe(
      false
    );
  });

  it("treats garbage as stale, never as fresh", () => {
    // A malformed timestamp must fall through to the live path, not
    // serve a row of unknown age as today's inventory.
    expect(isFresh(null)).toBe(false);
    expect(isFresh(undefined)).toBe(false);
    expect(isFresh("")).toBe(false);
    expect(isFresh("not a date")).toBe(false);
  });
});

describe("readMarketStore without configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a quiet miss, not an error", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(readMarketStore("tampa")).resolves.toBeNull();
  });
});
