import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The record behind the health panel's "last real calls".
 *
 * Two things matter above all: it never keeps anything secret, and it
 * never loses a newer timestamp to an older one when instances merge.
 */

const store = new Map<string, Record<string, unknown>>();
const writeKeyed = vi.fn(
  async (key: string, value: unknown): Promise<{ ok: boolean; detail: string | null }> => {
    store.set(key, value as Record<string, unknown>);
    return { ok: true, detail: null };
  }
);
const readKeyedBlobs = vi.fn(async (keys: readonly string[]) => {
  const out = new Map<string, { value: Record<string, unknown>; at: string | null }>();
  for (const k of keys) {
    const v = store.get(k);
    if (v) out.set(k, { value: v, at: null });
  }
  return out;
});

vi.mock("@/lib/db/market-store", () => ({
  writeKeyed: (k: string, v: unknown) => writeKeyed(k, v),
  readKeyedBlobs: (k: readonly string[]) => readKeyedBlobs(k),
}));

import {
  classifyStatus,
  mergeErrors,
  mergeTelemetry,
  parseTelemetry,
  readTelemetry,
  recordCall,
  recordJob,
  recordRouteError,
  resetTelemetryForTests,
  RECENT_MAX,
  sanitize,
  serviceKey,
  type CallRecord,
} from "./telemetry";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.clear();
  writeKeyed.mockClear();
  readKeyedBlobs.mockClear();
  resetTelemetryForTests();
});

describe("classifyStatus", () => {
  it("separates the account refusing from the call failing", () => {
    expect(classifyStatus(200)).toBe("ok");
    expect(classifyStatus(302)).toBe("ok");
    expect(classifyStatus(401)).toBe("auth");
    expect(classifyStatus(403)).toBe("auth");
    expect(classifyStatus(402)).toBe("billing");
    expect(classifyStatus(429)).toBe("rate-limited");
    expect(classifyStatus(404)).toBe("not-found");
    expect(classifyStatus(410)).toBe("not-found");
    expect(classifyStatus(400)).toBe("client");
    expect(classifyStatus(500)).toBe("server");
    expect(classifyStatus(null)).toBe("network");
  });
});

