/**
 * Live rentals for one market or ZIP:
 *   /api/rentals?market=jacksonville
 *   /api/rentals?zip=32224
 *
 * A daily cap on DISTINCT areas (lib/live/quota) guards the bill: the
 * first search of a market or ZIP each day spends a slot, repeats ride
 * the 24-hour cache for free, and failures spend nothing.
 *
 * The RentCast key never leaves the server; the browser only ever sees
 * mapped listings. Every response is honest about its provenance:
 * `live: true` with a timestamp and the area's center (the map's camera
 * target), or `live: false` with a specific reason — "auth" means the
 * key is wrong, "quota" means the plan is spent, "network" means the
 * feed is unreachable — so the UI can say which, not just "no data".
 */

import { NextResponse } from "next/server";
import {
  fetchLiveRentals,
  fetchLiveRentalsByZip,
  RentCastError,
} from "@/lib/live/rentcast";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** Same shape for every failure, so the client can explain itself. */
function failure(error: unknown) {
  if (error instanceof RentCastError) {
    return NextResponse.json(
      { live: false, reason: error.reason, status: error.status ?? null },
      { status: error.reason === "no-key" ? 503 : 502 }
    );
  }
  return NextResponse.json(
    { live: false, reason: "network", status: null },
    { status: 502 }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("market");
  const zip = searchParams.get("zip");

  if (zip !== null) {
    if (!/^\d{5}$/.test(zip)) {
      return NextResponse.json(
        { live: false, reason: "bad-zip", status: null },
        { status: 400 }
      );
    }
    const gate = checkLiveSearch(`zip:${zip}`);
    if (!gate.allowed) {
      return NextResponse.json(
        { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
        { status: 429 }
      );
    }
    try {
      const { market, center, listings } = await fetchLiveRentalsByZip(zip);
      const spent = commitLiveSearch(`zip:${zip}`);
      return NextResponse.json({
        live: true,
        asOf: new Date().toISOString(),
        zip,
        market: market?.slug ?? null,
        center,
        listings,
        remaining: spent.remaining,
        cap: spent.cap,
      });
    } catch (error) {
      return failure(error);
    }
  }

  const market = MARKET_BY_SLUG.get(slug ?? "");
  if (!market) {
    return NextResponse.json(
      { live: false, reason: "unknown-market", status: null },
      { status: 404 }
    );
  }

  const gate = checkLiveSearch(`market:${market.slug}`);
  if (!gate.allowed) {
    return NextResponse.json(
      { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const listings = await fetchLiveRentals(market);
    const spent = commitLiveSearch(`market:${market.slug}`);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      market: market.slug,
      center: { lat: market.lat, lon: market.lon },
      listings,
      remaining: spent.remaining,
      cap: spent.cap,
    });
  } catch (error) {
    return failure(error);
  }
}
