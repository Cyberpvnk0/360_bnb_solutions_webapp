/**
 * The plan meter: what an account has spent of its month.
 *
 * SERVER ONLY, AND AUTHORITATIVE. The meter it replaces was a column
 * the browser could write — `profiles.pulls_used`, under the "own
 * profile" policy — which meant anybody could zero their own count
 * from devtools. And it never reset, so a pull in January counted
 * against August. Every analysis costs real money at the data vendor,
 * so the count has to be one the account cannot edit and the month has
 * to be part of the key.
 *
 * Everything here goes through one Postgres function, consume_usage,
 * with the secret key. The function locks the row, so two tabs firing
 * at the same instant cannot both squeeze in as the eleventh of ten.
 * The cap is passed in from config/app beside the prices, and only the
 * server can call it, so the cap can't be forged.
 *
 * DISTINCT, NOT COUNTED. An analysis is keyed by property and size; a
 * market by its slug. A reload of the same analysis, or a second look
 * at the same market, is free — the vendor charged nothing for it and
 * the plan shouldn't either.
 *
 * ONE POOL. Analyses and market searches draw on the same monthly
 * credits, and both may draw on a pack once the plan is spent. The two
 * are still recorded on their own lists, so the count of each is known,
 * but the cap is the sum.
 *
 * FAILS OPEN. If the store is unreachable the account is allowed
 * through and the reason is reported, because a student being refused
 * an analysis they paid for is a worse outcome than a vendor call the
 * platform's own daily breaker will still bound. Never silently.
 */

import { CREDIT_PACKS, DEFAULT_TIER, TIERS, type PackId, type TierId } from "@/config/app";

/**
 * Whether the demo checkout may fulfil.
 *
 * Nothing in this product takes a card yet. Until a processor's webhook
 * is the thing that sets a tier and grants a pack, the only way to do
 * either is this flag — and a deployment that leaves it on is handing
 * out plans for free, so it is read in one place and named for what it
 * is. MOCK_CHECKOUT=1; the older CREDITS_MOCK_CHECKOUT is honoured too.
 */
export function mockCheckoutEnabled(): boolean {
  return (
    process.env.MOCK_CHECKOUT === "1" || process.env.CREDITS_MOCK_CHECKOUT === "1"
  );
}
import { currentPeriod } from "./usage-period";

type Kind = "analysis" | "market";

export interface UsageCheck {
  allowed: boolean;
  used: number;
  cap: number;
  /** Which meter answered. */
  kind: Kind;
  /** Which pot paid: the month's plan, a purchased pack, nothing (the
   *  key was already claimed), or none. Absent when unmetered. */
  source?: "plan" | "pack" | "cached" | "none";
  /** Pack analyses left on the account after this call. */
  balance?: number;
  /** Set when the store could not be reached and the call was let
   *  through on trust. */
  unmetered?: string;
}

export { currentPeriod } from "./usage-period";

/** The plan's cap for one meter. A tier this code does not know — a
 *  value nothing here wrote — gets the smallest plan, never the default:
 *  a missing profile is a new account, a corrupt one is not. */
/** One pool for both kinds: the plan's credits. An unknown tier gets
 *  the free plan, never a bigger one. */
