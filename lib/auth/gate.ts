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
 * THREE LEVELS. Signed in: the map style, store-only reads. Paid: the
 * routes that spend money for one user — a Street View image, a contact
 * page, a Google geocode. Admin: the diagnostics and the backfill,
 * which spend money on purpose and print figures nobody else should
 * read. Admin is an allowlist of emails in ADMIN_EMAILS, checked
 * against the session's verified email, because a role column would be
 * one more thing to migrate and this is a beta with a staff list.
 *
 * Each gate returns either the caller or the response to send instead,
 * so a route's first line is `const g = await requirePaid(); if (!g.ok)
 * return g.response;` and nothing below it runs for the wrong caller.
 */

import { NextResponse } from "next/server";
import { TIERS, type TierId } from "@/config/app";
import { currentUser } from "@/lib/supabase/server";
import { consumeUsage, tierOf } from "@/lib/db/usage";

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

export function isAdminEmail(email: string | null | undefined, env?: string): boolean {
  if (!email) return false;
  return adminEmails(env).has(email.trim().toLowerCase());
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
  const tier = (await tierOf(user.id)) ?? "free";
  if (TIERS[tier].pullLimit <= 0) {
    return { ok: false, response: refuse(403, "plan-required", { tier }) };
  }
  return { ok: true, user, tier };
}

/** A signed-in account on the staff list. 404 rather than 403 for the
 *  page-shaped callers: an admin surface should not announce itself. */
export async function requireAdmin(): Promise<Gate<{ user: SessionUser }>> {
  const user = await currentUser();
  if (!user) return { ok: false, response: refuse(401, "signed-out") };
  if (!isAdminEmail(user.email)) return { ok: false, response: refuse(403, "admin-only") };
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
  const tier = (await tierOf(user.id)) ?? "free";
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
