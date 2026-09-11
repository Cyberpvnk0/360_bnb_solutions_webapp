/**
 * One ZIP's real short-let figures:  POST /api/markets/area
 *
 *   { market: "<slug>", zip: "32207", lat, lon }
 *
 * The market page ranks its ZIPs off listings the product has already
 * seen, which is free and is a sample. This is the other thing: the
 * feed's own figures for the whole ZIP, including the active-listing
 * count a sample can never give. Stored under the ZIP and shared with
 * every account after, so the same neighbourhood is bought once.
 *
 * Only accounts on a plan. Two billed calls the first time a ZIP is
 * asked about, none after that while the row stays fresh.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { areaStats } from "@/lib/live/area-stats";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const FAILED: Record<string, { status: number; message: string }> = {
  "no-key": { status: 503, message: "Live figures are not configured." },
  quota: { status: 429, message: "The day's area searches are used up." },
  "not-found": { status: 404, message: "No figures for that area yet." },
  failed: { status: 502, message: "The figures could not be fetched." },
};

export async function POST(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const market = MARKET_BY_SLUG.get(
    typeof body?.market === "string" ? body.market : ""
  );
  if (!market) {
    return NextResponse.json({ ok: false, reason: "unknown-market" }, { status: 404 });
  }
  const zip = typeof body?.zip === "string" ? body.zip : "";
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  if (
    !/^\d{5}$/.test(zip) ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180
  ) {
    return NextResponse.json({ ok: false, reason: "bad-area" }, { status: 400 });
  }

  const result = await areaStats(market.slug, zip, { lat, lon });
  if (!result.ok) {
    const how = FAILED[result.reason] ?? FAILED.failed;
    return NextResponse.json(
      { ok: false, reason: result.reason, message: how.message },
      { status: how.status }
    );
  }
  return NextResponse.json(
    { ok: true, zip: result.zip, stats: result.stats, bought: result.bought },
    { headers: { "Cache-Control": "no-store" } }
  );
}