export function capFor(tier: TierId): number {
  return (TIERS[tier] ?? TIERS.free).creditLimit;
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

const TIMEOUT_MS = 4_000;

/**
 * Claim one key against the account's plan, atomically.
 *
 * `key` is the property-and-size for an analysis (the same key the
 * comps cache uses, so "one analysis" means the same thing to the
 * plan and to the vendor), or the slug for a market.
 */
export async function consumeUsage(
  userId: string,
  tier: TierId,
  kind: Kind,
  key: string,
  now = new Date()
): Promise<UsageCheck> {
  const cap = capFor(tier);
  // A plan with no credits touches nothing that costs money, and packs
  // are only sold to plans that have some — so a zero cap is final,
  // with no round trip to the store.
  if (cap <= 0) return { allowed: false, used: 0, cap, kind, source: "none" };

  const cfg = config();
  if (!cfg) {
    return { allowed: true, used: 0, cap, kind, unmetered: "no store configured" };
  }

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/consume_usage`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_user: userId,
        p_period: currentPeriod(now),
        p_kind: kind,
        p_key: key,
        p_cap: cap,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { allowed: true, used: 0, cap, kind, unmetered: detail || `HTTP ${res.status}` };
    }
    const rows = (await res.json()) as {
      allowed: boolean; used: number; cap: number; source?: string; balance?: number;
    }[];
    const row = rows?.[0];
    if (!row) return { allowed: true, used: 0, cap, kind, unmetered: "empty reply" };
    const source = (["plan", "pack", "cached", "none"] as const).find((s) => s === row.source);
    return {
      allowed: Boolean(row.allowed),
      used: Number(row.used),
      cap,
      kind,
      source,
      balance: Number.isFinite(Number(row.balance)) ? Number(row.balance) : undefined,
    };
  } catch {
    return { allowed: true, used: 0, cap, kind, unmetered: "unreachable or timed out" };
  }
}

/** What the profiles table said about an account's plan. */
export type TierRead =
  /** A plan this code knows. */
  | { kind: "tier"; tier: TierId }
  /** No profile row at all: a brand-new account, or one whose trigger
   *  never ran. */
  | { kind: "none" }
  /** A row whose tier is a string nothing here wrote — 'banned',
   *  'suspended', a typo. Somebody meant something by it. */
  | { kind: "unknown"; value: string }
  /** The store could not be read: no config, an error, a timeout. */
  | { kind: "unreachable"; detail: string };

/**
 * The account's tier, read with the secret key so a caller cannot
 * present a tier it does not hold.
 */
export async function readTier(userId: string): Promise<TierRead> {
  const cfg = config();
  if (!cfg) return { kind: "unreachable", detail: "no store configured" };
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=tier`,
      {
        headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!res.ok) return { kind: "unreachable", detail: `HTTP ${res.status}` };
    const rows = (await res.json()) as { tier?: unknown }[];
    if (!rows?.length) return { kind: "none" };
    const tier = rows[0]?.tier;
    if (typeof tier === "string" && tier in TIERS) return { kind: "tier", tier: tier as TierId };
    return { kind: "unknown", value: String(tier) };
  } catch {
    return { kind: "unreachable", detail: "unreachable or timed out" };
  }
}

/**
 * The plan every server-side check runs against — ONE policy, so the
 * meters, the paid gates and the analyzer cannot disagree.
 *
 *  - A known tier is that tier.
 *  - No row is a new account, and a new account is on DEFAULT_TIER.
 *  - An UNKNOWN value is the smallest plan, never the default. Nothing
 *    in this codebase writes 'banned' or 'suspended'; an operator did,
 *    and the one thing they cannot have meant is "the largest plan".
 *    The old version collapsed this to null and every caller read null
 *    as "new account".
 *  - Unreachable falls to DEFAULT_TIER, for the same reason the meter
 *    fails open: an account refused what it is owed because a database
 *    blinked is the worse outcome, and the vendors' daily breakers still
 *    bound the day.
 */
export async function resolveTier(userId: string): Promise<TierId> {
  const read = await readTier(userId);
  switch (read.kind) {
    case "tier":
      return read.tier;
    case "unknown":
      return "free";
    case "none":
    case "unreachable":
      return DEFAULT_TIER;
  }
}

/** The account's tier when the row carries one this code knows, else
 *  null. Kept for callers that report rather than decide; anything
 *  that spends money goes through resolveTier. */
export async function tierOf(userId: string): Promise<TierId | null> {
  const read = await readTier(userId);
  return read.kind === "tier" ? read.tier : null;
}

/* ------------------------------------------------------------------ */
/* Top-up packs                                                        */
/* ------------------------------------------------------------------ */

export interface GrantResult {
  ok: boolean;
  /** Pack analyses on the account after the call. */
  balance: number;
  /** False when this reference had already been granted — the
   *  processor retried a webhook, and the second call handed out
   *  nothing. Not an error; the purchase is fulfilled either way. */
  granted: boolean;
  detail: string | null;
}

/**
 * Add a pack's analyses to an account, once per payment reference.
 *
 * `ref` is the processor's payment id. The ledger carries a unique
 * index on it for grants, so a webhook retried by the processor cannot
 * hand out the pack twice — the second call reports `granted: false`
 * with the same balance. Server only, secret key only.
 */
