/**
 * The admin panel's System health: every outside service, whether it
 * is set up, whether it answers, and what the product's real calls to
 * it have been getting back.
 *
 * TWO KINDS OF EVIDENCE, kept apart and then combined.
 *
 *   A live probe is a call made now, on a FREE endpoint only: an
 *   account check, a token check, a metadata lookup, a write to our own
 *   store. It answers "is the key good and the vendor reachable".
 *
 *   The passive record is what the fetch observer saw the product's own
 *   calls get back (lib/admin/telemetry). It answers "is the feature
 *   actually working", and it is the only evidence for the paid feeds,
 *   which are never probed because a probe there costs money.
 *
 * A key that passes its probe while the product's last calls failed is
 * "degraded", not "operational": the vendor is up and something between
 * it and the product is not.
 *
 * NOTHING SECRET LEAVES. Keys are tested, never returned; environment
 * variables are reported as present or absent by name; vendor error
 * text goes through the same sanitiser as route errors.
 */

import Anthropic from "@anthropic-ai/sdk";
import vercelConfig from "@/vercel.json";
import { emailConfigured } from "@/lib/alerts/email";
import { pushConfigured } from "@/lib/alerts/push";
import { anthropicClient, assistantConfigured } from "@/lib/assistant/client";
import { accessCodeEnabled } from "@/lib/auth/access-code";
import { adminEmails } from "@/lib/auth/gate";
import { storeConfigured, storeCounts, storeStatus } from "@/lib/db/market-store";
import { serviceConfig } from "@/lib/db/service";
import { mockCheckoutEnabled, planTablesReady } from "@/lib/db/usage";
import { mapboxToken } from "@/lib/live/aerial";
import { hasAirRoiKey } from "@/lib/live/airroi";
import { phoneLookupConfigured } from "@/lib/live/phone-lookup";
import { scraperUsage } from "@/lib/live/scraper-usage";
import { googleMapsKey } from "@/lib/live/street-view";
import { authConfigured } from "@/lib/supabase/config";
import { asProbe } from "./probe-scope";
import {
  SERVICES,
  supabaseProjectUrl,
  type DashboardLink,
  type ProbeKind,
  type ServiceCategory,
  type ServiceId,
  type ServiceSpec,
} from "./services";
import {
  isAccountKind,
  isHealthyKind,
  readTelemetry,
  sanitize,
  type CallRecord,
  type JobRun,
  type RouteErrorRecord,
  type ServiceTelemetry,
  type TelemetrySnapshot,
} from "./telemetry";

export type HealthStatus = "operational" | "degraded" | "down" | "not-configured" | "idle";

export interface ProbeResult {
  ok: boolean;
  /** Working, with a caveat worth acting on: slow, rate-limited, nearly out of credits. */
  degraded: boolean;
  ms: number;
  detail: string;
}

export interface CallSummary {
  /** Calls the observer recorded in the last 24 hours. */
  calls24h: number;
  failures24h: number;
  last: CallRecord | null;
  lastOkAt: string | null;
  lastFail: CallRecord | null;
}

export interface ServiceHealth {
  id: ServiceId;
  name: string;
  category: ServiceCategory;
  purpose: string;
  usedBy: string[];
  billing: string;
  probeKind: ProbeKind;
  critical: boolean;
  note: string | null;
  dashboards: DashboardLink[];
  configured: boolean;
  env: { name: string; present: boolean; optional: boolean }[];
  status: HealthStatus;
  /** One line: why the status is what it is. */
  reason: string;
  probe: ProbeResult | null;
  calls: CallSummary | null;
  /** Account figures where the vendor publishes them for free. */
  metrics: { label: string; value: string }[];
}

export interface HealthReport {
  checkedAt: string;
  overall: {
    status: Exclude<HealthStatus, "not-configured" | "idle">;
    headline: string;
    counts: Record<HealthStatus, number>;
  };
  services: ServiceHealth[];
  backend: {
    database: { ok: boolean; detail: string };
    auth: { ok: boolean; detail: string };
    planTables: { ok: boolean; detail: string };
    cache: { markets: number; keyed: number; detail: string | null };
    routeErrors: { last24h: number; recent: RouteErrorRecord[] };
    alertsJob: { schedule: string | null; lastRun: JobRun | null; canAuthenticate: boolean };
    access: { adminsNamed: number; cronSecret: boolean; accessCode: boolean };
  };
  deployment: {
    environment: string;
    region: string | null;
    commit: string | null;
    branch: string | null;
    runtime: string;
  };
  /** False when the shared store could not be read, so call history is
   *  this server instance's memory only. */
  telemetryShared: boolean;
}