describe("sanitize", () => {
  it("drops query strings, where vendor keys travel", () => {
    const out = sanitize("fetch failed: https://api.scraperapi.com/?api_key=abc123secret&url=https%3A%2F%2Fx");
    expect(out).toContain("https://api.scraperapi.com/");
    expect(out).not.toContain("abc123secret");
  });

  it("redacts credentials, tokens and email addresses", () => {
    const raw = [
      "Authorization: Bearer abc.def.ghi",
      "key=AIzaSyDUMMYKEY0123456789",
      "api_key: 'zzz-top-secret'",
      "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
      "re_123456789abcdef",
      "sb_secret_abcdefghijk",
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig",
      "member jane.doe@example.com",
    ].join(" | ");
    const out = sanitize(raw, 1000);
    for (const secret of [
      "abc.def.ghi",
      "AIzaSyDUMMYKEY0123456789",
      "zzz-top-secret",
      "sk-ant-api03",
      "re_123456789abcdef",
      "sb_secret_abcdefghijk",
      "eyJhbGciOiJIUzI1NiJ9",
      "jane.doe@example.com",
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it("leaves ordinary words alone and caps the length", () => {
    expect(sanitize("re-render failed while re-validating")).toBe("re-render failed while re-validating");
    expect(sanitize("x".repeat(500)).length).toBe(300);
    expect(sanitize("a\n\n  b")).toBe("a b");
  });
});

const rec = (at: string, status: number | null, ms = 10): CallRecord => ({
  at,
  status,
  ms,
  kind: classifyStatus(status),
});

describe("mergeTelemetry", () => {
  it("unions, de-duplicates and keeps the newest first", () => {
    const a = { recent: [rec("2026-10-23T10:00:00.000Z", 200)], lastOkAt: "2026-10-23T10:00:00.000Z", lastFailAt: null, lastFail: null };
    const b = {
      recent: [rec("2026-10-23T11:00:00.000Z", 500), rec("2026-10-23T10:00:00.000Z", 200)],
      lastOkAt: "2026-10-23T10:00:00.000Z",
      lastFailAt: "2026-10-23T11:00:00.000Z",
      lastFail: rec("2026-10-23T11:00:00.000Z", 500),
    };
    const m = mergeTelemetry(a, b);
    expect(m.recent.map((r) => r.status)).toEqual([500, 200]);
    expect(m.lastFail?.status).toBe(500);
  });

  it("never moves a timestamp backwards, whichever side is older", () => {
    const newer = { recent: [], lastOkAt: "2026-10-23T12:00:00.000Z", lastFailAt: null, lastFail: null };
    const older = { recent: [], lastOkAt: "2026-10-22T12:00:00.000Z", lastFailAt: null, lastFail: null };
    expect(mergeTelemetry(older, newer).lastOkAt).toBe("2026-10-23T12:00:00.000Z");
    expect(mergeTelemetry(newer, older).lastOkAt).toBe("2026-10-23T12:00:00.000Z");
  });

  it("caps the window", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      rec(new Date(Date.UTC(2026, 9, 23, 0, i)).toISOString(), 200)
    );
    expect(mergeTelemetry({ recent: many, lastOkAt: null, lastFailAt: null, lastFail: null }, parseTelemetry(null)).recent).toHaveLength(RECENT_MAX);
  });

  it("reads a malformed stored row as empty", () => {
    expect(parseTelemetry({ recent: [{ at: 1 }, "x"], lastOkAt: 5 })).toEqual({
      recent: [],
      lastOkAt: null,
      lastFailAt: null,
      lastFail: null,
    });
  });
});

describe("recordCall", () => {
  it("stores the first call at once, then at most once a minute", async () => {
    const t0 = new Date("2026-10-23T10:00:00.000Z");
    recordCall("rentcast", 200, 120, t0);
    await flush();
    expect(writeKeyed).toHaveBeenCalledTimes(1);
    recordCall("rentcast", 200, 90, new Date(t0.getTime() + 5_000));
    await flush();
    expect(writeKeyed).toHaveBeenCalledTimes(1);
  });

  it("stores at once when a working service starts failing", async () => {
    const t0 = new Date();
    recordCall("airroi", 200, 50, t0);
    await flush();
    recordCall("airroi", 402, 50, new Date(t0.getTime() + 1_000));
    await flush();
    expect(writeKeyed).toHaveBeenCalledTimes(2);
    const saved = parseTelemetry(store.get(serviceKey("airroi")));
    expect(saved.lastFail?.kind).toBe("billing");
    expect(saved.lastOkAt).not.toBeNull();
  });

  it("keeps a status and a latency, never a URL", async () => {
    recordCall("scraperapi", 500, 12_345.6);
    await flush();
    const json = JSON.stringify(store.get(serviceKey("scraperapi")));
    expect(json).not.toMatch(/https?:/);
    expect(parseTelemetry(store.get(serviceKey("scraperapi"))).recent[0]).toMatchObject({ status: 500, ms: 12346, kind: "server" });
  });

  it("survives a store that throws", async () => {
    writeKeyed.mockRejectedValueOnce(new Error("down"));
    expect(() => recordCall("rentcast", 200, 1)).not.toThrow();
    await flush();
  });
});

describe("route errors and jobs", () => {
  it("keeps the path without its query, and a scrubbed message", async () => {
    recordRouteError({
      path: "/api/rentals?zip=33101&key=secret",
      method: "get",
      kind: "route",
      error: new Error("upstream https://api.rentcast.io/v1/x?apiKey=zzz failed for a@b.com"),
    });
    await flush();
    const snap = await readTelemetry();
    expect(snap.errors).toHaveLength(1);
    expect(snap.errors[0]).toMatchObject({ path: "/api/rentals", method: "GET", kind: "route" });
    expect(snap.errors[0].message).not.toContain("zzz");
    expect(snap.errors[0].message).not.toContain("a@b.com");
  });

  it("merges errors newest first without duplicates", () => {
    const e = (at: string) => ({ at, path: "/p", method: "GET", kind: "route", message: "m", digest: null });
    expect(mergeErrors([e("2026-01-01T00:00:00.000Z")], [e("2026-01-02T00:00:00.000Z"), e("2026-01-01T00:00:00.000Z")]).map((x) => x.at)).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("records a scheduled run and reads it back", async () => {
    await recordJob("alerts", false, "mail to x@y.com failed");
    const snap = await readTelemetry();
    expect(snap.jobs.alerts?.ok).toBe(false);
    expect(snap.jobs.alerts?.detail).toBe("mail to [email] failed");
  });
});

describe("readTelemetry", () => {
  it("folds this instance's memory into what the store holds", async () => {
    store.set(serviceKey("rentcast"), {
      recent: [rec("2026-10-20T00:00:00.000Z", 200)],
      lastOkAt: "2026-10-20T00:00:00.000Z",
      lastFailAt: null,
      lastFail: null,
    });
    writeKeyed.mockResolvedValueOnce({ ok: false, detail: "x" });
    recordCall("rentcast", 503, 5, new Date("2026-10-23T00:00:00.000Z"));
    await flush();
    const snap = await readTelemetry();
    expect(snap.services.rentcast?.recent.map((r) => r.status)).toEqual([503, 200]);
    expect(snap.shared).toBe(true);
  });
});
