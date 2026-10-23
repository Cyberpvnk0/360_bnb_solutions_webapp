/**
 * What the product's own calls to its vendors actually did.
 *
 * THE PAID FEEDS CANNOT BE PINGED. Asking RentCast or AirROI "are you
 * up?" is a billed request, so the health panel cannot probe them on
 * every refresh. What it can do is remember: every outbound call the
 * server makes to a known vendor host is seen by the fetch observer
 * (instrumentation.ts), and its status code and latency land here. The
 * panel then says what the last real calls said — which is the more
 * honest answer anyway, since a vendor that answers a ping and refuses
 * the product's actual request is not healthy.
 *
 * NOTHING SENSITIVE IS KEPT. A record is a time, a status code, a
 * latency and a coarse kind. Never a URL: half these vendors take the
 * key in the query string. Never a body. Route error messages are run
 * through `sanitize`, which strips query strings, credentials, tokens
 * and email addresses before anything is stored.
 *
 * MEMORY, THEN THE SHARED STORE. A serverless deployment runs many
 * short-lived instances, and the one answering the health route is
 * rarely the one that called RentCast. So each instance keeps its own
 * window in memory and folds it into a row in the shared store —
 * read, merge, write — at most once a minute per service, and at once
 * when a service flips between working and failing. Instances racing
 * on the same row can lose a record or two; this is a health gauge,
 * not a ledger, and the merge never loses a newer timestamp.
 *
 * Observation must never break the thing observed: every entry point
 * here swallows its own failures.
 */

import { readKeyedBlobs, writeKeyed } from "@/lib/db/market-store";
import { SERVICES, type ServiceId } from "./services";

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

/**
 * What one response means for the vendor's health — not for the caller.
 *
 * A 404 is the vendor working: the scraper asked for a listing page
 * that has come down and was told so. A 401/403 or 402 is the account
 * itself refusing, which no retry fixes. A 5xx from the scraper is
 * usually the TARGET site failing behind it, so it is a warning, not a
 * verdict, until it is the only thing the vendor says.
 */
export type CallKind =
  | "ok"
  | "not-found"
  | "auth"
  | "billing"
  | "rate-limited"
  | "client"
  | "server"
  | "network";

export function classifyStatus(status: number | null): CallKind {
  if (status === null) return "network";
  if (status < 400) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "billing";
  if (status === 429) return "rate-limited";
  if (status === 404 || status === 410) return "not-found";
  if (status < 500) return "client";
  return "server";
}

/** The vendor answered as a working vendor does. */
export function isHealthyKind(kind: CallKind): boolean {
  return kind === "ok" || kind === "not-found";
}

/** The account itself was refused — a key or a balance, not a blip. */
export function isAccountKind(kind: CallKind): boolean {
  return kind === "auth" || kind === "billing";
}

export interface CallRecord {
  /** ISO time the response (or the failure) arrived. */
  at: string;
  kind: CallKind;
  /** HTTP status, or null when no response arrived at all. */
  status: number | null;
  /** Whole milliseconds from request to response headers. */
  ms: number;
}

export interface ServiceTelemetry {
  /** Newest first, at most RECENT_MAX. */
  recent: CallRecord[];
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastFail: CallRecord | null;
}

export const RECENT_MAX = 20;
const PERSIST_EVERY_MS = 60_000;

const EMPTY: ServiceTelemetry = { recent: [], lastOkAt: null, lastFailAt: null, lastFail: null };

interface Memory extends ServiceTelemetry {
  persistedAt: number;
  /** Whether the last thing this instance stored was working or failing. */
  persistedHealthy: boolean | null;
  persisting: boolean;
}

const memory = new Map<ServiceId, Memory>();

function slot(service: ServiceId): Memory {
  let s = memory.get(service);
  if (!s) {
    s = { ...EMPTY, recent: [], persistedAt: 0, persistedHealthy: null, persisting: false };
    memory.set(service, s);
  }
  return s;
}

export function serviceKey(service: ServiceId): string {
  return `health:svc:${service}`;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

const KINDS: readonly CallKind[] = [
  "ok",
  "not-found",
  "auth",
  "billing",
  "rate-limited",
  "client",
  "server",
  "network",
];

function isRecord(v: unknown): v is CallRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.at === "string" &&
    typeof r.kind === "string" &&
    (KINDS as readonly string[]).includes(r.kind) &&
    (r.status === null || typeof r.status === "number") &&
    typeof r.ms === "number"
  );
}

/** A stored row, read defensively: anything malformed is an empty window. */
export function parseTelemetry(value: unknown): ServiceTelemetry {
  if (!value || typeof value !== "object") return { ...EMPTY, recent: [] };
  const v = value as Record<string, unknown>;
  const recent = Array.isArray(v.recent) ? v.recent.filter(isRecord) : [];
  return {
    recent,
    lastOkAt: typeof v.lastOkAt === "string" ? v.lastOkAt : null,
    lastFailAt: typeof v.lastFailAt === "string" ? v.lastFailAt : null,
    lastFail: isRecord(v.lastFail) ? v.lastFail : null,
  };
}