const PROBE_TIMEOUT_MS = 8_000;
/** A probe slower than this answered, but a member would feel it. */
const SLOW_MS = 4_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Probes — free endpoints only                                        */
/* ------------------------------------------------------------------ */

type Verdict = { ok: boolean; degraded?: boolean; detail: string };

async function timed(fn: () => Promise<Verdict>): Promise<ProbeResult> {
  const started = performance.now();
  let v: Verdict;
  try {
    v = await asProbe(fn);
  } catch {
    v = { ok: false, detail: "the check itself failed unexpectedly" };
  }
  const ms = Math.round(performance.now() - started);
  const slow = v.ok && ms > SLOW_MS;
  return {
    ok: v.ok,
    degraded: Boolean(v.degraded) || slow,
    ms,
    detail: slow && !v.degraded ? `${v.detail} — slow (${(ms / 1000).toFixed(1)}s)` : v.detail,
  };
}

async function getJson(
  url: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

async function probeSupabase(): Promise<{ probe: ProbeResult; plan: { ok: boolean; detail: string }; db: { ok: boolean; detail: string } }> {
  let plan = { ok: false, detail: "not checked" };
  let db = { ok: false, detail: "not checked" };
  const probe = await timed(async () => {
    if (!storeConfigured()) return { ok: false, detail: "server store keys are not set" };
    const [store, tables] = await Promise.all([
      storeStatus().catch(() => ({ ok: false, detail: "store check threw" })),
      planTablesReady().catch(() => ({ usage: false, credits: false, detail: "plan check threw" })),
    ]);
    db = { ok: store.ok, detail: store.ok ? "writes and reads back" : sanitize(store.detail) };
    const tablesOk = tables.usage && tables.credits;
    plan = { ok: tablesOk, detail: tablesOk ? "usage and credit tables reachable" : sanitize(tables.detail ?? "plan tables missing") };
    if (!store.ok) return { ok: false, detail: `database write failed: ${db.detail}` };
    if (!authConfigured()) return { ok: true, degraded: true, detail: "database works; sign-in keys are not set" };
    if (!tablesOk) return { ok: true, degraded: true, detail: `database works; ${plan.detail}` };
    return { ok: true, detail: "database writes and reads back; plan tables reachable" };
  });
  return { probe, plan, db };
}

async function probeScraper(): Promise<{ probe: ProbeResult; metrics: { label: string; value: string }[] }> {
  const metrics: { label: string; value: string }[] = [];
  const probe = await timed(async () => {
    const u = await scraperUsage();
    if (!u.ok) {
      const err = sanitize(u.error ?? "no answer");
      return { ok: false, detail: /^40[13]\b/.test(err) ? `key rejected (${err.slice(0, 3)})` : err };
    }
    if (u.used !== null && u.limit !== null) {
      metrics.push({
        label: "Credits this cycle",
        value: `${u.used.toLocaleString("en-US")} of ${u.limit.toLocaleString("en-US")}${u.percentUsed !== null ? ` (${u.percentUsed}%)` : ""}`,
      });
    }
    const pct = u.percentUsed;
    if (pct !== null && pct >= 100) return { ok: false, detail: "monthly credit allowance used up" };
    if (pct !== null && pct >= 90) return { ok: true, degraded: true, detail: `account reachable; ${pct}% of credits used` };
    return { ok: true, detail: "account reachable" };
  });
  return { probe, metrics };
}

function probeAnthropic(): Promise<ProbeResult> {
  return timed(async () => {
    try {
      await anthropicClient({ maxRetries: 0 }).models.list({ limit: 1 }, { timeout: PROBE_TIMEOUT_MS });
      return { ok: true, detail: "key accepted" };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return { ok: false, detail: "key rejected (401)" };
      if (error instanceof Anthropic.PermissionDeniedError) {
        return { ok: false, detail: "key lacks access (403) — check ANTHROPIC_WORKSPACE_ID for organisation keys" };
      }
      if (error instanceof Anthropic.RateLimitError) return { ok: true, degraded: true, detail: "rate limited (429)" };
      if (error instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, detail: "timed out" };
      if (error instanceof Anthropic.APIConnectionError) return { ok: false, detail: "unreachable" };
      if (error instanceof Anthropic.APIError) {
        const status = error.status ?? 0;
        return status >= 500
          ? { ok: true, degraded: true, detail: `API answered ${status}` }
          : { ok: false, detail: `API answered ${status}` };
      }
      return { ok: false, detail: "unexpected error" };
    }
  });
}

/** A coordinate with car-driven Street View coverage for years. */
const STREET_VIEW_PROBE = "37.42200,-122.08410";

function probeGoogle(): Promise<ProbeResult> {
  return timed(async () => {
    const key = googleMapsKey();
    if (!key) return { ok: false, detail: "no key" };
    const params = new URLSearchParams({ location: STREET_VIEW_PROBE, key });
    const r = await getJson(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`);
    if (!r) return { ok: false, detail: "unreachable or timed out" };
    const body = (r.body ?? {}) as { status?: string; error_message?: string };
    const status = body.status ?? `HTTP ${r.status}`;
    if (status === "OK" || status === "ZERO_RESULTS") return { ok: true, detail: "key accepted (Street View metadata)" };
    if (status === "OVER_QUERY_LIMIT") return { ok: true, degraded: true, detail: "over quota" };
    if (status === "REQUEST_DENIED") {
      return {
        ok: false,
        detail: `request denied${body.error_message ? `: ${sanitize(body.error_message, 160)}` : ""} — check billing and that Street View Static API is enabled`,
      };
    }
    return { ok: false, detail: sanitize(status, 80) };
  });
}

function probeMapbox(): Promise<ProbeResult> {
  return timed(async () => {
    const token = mapboxToken();
    if (!token) return { ok: false, detail: "no token" };
    const r = await getJson(`https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(token)}`);
    if (!r) return { ok: false, detail: "unreachable or timed out" };
    const code = (r.body as { code?: string } | null)?.code;
    if (code === "TokenValid") return { ok: true, detail: "token valid" };
    if (code) return { ok: false, detail: `token ${code.replace(/^Token/, "").toLowerCase()}` };
    return { ok: false, detail: `HTTP ${r.status}` };
  });
}

function maptilerKey(): string | null {
  return (
    process.env.MAPTILER_KEY?.trim() ||
    process.env.NEXT_MAPTILER_KEY?.trim() ||
    process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ||
    null
  );
}

function probeMaptiler(): Promise<ProbeResult> {
  return timed(async () => {
    const key = maptilerKey();
    if (!key) return { ok: false, detail: "no key" };
    const map = process.env.MAPTILER_MAP?.trim() || "dataviz-light";
    const r = await getJson(
      `https://api.maptiler.com/maps/${encodeURIComponent(map)}/style.json?key=${encodeURIComponent(key)}`
    );
    if (!r) return { ok: false, detail: "unreachable or timed out" };
    if (r.status === 200) return { ok: true, detail: `style "${map}" served` };
    if (r.status === 403) return { ok: false, detail: "key rejected or restricted (403)" };
    if (r.status === 404) return { ok: false, detail: `map "${map}" not found — check MAPTILER_MAP` };
    return { ok: false, detail: `HTTP ${r.status}` };
  });
}

