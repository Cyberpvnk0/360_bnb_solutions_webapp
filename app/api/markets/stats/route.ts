/**
 * Measured KPIs for the markets one operator actually cares about:
 *   /api/markets/stats?slugs=jacksonville-fl,augusta-ga
 *
 * Store only. No vendor call, no billing, no quota slot — this reads
 * rows that have already been paid for. A market nobody has paid for
 * simply isn't in the answer, and the caller keeps showing its
 * modelled figures and says so.
 *
 * Scoped by slug rather than returning the whole store, because the
 * store grows with the catalogue and this response should grow with
 * the person asking: three watched markets is three rows.
 *
 * Twelve months of history is stripped on the way out. The desk shows
 * one line per market; the monthly series belongs to the analyzer,
 * which asks for it by market.
 */

import { NextResponse } from "next/server";
import {
  readMarketStatsFor,
  storeConfigured,
  type StoredMarketStats,
} from "@/lib/db/market-store";

/** How many markets one desk may ask about at once. Generous against
 *  any real watchlist, and a ceiling on a hand-built query string. */
const MAX_SLUGS = 60;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("slugs") ?? "";
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SLUGS);

  if (slugs.length === 0) {
    return NextResponse.json({ stored: storeConfigured(), stats: {} });
  }

  const rows = await readMarketStatsFor(slugs);
  const stats: Record<
    string,
    Omit<StoredMarketStats, "monthly"> & { asOf: string | null }
  > = {};
  // Listed field by field rather than spread-minus-monthly, so the
  // shape of what leaves this route is written down: a new column on
  // the stored summary shows up here as a compile error, not as an
  // extra 12-object array quietly riding along in every response.
  for (const [slug, row] of rows) {
    const s = row.stats;
    stats[slug] = {
      adr: s.adr,
      occupancy: s.occupancy,
      revpar: s.revpar,
      revenue: s.revenue,
      activeListings: s.activeListings,
      bookingLeadTime: s.bookingLeadTime,
      lengthOfStay: s.lengthOfStay,
      fullName: s.fullName,
      asOf: row.at,
    };
  }

  return NextResponse.json({
    // False means the store isn't wired up at all, which is a different
    // answer from "wired up and holding nothing for these markets" —
    // and the second one is the normal case worth staying quiet about.
    stored: storeConfigured(),
    stats,
  });
}
