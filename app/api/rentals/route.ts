/**
 * Live rentals for one market or ZIP:
 *   /api/rentals?market=jacksonville
 *   /api/rentals?zip=32224
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
    try {
      const { market, center, listings } = await fetchLiveRentalsByZip(zip);
      return NextResponse.json({
        live: true,
        asOf: new Date().toISOString(),
        zip,
        market: market?.slug ?? null,
        center,
        listings,
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

  try {
    const listings = await fetchLiveRentals(market);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      market: market.slug,
      center: { lat: market.lat, lon: market.lon },
      listings,
    });
  } catch (error) {
    return failure(error);
  }
}
