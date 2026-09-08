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
 * FAILS OPEN. If the store is unreachable the account is allowed
 * through and the reason is reported, because a student being refused
 * an analysis they paid for is a worse outcome than a vendor call the
 * platform's own daily breaker will still bound. Never silently.
 */

import { TIERS, type TierId } from "@/config/app";
import { currentPeriod } from "./usage-period";

type Kind = "analysis" | "market";

export interface UsageCheck {
  allowed: boolean;
  used: number;
  cap: number;
  /** Which meter answered. */
  kind: Kind;
  /** Set when the store could not be reached and the call was let
   *  through on trust. */
  unmetered?: string;
}

export { currentPeriod } from "./usage-period";

/** The plan's cap for one meter. */
export function capFor(tier: TierId, kind: Kind): number {
  const t = TIERS[tier] ?? TIERS.free;
  return kind === "analysis" ? t.pullLimit : t.marketLimit;
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
  const cap = capFor(tier, kind);
  if (cap <= 0) return { allowed: false, used: 0, cap, kind };

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
    const rows = (await res.json()) as { allowed: boolean; used: number; cap: number }[];
    const row = rows?.[0];
    if (!row) return { allowed: true, used: 0, cap, kind, unmetered: "empty reply" };
    return { allowed: Boolean(row.allowed), used: Number(row.used), cap, kind };
  } catch {
    return { allowed: true, used: 0, cap, kind, unmetered: "unreachable or timed out" };
  }
}

/**
 * The account's tier, read with the secret key so a caller cannot
 * present a tier it does not hold. Null when there is no profile.
 */
export async function tierOf(userId: string): Promise<TierId | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=tier`,
      {
        headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { tier?: string }[];
    const tier = rows?.[0]?.tier;
    return tier && tier in TIERS ? (tier as TierId) : null;
  } catch {
    return null;
  }
}
