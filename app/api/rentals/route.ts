/**
 * Live rentals for one market or ZIP:
 *   /api/rentals?market=jacksonville
 *   /api/rentals?zip=32224
 *
 * A daily cap on DISTINCT areas (lib/live/quota) guards the bill: the
 * first search of a market or ZIP each day spends a slot, repeats ride
 * the 24-hour cache for free, and failures spend nothing.
 *
 * Photos are NOT fetched here — they come from a second vendor and
 * would double the wait for rows that display fine without them. See
 * /api/rentals/photos, which the client calls once the rows are up.
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
  fetchRawRentals,
  mapRentCastListing,
  RentCastError,
} from "@/lib/live/rentcast";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import {
  isFresh,
  readMarketStore,
  writeMarketListings,
} from "@/lib/db/market-store";
import {
  amenityFields,
  describeFields,
  describeShape,
  proseFields,
} from "@/lib/live/shape";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** One vendor call. Stated so a slow feed fails as a timeout we can
 *  report, not a platform default that varies by plan. */
export const maxDuration = 60;

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
  const shape = searchParams.get("shape");

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

  // Setup diagnostic: the VENDOR's own field names and value types —
  // never their values. This is the definitive answer to "does this
  // payload carry descriptions or amenities?", and it has to read the
  // RAW rows: describing our mapped row would only ever echo back our
  // own field names, which cannot reveal a field the mapper ignores.
  // Costs no vendor request when this market was already searched today
  // — the probe shares the feed's Data-Cache entry.
  if (shape) {
    try {
      const raw = await fetchRawRentals(market);
      const fields = describeFields(raw);
      const prose = proseFields(fields);
      const amenity = amenityFields(fields);
      const mapped = raw
        .map((r) => mapRentCastListing(r, market))
        .find((l) => l !== null);
      return NextResponse.json({
        rows: raw.length,
        /** Every field RentCast ships, unioned across all rows. */
        vendorFields: fields,
        /** Free-text fields long enough to mine ("furnished", …). */
        proseFields: prose,
        /** Fields whose name suggests amenity or description content. */
        amenityFields: amenity,
        verdict:
          prose.length > 0 || amenity.length > 0
            ? "This feed carries descriptive text — the Furnished filter " +
              "can work on live rows. Pin the mapper to the fields listed."
            : "No description or amenity field in any row. Furnished " +
              "cannot be answered from this feed; the filter stays " +
              "disabled on live results until a description source is added.",
        mappedShape: describeShape(mapped ?? null),
      });
    } catch (error) {
      return failure(error);
    }
  }

  // The durable store first: a fresh row is the same inventory this
  // route would fetch, already fetched — by another instance, an
  // earlier deploy, or simply whoever searched this market before —
  // and serving it spends neither a vendor request nor a quota slot.
  // asOf is the row's real fetch time, never dressed up as now.
  const stored = await readMarketStore(market.slug);
  const gate = checkLiveSearch(`market:${market.slug}`);
  if (stored?.listings?.length && isFresh(stored.listingsAt)) {
    return NextResponse.json({
      live: true,
      asOf: stored.listingsAt,
      market: market.slug,
      center: { lat: market.lat, lon: market.lon },
      listings: stored.listings,
      remaining: gate.remaining,
      cap: gate.cap,
    });
  }

  if (!gate.allowed) {
    return NextResponse.json(
      { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const listings = await fetchLiveRentals(market);
    const spent = commitLiveSearch(`market:${market.slug}`);
    // Stored for the next instance, deploy, and student. Awaited so a
    // serverless runtime can't freeze the write mid-flight; it still
    // never throws.
    await writeMarketListings(market.slug, listings);
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
    // A stale row beats an apology: it is the same feed, honestly
    // timestamped, from a day the vendor was answering.
    if (stored?.listings?.length) {
      return NextResponse.json({
        live: true,
        asOf: stored.listingsAt,
        market: market.slug,
        center: { lat: market.lat, lon: market.lon },
        listings: stored.listings,
        remaining: gate.remaining,
        cap: gate.cap,
      });
    }
    return failure(error);
  }
}