/**
 * Two views of one service, folded into one.
 *
 * The windows are unioned and de-duplicated — an instance that stores
 * twice sends the same records twice — then cut to the newest
 * RECENT_MAX. Timestamps take the later of the two, so whichever
 * instance writes last can never move "last worked" backwards.
 */
export function mergeTelemetry(a: ServiceTelemetry, b: ServiceTelemetry): ServiceTelemetry {
  const seen = new Set<string>();
  const recent = [...a.recent, ...b.recent]
    .filter((r) => {
      const id = `${r.at}|${r.status}|${r.ms}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
    .slice(0, RECENT_MAX);
  const lastFailAt = laterIso(a.lastFailAt, b.lastFailAt);
  const lastFail =
    lastFailAt === null
      ? null
      : a.lastFail?.at === lastFailAt
        ? a.lastFail
        : b.lastFail?.at === lastFailAt
          ? b.lastFail
          : (a.lastFail ?? b.lastFail);
  return { recent, lastOkAt: laterIso(a.lastOkAt, b.lastOkAt), lastFailAt, lastFail };
}

function snapshot(s: Memory): ServiceTelemetry {
  return { recent: s.recent, lastOkAt: s.lastOkAt, lastFailAt: s.lastFailAt, lastFail: s.lastFail };
}

async function persistService(service: ServiceId): Promise<void> {
  const s = slot(service);
  if (s.persisting) return;
  s.persisting = true;
  try {
    const key = serviceKey(service);
    const stored = (await readKeyedBlobs([key])).get(key)?.value;
    const merged = mergeTelemetry(parseTelemetry(stored), snapshot(s));
    const written = await writeKeyed(key, merged);
    if (written.ok) {
      s.persistedAt = Date.now();
      s.persistedHealthy = s.recent[0] ? isHealthyKind(s.recent[0].kind) : null;
    }
  } catch {
    // A health row that could not be stored is retried on the next call.
  } finally {
    s.persisting = false;
  }
}

/**
 * One finished call to a vendor. Called by the fetch observer; never
 * throws, never awaits the store.
 */
export function recordCall(
  service: ServiceId,
  status: number | null,
  ms: number,
  now: Date = new Date()
): void {
  try {
    const rec: CallRecord = {
      at: now.toISOString(),
      kind: classifyStatus(status),
      status,
      ms: Math.max(0, Math.round(ms)),
    };
    const s = slot(service);
    s.recent.unshift(rec);
    if (s.recent.length > RECENT_MAX) s.recent.length = RECENT_MAX;
    const healthy = isHealthyKind(rec.kind);
    if (healthy) s.lastOkAt = rec.at;
    else {
      s.lastFailAt = rec.at;
      s.lastFail = rec;
    }
    const flipped = s.persistedHealthy !== null && s.persistedHealthy !== healthy;
    if (flipped || now.getTime() - s.persistedAt >= PERSIST_EVERY_MS) {
      void persistService(service);
    }
  } catch {
    // Observation never breaks the observed call.
  }
}

/* ------------------------------------------------------------------ */
/* Route errors                                                        */
/* ------------------------------------------------------------------ */

export interface RouteErrorRecord {
  at: string;
  /** Path only — the query string is dropped before it is kept. */
  path: string;
  method: string;
  /** Route handler, page render, server action or proxy. */
  kind: string;
  message: string;
  digest: string | null;
}

export const ERRORS_KEY = "health:errors";
export const ERRORS_MAX = 30;
const ERRORS_PERSIST_EVERY_MS = 10_000;

const errorMemory: { list: RouteErrorRecord[]; persistedAt: number; persisting: boolean } = {
  list: [],
  persistedAt: 0,
  persisting: false,
};

/**
 * An error message made safe to keep and show.
 *
 * An exception can carry anything the code around it was holding: a
 * vendor URL with its key in the query string, a bearer token, a JWT,
 * a member's email. Every one of those is cut here, and the result is
 * collapsed to one line and capped, before it is stored or returned.
 */
export function sanitize(text: string, max = 300): string {
  return text
    .replace(/https?:\/\/[^\s"'<>)]+/gi, (u) => {
      try {
        const x = new URL(u);
        return `${x.origin}${x.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    // Key shapes: Anthropic sk-ant-…, Supabase sb_secret_/sb_publishable_…,
    // Resend re_…, and the common sk_/pk_ pairs. Underscore only for the
    // short prefixes, so "re-render" is a word and not a credential.
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(?:sb_secret|sb_publishable|sk|pk|re)_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|secret|password|key)(\s*[=:]\s*)["']?[^\s&"',;)]+/gi,
      "$1$2[redacted]"
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseErrors(value: unknown): RouteErrorRecord[] {
  const list = (value as { list?: unknown } | null)?.list;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is RouteErrorRecord => {
    if (!e || typeof e !== "object") return false;
    const r = e as Record<string, unknown>;
    return (
      typeof r.at === "string" &&
      typeof r.path === "string" &&
      typeof r.method === "string" &&
      typeof r.kind === "string" &&
      typeof r.message === "string" &&
      (r.digest === null || typeof r.digest === "string")
    );
  });
}

export function mergeErrors(a: RouteErrorRecord[], b: RouteErrorRecord[]): RouteErrorRecord[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((e) => {
      const id = `${e.at}|${e.path}|${e.digest ?? e.message}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
    .slice(0, ERRORS_MAX);
}

async function persistErrors(): Promise<void> {
  if (errorMemory.persisting) return;
  errorMemory.persisting = true;
  try {
    const stored = (await readKeyedBlobs([ERRORS_KEY])).get(ERRORS_KEY)?.value;
    const list = mergeErrors(parseErrors(stored), errorMemory.list);
    const written = await writeKeyed(ERRORS_KEY, { list });
    if (written.ok) errorMemory.persistedAt = Date.now();
  } catch {
    // Retried on the next error.
  } finally {
    errorMemory.persisting = false;
  }
}

/** One server error, as instrumentation's onRequestError hands it over. */
export function recordRouteError(
  input: { path: string; method: string; kind: string; error: unknown },
  now: Date = new Date()
): void {
  try {
    const err = input.error;
    const raw =
      err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : "non-Error thrown";
    const digest =
      typeof err === "object" && err !== null && "digest" in err && typeof err.digest === "string"
        ? err.digest.slice(0, 64)
        : null;
    const rec: RouteErrorRecord = {
      at: now.toISOString(),
      path: sanitize(input.path.split("?")[0] ?? "/", 160),
      method: input.method.toUpperCase().slice(0, 10),
      kind: input.kind.slice(0, 40),
      message: sanitize(raw),
      digest,
    };
    errorMemory.list = mergeErrors([rec], errorMemory.list);
    if (now.getTime() - errorMemory.persistedAt >= ERRORS_PERSIST_EVERY_MS) void persistErrors();
  } catch {
    // An error while recording an error stays quiet.
  }
}

/* ------------------------------------------------------------------ */
/* Scheduled jobs                                                      */
/* ------------------------------------------------------------------ */

export type JobId = "alerts";

export interface JobRun {
  at: string;
  ok: boolean;
  detail: string | null;
}

export function jobKey(job: JobId): string {
  return `health:job:${job}`;
}

/** A scheduled run finished. Awaitable, so a route can store it before
 *  it returns; failures are swallowed either way. */
export async function recordJob(job: JobId, ok: boolean, detail: string | null): Promise<void> {
  try {
    const run: JobRun = {
      at: new Date().toISOString(),
      ok,
      detail: detail === null ? null : sanitize(detail, 240),
    };
    await writeKeyed(jobKey(job), run);
  } catch {
    // The run itself already happened; only its record is lost.
  }
}

function parseJob(value: unknown): JobRun | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== "string" || typeof v.ok !== "boolean") return null;
  return { at: v.at, ok: v.ok, detail: typeof v.detail === "string" ? v.detail : null };
}

/* ------------------------------------------------------------------ */
/* Reading it all back                                                 */
/* ------------------------------------------------------------------ */

export interface TelemetrySnapshot {
  services: Partial<Record<ServiceId, ServiceTelemetry>>;
  errors: RouteErrorRecord[];
  jobs: Partial<Record<JobId, JobRun>>;
  /** False when the shared store could not be read, so the figures are
   *  this one instance's memory only. */
  shared: boolean;
}

export async function readTelemetry(): Promise<TelemetrySnapshot> {
  const observed = SERVICES.filter((s) => s.hosts.length > 0).map((s) => s.id);
  const keys = [...observed.map(serviceKey), ERRORS_KEY, jobKey("alerts")];
  let stored = new Map<string, { value: Record<string, unknown>; at: string | null }>();
  let shared = true;
  try {
    stored = await readKeyedBlobs(keys);
  } catch {
    shared = false;
  }

  const services: Partial<Record<ServiceId, ServiceTelemetry>> = {};
  for (const id of observed) {
    const mem = memory.get(id);
    services[id] = mergeTelemetry(
      parseTelemetry(stored.get(serviceKey(id))?.value),
      mem ? snapshot(mem) : { ...EMPTY, recent: [] }
    );
  }
  const errors = mergeErrors(parseErrors(stored.get(ERRORS_KEY)?.value), errorMemory.list);
  const alerts = parseJob(stored.get(jobKey("alerts"))?.value);
  return { services, errors, jobs: alerts ? { alerts } : {}, shared };
}

/** Test seam: forget everything this instance has seen. */
export function resetTelemetryForTests(): void {
  memory.clear();
  errorMemory.list = [];
  errorMemory.persistedAt = 0;
  errorMemory.persisting = false;
}
