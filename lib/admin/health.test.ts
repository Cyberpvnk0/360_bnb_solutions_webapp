import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How the System health tab turns evidence into a verdict — and the one
 * guarantee that outranks every verdict: no key leaves the server.
 */

vi.mock("@/lib/db/market-store", () => ({
  storeConfigured: () => true,
  storeStatus: async () => ({ ok: true, detail: "ok" }),
  storeCounts: async () => ({ markets: 3, marketsWithStats: 1, keyed: 10, error: null }),
  readKeyedBlobs: async () => new Map(),
  writeKeyed: async () => ({ ok: true, detail: null }),
}));
vi.mock("@/lib/db/usage", () => ({
  planTablesReady: async () => ({ usage: true, credits: true, detail: null }),
  mockCheckoutEnabled: () => process.env.MOCK_CHECKOUT === "1",
}));
vi.mock("@/lib/live/scraper-usage", () => ({
  scraperUsage: async () => ({
    ok: true,
    account: { secretish: process.env.SCRAPERAPI_KEY },
    used: 950,
    limit: 1000,
    remaining: 50,
    percentUsed: 95,
    error: null,
  }),
}));
const modelsList = vi.fn(async () => ({}));
vi.mock("@/lib/assistant/client", () => ({
  assistantConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  anthropicClient: () => ({ models: { list: modelsList } }),
}));
// The real module captures its env at import, before stubEnv runs.
vi.mock("@/lib/supabase/config", () => ({
  authConfigured: () =>
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
}));
vi.mock("@/lib/auth/gate", () => ({
  adminEmails: () => new Set((process.env.ADMIN_EMAILS ?? "").split(",").filter(Boolean)),
}));

import {
  buildHealthReport,
  combine,
  describeCron,
  envPresence,
  judgeCalls,
  rollUp,
  senderDomain,
  type ProbeResult,
} from "./health";
import { SERVICE_BY_ID } from "./services";
import { classifyStatus, type CallRecord, type ServiceTelemetry } from "./telemetry";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const call = (minutesAgo: number, status: number | null): CallRecord => ({
  at: ago(minutesAgo),
  status,
  ms: 100,
  kind: classifyStatus(status),
});
const windowOf = (...recent: CallRecord[]): ServiceTelemetry => ({
  recent,
  lastOkAt: null,
  lastFailAt: null,
  lastFail: null,
});

describe("judgeCalls", () => {
  it("says nothing was used when nothing was", () => {
    expect(judgeCalls(undefined, NOW).status).toBe("idle");
    expect(judgeCalls(windowOf(call(60 * 30, 200)), NOW).status).toBe("idle");
  });

  it("calls a refused account down at once, whatever came before", () => {
    const v = judgeCalls(windowOf(call(1, 401), call(2, 200), call(3, 200)), NOW);
    expect(v.status).toBe("down");
    expect(v.reason).toContain("key refused");
    expect(judgeCalls(windowOf(call(1, 402)), NOW).reason).toContain("balance");
  });

  it("is operational when the last call worked", () => {
    expect(judgeCalls(windowOf(call(1, 200), call(2, 500)), NOW).status).toBe("operational");
    expect(judgeCalls(windowOf(call(1, 404)), NOW).status).toBe("operational");
  });

  it("is degraded when much of the day failed even if the last call worked", () => {
    const v = judgeCalls(windowOf(call(1, 200), call(2, 500), call(3, 500), call(4, 200), call(5, 200)), NOW);
    expect(v.status).toBe("degraded");
    expect(v.reason).toBe("2 of the last 5 calls failed");
  });

  it("waits for three failures in a row before calling it down", () => {
    expect(judgeCalls(windowOf(call(1, 500), call(2, 200)), NOW).status).toBe("degraded");
    expect(judgeCalls(windowOf(call(1, 500), call(2, null), call(3, 503), call(4, 200)), NOW).status).toBe("down");
  });
});

const probe = (p: Partial<ProbeResult>): ProbeResult => ({ ok: true, degraded: false, ms: 50, detail: "key accepted", ...p });

describe("combine", () => {
  it("lets a failing probe decide", () => {
    expect(combine(probe({ ok: false, detail: "key rejected" }), { status: "operational", reason: "" })).toEqual({
      status: "down",
      reason: "key rejected",
    });
  });

  it("lowers a passing probe when the product's own calls fail", () => {
    const v = combine(probe({}), { status: "down", reason: "last 3 calls failed" });
    expect(v.status).toBe("degraded");
    expect(v.reason).toBe("key accepted; product calls failing — last 3 calls failed");
  });

  it("keeps a probe's own caveat", () => {
    expect(combine(probe({ degraded: true }), { status: "idle", reason: "" }).status).toBe("degraded");
    expect(combine(probe({}), null).status).toBe("operational");
  });

  it("falls back to the record when there is no probe", () => {
    expect(combine(null, { status: "down", reason: "x" }).status).toBe("down");
    expect(combine(null, null).status).toBe("idle");
  });
});

describe("rollUp", () => {
  it("treats a core service with no keys as an outage", () => {
    const r = rollUp([
      { name: "RentCast", status: "not-configured", critical: true },
      { name: "Mapbox", status: "operational", critical: false },
    ]);
    expect(r.status).toBe("down");
    expect(r.headline).toContain("RentCast");
  });

  it("calls a non-core failure degraded, and ignores optional services left unset", () => {
    expect(rollUp([{ name: "Mapbox", status: "down", critical: false }]).status).toBe("degraded");
    const fine = rollUp([
      { name: "Payments", status: "not-configured", critical: false },
      { name: "Supabase", status: "operational", critical: true },
    ]);
    expect(fine.status).toBe("operational");
    expect(fine.counts["not-configured"]).toBe(1);
  });
});

