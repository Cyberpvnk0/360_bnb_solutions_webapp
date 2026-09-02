import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeStatus } from "./market-store";

/**
 * The store's health check writes a sentinel row and reads it back.
 * Postgres returns a timestamptz spelled differently from the ISO
 * string JavaScript wrote — "+00:00" for "Z", trailing zeros trimmed —
 * and a string comparison reported a working store as broken on every
 * call. These pin the fix: instants are compared, not spellings.
 */

const WROTE = "2026-09-02T17:30:12.300Z";
/** The same moment as Postgres hands it back through PostgREST. */
const POSTGRES_SAYS = "2026-09-02T17:30:12.3+00:00";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubStore(readBack: unknown[]) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (method === "POST") return new Response(null, { status: 201 });
      return json(readBack);
    })
  );
  return calls;
}

describe("storeStatus reads the sentinel back as an instant", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(WROTE));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is healthy when Postgres spells the stamp its own way", async () => {
    const calls = stubStore([
      { listings: null, listings_at: POSTGRES_SAYS, stats: null, stats_at: null },
    ]);
    const status = await storeStatus();
    expect(status.ok).toBe(true);
    // One write, one read, in that order — the read must be a fresh
    // fetch of the row, not an assumption.
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(calls[1].url).toContain("market_slug=eq.__healthcheck__");
  });

  it("still fails when the row that comes back is somebody else's", async () => {
    // A stale sentinel from an earlier call means THIS write did not
    // land — the one case the old string check happened to get right.
    const stale = "2026-09-01T09:00:00+00:00";
    stubStore([{ listings: null, listings_at: stale, stats: null, stats_at: null }]);
    const status = await storeStatus();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain(`a row stamped ${stale}`);
    expect(status.detail).toContain(`wrote ${WROTE}`);
  });

  it("says 'no row' when nothing comes back at all", async () => {
    stubStore([]);
    const status = await storeStatus();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain("read back no row");
    // The key is a secret key, so the message must send the reader to
    // the table, not to the key.
    expect(status.detail).toContain("the problem is the table");
  });
});