function probeCensus(): Promise<ProbeResult> {
  return timed(async () => {
    const params = new URLSearchParams({
      address: "4600 Silver Hill Rd, Washington, DC 20233",
      benchmark: "Public_AR_Current",
      format: "json",
    });
    const r = await getJson(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`
    );
    if (!r) return { ok: false, detail: "unreachable or timed out" };
    if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
    const matches = (r.body as { result?: { addressMatches?: unknown[] } } | null)?.result?.addressMatches;
    return Array.isArray(matches) && matches.length > 0
      ? { ok: true, detail: "geocoded a known address" }
      : { ok: true, degraded: true, detail: "answered, but matched nothing" };
  });
}

/** The domain an ALERTS_FROM value sends from — "AirCore <a@b.com>" or "a@b.com". */
export function senderDomain(from: string | undefined): string | null {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*>?\s*$/.exec(from?.trim() ?? "");
  return m ? m[1].toLowerCase() : null;
}

function probeResend(): Promise<ProbeResult> {
  return timed(async () => {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) return { ok: false, detail: "no key" };
    const r = await getJson("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!r) return { ok: false, detail: "unreachable or timed out" };
    const body = r.body as { name?: string; data?: { name?: string; status?: string }[] } | null;
    // A sending-only key may not list domains, and that refusal is
    // itself proof the key is real.
    if (r.status === 401 && body?.name === "restricted_api_key") {
      return { ok: true, detail: "sending-only key accepted" };
    }
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `key rejected (${r.status})` };
    if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
    const domain = senderDomain(process.env.ALERTS_FROM);
    if (!domain) return { ok: true, degraded: true, detail: "key accepted; ALERTS_FROM has no sender address" };
    const found = (body?.data ?? []).find((d) => d.name?.toLowerCase() === domain);
    if (!found) return { ok: true, degraded: true, detail: `key accepted; ${domain} is not a domain on this account` };
    if (found.status !== "verified") {
      return { ok: true, degraded: true, detail: `key accepted; ${domain} is ${found.status ?? "not verified"}` };
    }
    return { ok: true, detail: `key accepted; ${domain} verified` };
  });
}

/* ------------------------------------------------------------------ */
/* Judging                                                             */
/* ------------------------------------------------------------------ */

export function envPresence(spec: ServiceSpec, env: NodeJS.ProcessEnv = process.env) {
  const keys = Object.keys(env);
  const has = (name: string) => {
    const exact = env[name]?.trim();
    if (exact) return true;
    const lower = name.toLowerCase();
    return keys.some((k) => k.toLowerCase() === lower && Boolean(env[k]?.trim()));
  };
  return spec.env.map((entry) => {
    const optional = entry.endsWith("?");
    const names = entry.replace(/\?$/, "").split("|");
    const hit = names.find(has);
    return { name: hit ?? names[0], present: Boolean(hit), optional };
  });
}

export function summariseCalls(t: ServiceTelemetry | undefined, now: number): CallSummary | null {
  if (!t) return null;
  const day = t.recent.filter((r) => now - Date.parse(r.at) <= DAY_MS);
  return {
    calls24h: day.length,
    failures24h: day.filter((r) => !isHealthyKind(r.kind)).length,
    last: t.recent[0] ?? null,
    lastOkAt: t.lastOkAt,
    lastFail: t.lastFail,
  };
}

function describeCall(r: CallRecord): string {
  const what = r.status === null ? "no response" : `HTTP ${r.status}`;
  switch (r.kind) {
    case "auth":
      return `${what} — key refused`;
    case "billing":
      return `${what} — payment or balance required`;
    case "rate-limited":
      return `${what} — rate limited`;
    case "network":
      return "no response (refused or timed out)";
    default:
      return what;
  }
}

/**
 * What the product's own recent calls say, over the last day.
 *
 * The newest call leads: a refusal of the account is "down" at once,
 * because no amount of earlier success makes a revoked key work. A
 * newest call that worked is "operational" unless a large share of the
 * day failed. A newest call that failed is "degraded" until three in a
 * row have, which is the point it stops looking like one bad target.
 */
export function judgeCalls(
  t: ServiceTelemetry | undefined,
  now: number
): { status: HealthStatus; reason: string } {
  const day = (t?.recent ?? []).filter((r) => now - Date.parse(r.at) <= DAY_MS);
  if (day.length === 0) return { status: "idle", reason: "no product calls in the last 24 hours" };
  const latest = day[0];
  if (isAccountKind(latest.kind)) {
    return { status: "down", reason: `last call refused: ${describeCall(latest)}` };
  }
  const failed = day.filter((r) => !isHealthyKind(r.kind)).length;
  if (isHealthyKind(latest.kind)) {
    if (day.length >= 5 && failed / day.length >= 0.4) {
      return { status: "degraded", reason: `${failed} of the last ${day.length} calls failed` };
    }
    return {
      status: "operational",
      reason: failed ? `last call worked; ${failed} of ${day.length} failed today` : `last ${day.length} call${day.length === 1 ? "" : "s"} worked`,
    };
  }
  let streak = 0;
  for (const r of day) {
    if (isHealthyKind(r.kind)) break;
    streak += 1;
  }
  return streak >= 3
    ? { status: "down", reason: `last ${streak} calls failed (latest: ${describeCall(latest)})` }
    : { status: "degraded", reason: `last call failed: ${describeCall(latest)}` };
}

/**
 * Probe and record into one status.
 *
 * The probe says whether the key works; the record says whether the
 * feature does. A probe that fails is "down" whatever the record says.
 * A probe that passes is lowered to "degraded" by a failing record.
 */
export function combine(
  probe: ProbeResult | null,
  passive: { status: HealthStatus; reason: string } | null
): { status: HealthStatus; reason: string } {
  if (!probe) return passive ?? { status: "idle", reason: "nothing to check" };
  if (!probe.ok) return { status: "down", reason: probe.detail };
  if (passive && (passive.status === "down" || passive.status === "degraded")) {
    return { status: "degraded", reason: `${probe.detail}; product calls failing — ${passive.reason}` };
  }
  return { status: probe.degraded ? "degraded" : "operational", reason: probe.detail };
}

const ZERO_COUNTS: Record<HealthStatus, number> = {
  operational: 0,
  degraded: 0,
  down: 0,
  "not-configured": 0,
  idle: 0,
};

export function rollUp(services: Pick<ServiceHealth, "name" | "status" | "critical">[]): HealthReport["overall"] {
  const counts = { ...ZERO_COUNTS };
  for (const s of services) counts[s.status] += 1;
  // A critical service missing its keys is an outage of the feature it
  // carries, even though nothing is "failing".
  const criticalOut = services.filter(
    (s) => s.critical && (s.status === "down" || s.status === "not-configured")
  );
  const anyDown = services.filter((s) => s.status === "down");
  const degraded = services.filter((s) => s.status === "degraded");
  if (criticalOut.length > 0) {
    return {
      status: "down",
      headline: `${criticalOut.map((s) => s.name).join(", ")} ${criticalOut.length === 1 ? "is" : "are"} down — core features affected`,
      counts,
    };
  }
  if (anyDown.length > 0 || degraded.length > 0) {
    const names = [...anyDown, ...degraded].map((s) => s.name);
    return {
      status: "degraded",
      headline: `${names.length} service${names.length === 1 ? " needs" : "s need"} attention: ${names.join(", ")}`,
      counts,
    };
  }
  return { status: "operational", headline: "All configured services are operational", counts };
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

const CONFIGURED: Record<ServiceId, () => boolean> = {
  supabase: () => storeConfigured() && authConfigured(),
  vercel: () => true,
  rentcast: () => Boolean(process.env.RENTCAST_API_KEY?.trim()),
  airroi: hasAirRoiKey,
  scraperapi: () => Boolean(process.env.SCRAPERAPI_KEY?.trim()),
  dataskip: phoneLookupConfigured,
  anthropic: assistantConfigured,
  "google-maps": () => googleMapsKey() !== null,
  mapbox: () => mapboxToken() !== null,
  maptiler: () => maptilerKey() !== null,
  census: () => true,
  resend: emailConfigured,
  webpush: pushConfigured,
  "public-web": () => true,
  payments: () => false,
};

export async function buildHealthReport(now: Date = new Date()): Promise<HealthReport> {
  const configured = Object.fromEntries(
    SERVICES.map((s) => [s.id, safely(CONFIGURED[s.id])])
  ) as Record<ServiceId, boolean>;

  const ifSet = <T,>(id: ServiceId, run: () => Promise<T>): Promise<T | null> =>
    configured[id] ? run() : Promise.resolve(null);

  const [supa, scraper, anthropic, google, mapbox, maptiler, census, resend, telemetry, counts] =
    await Promise.all([
      probeSupabase(),
      ifSet("scraperapi", probeScraper),
      ifSet("anthropic", probeAnthropic),
      ifSet("google-maps", probeGoogle),
      ifSet("mapbox", probeMapbox),
      ifSet("maptiler", probeMaptiler),
      probeCensus(),
      ifSet("resend", probeResend),
      readTelemetry().catch((): TelemetrySnapshot => ({ services: {}, errors: [], jobs: {}, shared: false })),
      storeCounts().catch(() => ({ markets: 0, marketsWithStats: 0, keyed: 0, error: "unreachable" })),
    ]);

  const probes: Partial<Record<ServiceId, ProbeResult | null>> = {
    supabase: supa.probe,
    scraperapi: scraper?.probe ?? null,
    anthropic,
    "google-maps": google,
    mapbox,
    maptiler,
    census,
    resend,
  };
  const t = now.getTime();
  const supabaseLink = supabaseProjectUrl(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL);

  const services: ServiceHealth[] = SERVICES.map((spec) => {
    const isConfigured = configured[spec.id];
    const probe = probes[spec.id] ?? null;
    const calls = summariseCalls(telemetry.services[spec.id], t);
    const passive = spec.hosts.length > 0 ? judgeCalls(telemetry.services[spec.id], t) : null;
    let verdict: { status: HealthStatus; reason: string };

    if (spec.id === "vercel") {
      verdict = { status: "operational", reason: "serving this request" };
    } else if (spec.id === "payments") {
      verdict = mockCheckoutEnabled()
        ? {
            status: process.env.VERCEL_ENV === "production" ? "degraded" : "not-configured",
            reason: "Demo checkout is ON — plans and packs are granted without payment",
          }
        : { status: "not-configured", reason: "No payment processor wired; checkout answers that it is not live" };
    } else if (!isConfigured) {
      verdict = { status: "not-configured", reason: "required settings are missing" };
    } else if (spec.probe === "config") {
      verdict = { status: "operational", reason: "keys are set" };
    } else {
      verdict = combine(probe, passive);
    }

    const dashboards =
      spec.id === "supabase" && supabaseLink
        ? [{ label: "This project", url: supabaseLink }, ...spec.dashboards]
        : spec.dashboards;

    return {
      id: spec.id,
      name: spec.name,
      category: spec.category,
      purpose: spec.purpose,
      usedBy: spec.usedBy,
      billing: spec.billing,
      probeKind: spec.probe,
      critical: spec.critical,
      note: spec.note ?? null,
      dashboards,
      configured: isConfigured,
      env: envPresence(spec),
      status: verdict.status,
      reason: verdict.reason,
      probe,
      calls,
      metrics: spec.id === "scraperapi" ? (scraper?.metrics ?? []) : [],
    };
  });

  const errors24h = telemetry.errors.filter((e) => t - Date.parse(e.at) <= DAY_MS);
  const cron = vercelConfig.crons?.find((c) => c.path === "/api/alerts/run") ?? null;
  const cronSecret = Boolean(process.env.CRON_SECRET?.trim());

  return {
    checkedAt: now.toISOString(),
    overall: rollUp(services),
    services,
    backend: {
      database: supa.db,
      auth: authConfigured()
        ? { ok: true, detail: "sign-in keys set" }
        : { ok: false, detail: "NEXT_PUBLIC_SUPABASE_URL or the publishable key is missing — nobody can sign in" },
      planTables: supa.plan,
      cache: {
        markets: Math.max(0, counts.markets),
        keyed: Math.max(0, counts.keyed),
        detail: counts.error ? sanitize(counts.error) : null,
      },
      routeErrors: { last24h: errors24h.length, recent: telemetry.errors },
      alertsJob: {
        schedule: cron ? describeCron(cron.schedule) : null,
        lastRun: telemetry.jobs.alerts ?? null,
        // The scheduler authenticates with CRON_SECRET; without it the
        // operator gate turns the run away once ADMIN_EMAILS is set.
        canAuthenticate: cronSecret || adminEmails().size === 0,
      },
      access: { adminsNamed: adminEmails().size, cronSecret, accessCode: accessCodeEnabled() },
    },
    deployment: {
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      region: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      runtime: `Node ${process.version}`,
    },
    telemetryShared: telemetry.shared && serviceConfig() !== null,
  };
}

function safely(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/** "0 13 * * *" → "Daily at 13:00 UTC". Anything else is shown as written. */
export function describeCron(schedule: string): string {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!m) return `${schedule} (UTC)`;
  return `Daily at ${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")} UTC`;
}