describe("helpers", () => {
  it("reports env presence by any accepted spelling, case-insensitively", () => {
    const got = envPresence(SERVICE_BY_ID.dataskip, { DATASKIP_KEY: "x" } as unknown as NodeJS.ProcessEnv);
    expect(got).toEqual([{ name: "DataSkip_Key", present: true, optional: false }]);
    const supa = envPresence(SERVICE_BY_ID.supabase, {
      SUPABASE_SERVICE_ROLE_KEY: "x",
    } as unknown as NodeJS.ProcessEnv);
    expect(supa.find((e) => e.name === "SUPABASE_SERVICE_ROLE_KEY")?.present).toBe(true);
    const anth = envPresence(SERVICE_BY_ID.anthropic, {} as unknown as NodeJS.ProcessEnv);
    expect(anth[1]).toEqual({ name: "ANTHROPIC_WORKSPACE_ID", present: false, optional: true });
  });

  it("reads the sending domain from either ALERTS_FROM form", () => {
    expect(senderDomain("AirCore <alerts@mail.aircore.io>")).toBe("mail.aircore.io");
    expect(senderDomain("alerts@AirCore.io")).toBe("aircore.io");
    expect(senderDomain("AirCore")).toBeNull();
    expect(senderDomain(undefined)).toBeNull();
  });

  it("says a daily schedule in words", () => {
    expect(describeCron("0 13 * * *")).toBe("Daily at 13:00 UTC");
    expect(describeCron("*/5 * * * *")).toBe("*/5 * * * * (UTC)");
  });
});

describe("buildHealthReport", () => {
  const SECRETS = {
    RENTCAST_API_KEY: "SENTINEL-RENTCAST-1111",
    SCRAPERAPI_KEY: "SENTINEL-SCRAPER-2222",
    ANTHROPIC_API_KEY: "sk-ant-SENTINEL-3333",
    GOOGLE_MAPS_API_KEY: "SENTINEL-GOOGLE-4444",
    MAPBOX_TOKEN: "SENTINEL-MAPBOX-5555",
    MAPTILER_KEY: "SENTINEL-MAPTILER-6666",
    RESEND_API_KEY: "re_SENTINEL7777",
    ALERTS_FROM: "AirCore <alerts@aircore.io>",
    AIRROI_API_KEY: "SENTINEL-AIRROI-8888",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SENTINEL9999",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_SENTINEL0000",
    ADMIN_EMAILS: "boss@example.com",
  };
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    for (const [k, v] of Object.entries(SECRETS)) vi.stubEnv(k, v);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes("streetview/metadata")) return json({ status: "OK" });
      if (url.includes("api.mapbox.com/tokens")) return json({ code: "TokenValid" });
      if (url.includes("api.maptiler.com")) return json({ version: 8 });
      if (url.includes("geocoding.geo.census.gov")) return json({ result: { addressMatches: [{}] } });
      if (url.includes("api.resend.com/domains")) return json({ data: [{ name: "aircore.io", status: "verified" }] });
      return json({}, 404);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = realFetch;
  });

  it("never returns a key, token or secret value", async () => {
    const report = await buildHealthReport(new Date(NOW));
    const json = JSON.stringify(report);
    for (const [name, value] of Object.entries(SECRETS)) {
      if (name === "ALERTS_FROM" || name.endsWith("_URL") || name === "ADMIN_EMAILS") continue;
      expect(json, name).not.toContain(value);
    }
    expect(json).not.toContain("boss@example.com");
  });

  it("probes the free endpoints and reports what they say", async () => {
    const report = await buildHealthReport(new Date(NOW));
    const by = Object.fromEntries(report.services.map((s) => [s.id, s]));
    expect(by.supabase.status).toBe("operational");
    expect(by.supabase.dashboards[0].url).toBe("https://supabase.com/dashboard/project/abcdefghijklmnopqrst");
    expect(by["google-maps"].status).toBe("operational");
    expect(by.mapbox.status).toBe("operational");
    expect(by.resend.reason).toContain("aircore.io verified");
    // 95% of the scraper allowance used is a working account to watch.
    expect(by.scraperapi.status).toBe("degraded");
    expect(by.scraperapi.metrics[0].value).toBe("950 of 1,000 (95%)");
    expect(modelsList).toHaveBeenCalled();
    expect(by.anthropic.status).toBe("operational");
    // Paid feeds are never probed; with no product calls they are idle.
    expect(by.rentcast.probe).toBeNull();
    expect(by.rentcast.status).toBe("idle");
    expect(by.payments.status).toBe("not-configured");
    expect(report.backend.alertsJob.schedule).toBe("Daily at 13:00 UTC");
    // A named admin list and no CRON_SECRET: the scheduler is turned away.
    expect(report.backend.alertsJob.canAuthenticate).toBe(false);
  });

  it("does not call a vendor whose keys are missing", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const report = await buildHealthReport(new Date(NOW));
    const urls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("mapbox"))).toBe(false);
    expect(urls.some((u) => u.includes("googleapis"))).toBe(false);
    expect(report.services.find((s) => s.id === "mapbox")?.status).toBe("not-configured");
  });

  it("flags demo checkout on a production deployment", async () => {
    vi.stubEnv("MOCK_CHECKOUT", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const report = await buildHealthReport(new Date(NOW));
    const payments = report.services.find((s) => s.id === "payments");
    expect(payments?.status).toBe("degraded");
    expect(payments?.reason).toContain("without payment");
  });
});
