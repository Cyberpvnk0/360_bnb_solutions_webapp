/**
 * The daily alert run.
 *
 *   GET /api/alerts/run            Authorization: Bearer <CRON_SECRET>
 *   GET /api/alerts/run?secret=…   or a named admin, signed in
 *
 * Reads every alert with the service key, reads each watched area's
 * rentals once, and sends what lib/alerts/run decides. Scheduled by
 * the platform (vercel.json) once a morning; runnable by hand with the
 * secret. Answers with the run's report.
 */

import { NextResponse } from "next/server";
import { readCriteria } from "@/lib/alerts/criteria";
import { emailConfigured, sendEmail } from "@/lib/alerts/email";
import { pushConfigured, sendPush, type PushSubscriptionRow } from "@/lib/alerts/push";
import { runAlerts, type AlertRow } from "@/lib/alerts/run";
import { requireOperator } from "@/lib/auth/gate";
import { serviceConfig, serviceRest } from "@/lib/db/service";
import { fetchLiveRentals, fetchLiveRentalsByZip } from "@/lib/live/rentcast";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** Every watched area is a feed read; a few dozen fit well inside. */
export const maxDuration = 300;

interface AlertRecord {
  id: string;
  user_id: string;
  email: string | null;
  market_slug: string | null;
  zip: string | null;
  label: string;
  criteria: unknown;
  wants_email: boolean;
  wants_push: boolean;
  seen_ids: string[] | null;
  last_run_at: string | null;
}

interface SubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  keys: unknown;
}

function subscriptionOf(r: SubscriptionRecord): (PushSubscriptionRow & { id: string }) | null {
  const k = r.keys && typeof r.keys === "object" ? (r.keys as Record<string, unknown>) : null;
  if (!k || typeof k.p256dh !== "string" || typeof k.auth !== "string") return null;
  return { id: r.id, endpoint: r.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export async function GET(request: Request) {
  const op = await requireOperator(request);
  if (!op.ok) return op.response;
  if (!serviceConfig()) {
    return NextResponse.json({ ok: false, reason: "no-store", hint: "set SUPABASE_URL and the secret key" }, { status: 503 });
  }

  const rows = await serviceRest<AlertRecord[]>(
    "listing_alerts?select=id,user_id,email,market_slug,zip,label,criteria,wants_email,wants_push,seen_ids,last_run_at&order=created_at.asc"
  );
  if (!rows.ok) return NextResponse.json({ ok: false, reason: "store", detail: rows.detail }, { status: 502 });

  const alerts: AlertRow[] = (rows.data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    marketSlug: r.market_slug,
    zip: r.zip,
    label: r.label,
    criteria: readCriteria(r.criteria),
    wantsEmail: Boolean(r.wants_email),
    wantsPush: Boolean(r.wants_push),
    seenIds: Array.isArray(r.seen_ids) ? r.seen_ids.filter((s): s is string => typeof s === "string") : [],
    lastRunAt: r.last_run_at,
  }));

  // The browsers to push to, for the accounts that asked for push.
  const pushUsers = Array.from(new Set(alerts.filter((a) => a.wantsPush).map((a) => a.userId)));
  const subsByUser = new Map<string, (PushSubscriptionRow & { id: string })[]>();
  if (pushUsers.length > 0 && pushConfigured()) {
    const subs = await serviceRest<SubscriptionRecord[]>(
      `push_subscriptions?select=id,user_id,endpoint,keys&user_id=in.(${pushUsers.map((u) => `"${u}"`).join(",")})`
    );
    if (subs.ok) {
      for (const r of subs.data ?? []) {
        const s = subscriptionOf(r);
        if (s) subsByUser.set(r.user_id, [...(subsByUser.get(r.user_id) ?? []), s]);
      }
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  const report = await runAlerts(alerts, {
    listingsFor: async ({ marketSlug, zip }) => {
      if (zip) return (await fetchLiveRentalsByZip(zip)).listings;
      const market = marketSlug ? MARKET_BY_SLUG.get(marketSlug) : undefined;
      return market ? fetchLiveRentals(market) : [];
    },
    sendEmail: emailConfigured() ? sendEmail : async () => ({ ok: false, detail: "mail is not configured" }),
    pushTo: async (userId, payload) => {
      let delivered = 0;
      for (const sub of subsByUser.get(userId) ?? []) {
        const outcome = await sendPush(sub, payload);
        if (outcome === "sent") delivered += 1;
        else if (outcome === "gone") await serviceRest(`push_subscriptions?id=eq.${sub.id}`, { method: "DELETE", prefer: "return=minimal" });
      }
      return delivered;
    },
    save: async (id, patch) => {
      await serviceRest(`listing_alerts?id=eq.${id}`, {
        method: "PATCH",
        body: { seen_ids: patch.seenIds, last_run_at: patch.lastRunAt },
        prefer: "return=minimal",
      });
    },
    appUrl,
    now: new Date(),
  });

  return NextResponse.json({ ok: true, mail: emailConfigured(), push: pushConfigured(), ...report });
}