export async function grantPack(
  userId: string,
  packId: PackId,
  ref: string
): Promise<GrantResult> {
  const pack = CREDIT_PACKS[packId];
  if (!pack) return { ok: false, balance: 0, granted: false, detail: "unknown pack" };
  const cfg = config();
  if (!cfg) return { ok: false, balance: 0, granted: false, detail: "no store configured" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/grant_credits`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_user: userId,
        p_amount: pack.credits,
        p_reason: `pack:${pack.id}`,
        p_ref: ref,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, balance: 0, granted: false, detail: detail || `HTTP ${res.status}` };
    }
    const rows = (await res.json()) as { balance: number; granted: boolean }[];
    const row = rows?.[0];
    if (!row) return { ok: false, balance: 0, granted: false, detail: "empty reply" };
    return { ok: true, balance: Number(row.balance), granted: Boolean(row.granted), detail: null };
  } catch {
    return { ok: false, balance: 0, granted: false, detail: "unreachable or timed out" };
  }
}

/**
 * The display name — the one profile field a person edits. Written with
 * the secret key like the tier, because the browser has no write on the
 * row at all any more (see auth-schema.sql). Server only.
 */
export async function setFullName(
  userId: string,
  fullName: string
): Promise<{ ok: boolean; detail: string | null }> {
  const cfg = config();
  if (!cfg) return { ok: false, detail: "no store configured" };
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: cfg.key,
          authorization: `Bearer ${cfg.key}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify({ full_name: fullName, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, detail: detail || `HTTP ${res.status}` };
    }
    const rows = (await res.json()) as unknown[];
    if (!rows?.length) return { ok: false, detail: "no profile row" };
    return { ok: true, detail: null };
  } catch {
    return { ok: false, detail: "unreachable or timed out" };
  }
}

/* ------------------------------------------------------------------ */
/* Readiness                                                           */
/* ------------------------------------------------------------------ */

export interface PlanTablesStatus {
  /** The monthly meter exists and the secret key can read it. */
  usage: boolean;
  /** The pack balance and ledger exist and the secret key can read them. */
  credits: boolean;
  /** What the store said when something was missing. */
  detail: string | null;
}

/**
 * Whether the plan tables have been created — the answer to "did the
 * SQL take", from one URL instead of a round of clicking.
 *
 * A zero-row select with the secret key: 200 means the table exists
 * and the grant is there; anything else names what is missing. Reads
 * nothing and writes nothing.
 */
export async function planTablesReady(): Promise<PlanTablesStatus> {
  const cfg = config();
  if (!cfg) return { usage: false, credits: false, detail: "no store configured" };
  const probe = async (table: string): Promise<string | null> => {
    try {
      const res = await fetch(`${cfg.url}/rest/v1/${table}?select=user_id&limit=0`, {
        headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.ok) return null;
      const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      return `${table}: ${body || `HTTP ${res.status}`}`;
    } catch {
      return `${table}: unreachable`;
    }
  };
  const [usage, balance, ledger] = await Promise.all([
    probe("usage"),
    probe("credit_balance"),
    probe("credit_ledger"),
  ]);
  const problems = [usage, balance, ledger].filter((p): p is string => p !== null);
  return {
    usage: usage === null,
    credits: balance === null && ledger === null,
    detail: problems.length ? problems.join("; ") : null,
  };
}

/* ------------------------------------------------------------------ */
/* The plan itself                                                     */
/* ------------------------------------------------------------------ */

export interface SetTierResult {
  ok: boolean;
  tier: TierId;
  detail: string | null;
}

/**
 * Put an account on a plan.
 *
 * Written with the secret key, because the tier is the thing every
 * server-side check reads and the browser must not be able to set it —
 * which, under the "own profile" policy, it technically still can.
 * That policy predates metering; until it is narrowed, the server
 * reading the tier back with the secret key is what keeps a devtools
 * edit from mattering to anything that costs money. (It does not: the
 * meters call tierOf, which reads with the secret key, and a tier the
 * browser wrote is the same row — so narrowing the policy is the real
 * fix and is noted in auth-schema.sql.)
 *
 * The caller is the demo checkout today and a processor's webhook
 * tomorrow. Either way, this is the one place a plan changes.
 */
export async function setTier(userId: string, tier: TierId): Promise<SetTierResult> {
  if (!(tier in TIERS)) return { ok: false, tier: "free", detail: "unknown tier" };
  const cfg = config();
  if (!cfg) return { ok: false, tier, detail: "no store configured" };
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: cfg.key,
          authorization: `Bearer ${cfg.key}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify({ tier, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, tier, detail: detail || `HTTP ${res.status}` };
    }
    const rows = (await res.json()) as { tier?: string }[];
    // Zero rows back means no profile row to update — an account with
    // no profile, which the signup trigger should make impossible.
    if (!rows?.length) return { ok: false, tier, detail: "no profile row" };
    return { ok: true, tier, detail: null };
  } catch {
    return { ok: false, tier, detail: "unreachable or timed out" };
  }
}
