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
  fetchRawRentals,
  mapRentCastListing,
  RentCastError,
} from "@/lib/live/rentcast";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import {
  amenityFields,
  describeFields,
  describeShape,
  proseFields,
} from "@/lib/live/shape";
import { addressKey, fetchRedfinPhotoIndex } from "@/lib/live/redfin";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { Market, RentalListing } from "@/lib/mock/types";

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

/**
 * Borrow Redfin's photos for rows that have none.
 *
 * RentCast ships no imagery in any of its 500 fields, so its rows fall
 * back to a sketch. Redfin photographs the same city and one cached
 * market search carries a thumbnail for most of its rows, so where both
 * list the same building the row can show a real picture.
 *
 * Best effort by design: a market Redfin doesn't cover, or a listing it
 * doesn't carry, simply keeps its sketch. Never fails the search.
 */
async function withBorrowedPhotos(
  listings: RentalListing[],
  market: Market
): Promise<{ listings: RentalListing[]; matched: number }> {
  let index: Map<string, string>;
  try {
    index = await fetchRedfinPhotoIndex(market);
  } catch {
    return { listings, matched: 0 };
  }
  if (index.size === 0) return { listings, matched: 0 };

  let matched = 0;
  const out = listings.map((listing) => {
    if (listing.photoUrl) return listing;
    const key = addressKey(listing.address);
    const photo = key ? index.get(key) : undefined;
    if (!photo) return listing;
    matched += 1;
    return { ...listing, photoUrl: photo };
  });
  return { listings: out, matched };
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

  const gate = checkLiveSearch(`market:${market.slug}`);
  if (!gate.allowed) {
    return NextResponse.json(
      { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const raw = await fetchLiveRentals(market);
    const { listings, matched } = await withBorrowedPhotos(raw, market);
    const spent = commitLiveSearch(`market:${market.slug}`);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      market: market.slug,
      center: { lat: market.lat, lon: market.lon },
      listings,
      /** How many rows borrowed a Redfin photo — coverage, not a claim
       *  that every listing has one. */
      photosMatched: matched,
      remaining: spent.remaining,
      cap: spent.cap,
    });
  } catch (error) {
    return failure(error);
  }
}
