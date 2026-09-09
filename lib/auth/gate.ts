/**
 * Who may call what — decided on the server, per request.
 *
 * Every route here is reachable by anyone with a session, because the
 * proxy only asks "signed in?" and an API route has no other door. That
 * left eleven of fourteen routes open to any free account: the
 * diagnostics that spend vendor credits on demand, the imagery route
 * that bills Google per call, the contact scrape, the geocoder. A free
 * account with curl could drain every daily budget every day, and the
 * plan meters would never see it because the plan meters live in two
 * routes. These gates put the plan in front of every spend.
 *
 * FOUR LEVELS. Signed in: the map style, store-only reads. Paid: the
 * routes that spend money for one user — a Street View image, a contact
 * page. Staff: the operator page and its figures (reads). Operator: the
 * diagnostics that spend vendor money on purpose with no meter in front.
 *
 * STAFF IS OPTIONAL; OPERATOR IS NOT. ADMIN_EMAILS, when set, is the
 * allowlist for both, checked against the session's email. When it is
 * not set — the beta, where every account belongs to someone who is
 * meant to see everything — every signed-in account is staff, and
 * nobody is an operator until the list or CRON_SECRET is set. Signed
 * out is never either: the proxy sends visitors to sign in before any
 * of this runs, and an API call with no session gets a 401 here.
 *
 * Each gate returns either the caller or the response to send instead,
 * so a route's first line is `const g = await requirePaid(); if (!g.ok)
 * return g.response;` and nothing below it runs for the wrong caller.
 */

import { NextResponse } from "next/server";
import { TIERS, type TierId } from "@/config/app";
import { currentUser } from "@/lib/supabase/server";
import { consumeUsage, resolveTier } from "@/lib/db/usage";

type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export type Gate<T> = { ok: true } & T | { ok: false; response: NextResponse };

/** The staff list. Comma-separated, case-insensitive, whitespace-tolerant. */
export function adminEmails(env = process.env.ADMIN_EMAILS): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * May this signed-in email see staff surfaces?
 *
 * No email — nobody signed in — is never staff. An EMPTY list means the
 * deployment has not drawn the line, and everyone signed in is on the
 * inside of it. A non-empty list means exactly its members.
 */
export function isStaff(email: string | null | undefined, env?: string): boolean {
  if (!email) return false;
  const list = adminEmails(env);
  if (list.size === 0) return true;
  return list.has(email.trim().toLowerCase());
}

function refuse(status: number, reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, live: false, reason, ...extra }, { status });
}

/** Any signed-in account. */
export async function requireSignedIn(): Promise<Gate<{ user: SessionUser }>> {
  const user = await currentUser();
  if (!user) return { ok: false, response: refuse(401, "signed-out") };
  return { ok: true, user };
}

/**
 * A signed-in account on a plan that includes analyses — the routes
 * behind this spend money for one person, and Free spends nothing.
 */
export async function requirePaid(): Promise<Gate<{ user: SessionUser; tier: TierId }>> {
  const user = await currentUser();
  if (!user) return { ok: false, response: refuse(401, "signed-out") };
  const tier = await resolveTier(user.id);
  if (TIERS[tier].creditLimit <= 0) {
    return { ok: false, response: refuse(403, "plan-required", { tier }) };
  }
  return { ok: true, user, tier };
}

/** A signed-in account that counts as staff — see isStaff. Guards the
 *  operator page and its metrics: reads, never spend. */
export async function requireStaff(): Promise<Gate<{ user: SessionUser }>> {
  const user = await currentUser();
  if (!user) return { ok: false, response: refuse(401, "signed-out") };
  // A named list is only as good as the email being theirs: a project
  // with confirmations off hands out sessions for any address typed.
  if (adminEmails().size > 0 && !user.email_confirmed_at) {
    return { ok: false, response: refuse(403, "admin-only") };
  }
  if (!isStaff(user.email)) return { ok: false, response: refuse(403, "admin-only") };
  return { ok: true, user };
}

/**
 * The diagnostics that spend vendor money on purpose and skip the plan
 * meter and the daily ledgers — the vendor shape probes, the comps
 * bench, the description miner, the city-id tooling.
 *
 * THESE NEVER OPEN BY DEFAULT. "Everyone is staff when no list is set"
 * is right for a page of figures; it is wrong for a URL that buys a
 * dozen scrapes per call with no cap behind it, because the beta lets
 * anyone with an email address register. So an operator is either an
 * email NAMED in ADMIN_EMAILS with a confirmed address, or a caller
 * presenting CRON_SECRET (query `secret=` or a Bearer token) — the same
 * secret the backfill already requires. With neither configured the
 * routes answer 503 and say what to set.
 */
export async function requireOperator(
  request?: Request
): Promise<Gate<{ user: SessionUser | null }>> {
  const secret = process.env.CRON_SECRET;
  if (secret && request) {
    const offered =
      new URL(request.url).searchParams.get("secret") ??
      request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (offered === secret) return { ok: true, user: null };
  }
  const list = adminEmails();
  if (list.size === 0 && !secret) {
    return {
      ok: false,
      response: refuse(503, "operator-not-configured", {
        hint: "set ADMIN_EMAILS (named staff) or CRON_SECRET before this diagnostic will spend anything",
      }),
    };
  }
  const user = await currentUser();
  if (!user) return { ok: false, response: refuse(401, "signed-out") };
  // The list is only as good as the email being theirs. A project with
  // confirmations off hands out sessions for any address typed at it.
  if (!user.email_confirmed_at || !list.has((user.email ?? "").trim().toLowerCase())) {
    return { ok: false, response: refuse(403, "operator-only") };
  }
  return { ok: true, user };
}

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

/**
 * The account's plan, asked before any market is served.
 *
 * Distinct markets per month is the one browsing limit a plan carries.
 * It is not a cost meter — a market is shared and cached, so the
 * hundredth student to open Jacksonville costs nothing — it is what
 * keeps a lone account in a market nobody else looks at from re-buying
 * that market's feed every day on a seventeen-dollar plan. Counted by
 * slug, so opening the same market twice is one against the plan, and
 * so the furnished search of a market already opened is free: same
 * key, same month, no second charge.
 *
 * SIGNED OUT IS REFUSED, not waved through. An earlier version let a
 * request with no user straight through to the feed — live inventory
 * for anyone with curl and no account at all. No user, no market; the
 * preview rows the client falls back to are seeded and cost nothing.
 *
 * Fails open only when the meter itself is unreachable for a SIGNED-IN
 * account, with the reason recorded; the platform's own daily ledgers
 * still bound the day.
 */
export async function claimMarket(key: string): Promise<
  | { allowed: true }
  | { allowed: false; used: number; cap: number }
> {
  const user = await currentUser();
  if (!user) return { allowed: false, used: 0, cap: 0 };
  const tier = await resolveTier(user.id);
  const check = await consumeUsage(user.id, tier, "market", key);
  return check.allowed
    ? { allowed: true }
    : { allowed: false, used: check.used, cap: check.cap };
}

/** The refusal, in the shape every live failure uses, plus the two
 *  figures the upgrade prompt needs to be specific. A cap of zero is
 *  how the client tells "out of markets" from "not on a plan". */
export function monthlyCap(used: number, cap: number) {
  return NextResponse.json(
    { live: false, reason: "monthly-cap", used, cap, status: null },
    { status: 429 }
  );
}
