/**
 * Daily ceiling on distinct live searches — the spend guard.
 *
 * RentCast bills per request, and our per-area responses cache for 24
 * hours, so the real cost driver is how many DISTINCT markets and ZIPs
 * get searched in a day, not how many people search them. This counts
 * exactly that: the first search of an area reserves a slot; every
 * repeat that day rides the cache for free and never counts again.
 *
 * A slot is only committed after a request actually succeeds, so a
 * rejected key or an unreachable feed can't eat the day's budget.
 *
 * Scope note: the ledger lives in server memory, so each running
 * instance keeps its own count. That makes this a spend GUARD, not a
 * hard billing lock — with several instances warm, the true ceiling is
 * a small multiple of the cap. Move the ledger to a shared store (Vercel
 * KV, Redis) if you ever need the cap to be exact.
 */

/** Default ceiling: RentCast's free Developer tier is 50 requests. */
export const DEFAULT_DAILY_LIVE_SEARCH_CAP = 50;

export function dailyCap(): number {
  const raw = Number(process.env.LIVE_SEARCH_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_DAILY_LIVE_SEARCH_CAP;
}

interface Ledger {
  day: string;
  keys: Set<string>;
}

let ledger: Ledger = { day: "", keys: new Set() };

/** UTC day — a fixed, predictable reset the whole fleet agrees on. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function currentLedger(now: Date): Ledger {
  const day = dayKey(now);
  if (ledger.day !== day) ledger = { day, keys: new Set() };
  return ledger;
}

export interface QuotaCheck {
  allowed: boolean;
  /** True when this area was already fetched today — cache-served, free. */
  cached: boolean;
  /** Distinct areas still available today. */
  remaining: number;
  cap: number;
}

/** May this area be fetched live right now? Doesn't consume anything. */
export function checkLiveSearch(key: string, now = new Date()): QuotaCheck {
  const cap = dailyCap();
  const { keys } = currentLedger(now);
  const cached = keys.has(key);
  const remaining = Math.max(0, cap - keys.size);
  return { allowed: cached || keys.size < cap, cached, remaining, cap };
}

/** Record a SUCCESSFUL live fetch. Failures never consume a slot. */
export function commitLiveSearch(key: string, now = new Date()): QuotaCheck {
  const cap = dailyCap();
  const l = currentLedger(now);
  l.keys.add(key);
  return {
    allowed: true,
    cached: false,
    remaining: Math.max(0, cap - l.keys.size),
    cap,
  };
}

/** Tests only — drops today's ledger. */
export function resetLiveSearchLedger(): void {
  ledger = { day: "", keys: new Set() };
}
