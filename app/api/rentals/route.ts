/**
 * Live rentals for one market, keyed by slug: /api/rentals?market=jacksonville
 *
 * The RentCast key never leaves the server; the browser only ever sees
 * mapped listings. Every response is honest about its provenance:
 * `live: true` with a timestamp, or `live: false` with a reason the
 * client uses to fall back to the seeded preview inventory.
 */

import { NextResponse } from "next/server";
import { fetchLiveRentals } from "@/lib/live/rentcast";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("market") ?? "";
  const market = MARKET_BY_SLUG.get(slug);
  if (!market) {
    return NextResponse.json(
      { live: false, reason: "unknown-market" },
      { status: 404 }
    );
  }
  if (!process.env.RENTCAST_API_KEY) {
    return NextResponse.json(
      { live: false, reason: "no-key" },
      { status: 503 }
    );
  }

  try {
    const listings = await fetchLiveRentals(market);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      market: market.slug,
      listings,
    });
  } catch {
    return NextResponse.json(
      { live: false, reason: "unreachable" },
      { status: 502 }
    );
  }
}
