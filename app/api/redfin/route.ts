/**
 * Redfin rentals for one market:
 *   /api/redfin?market=jacksonville&furnished=1
 *   /api/redfin?market=jacksonville&furnished=1&shape=1
 *
 * The furnished flag is passed through to Redfin's OWN search filter, so
 * what comes back is furnished because Redfin says so — the one amenity
 * claim in this codebase that isn't mined out of prose.
 *
 * One request per market per day, cached and shared. `shape=1` reports
 * the vendor's field names and value types (never values) so the mapper
 * can be pinned to the real schema in a single request.
 */

import { NextResponse } from "next/server";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import { fetchRedfinRentals, RedfinError } from "@/lib/live/redfin";
import {
  amenityFields,
  arrayPaths,
  describeFields,
  proseFields,
  statusStrings,
} from "@/lib/live/shape";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** A parsed search of a whole market is slower than a plain fetch. */
export const maxDuration = 60;

function failure(error: unknown) {
  if (error instanceof RedfinError) {
    return NextResponse.json(
      {
        live: false,
        reason: error.reason,
        status: error.status ?? null,
        detail: error.detail ?? null,
      },
      { status: error.reason === "no-key" || error.reason === "no-city" ? 503 : 502 }
    );
  }
  return NextResponse.json(
    { live: false, reason: "network", status: null },
    { status: 502 }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json(
      { live: false, reason: "unknown-market" },
      { status: 404 }
    );
  }
  const furnished = searchParams.get("furnished") === "1";
  const shape = searchParams.get("shape");

  // Setup diagnostic: the vendor's own field names, so the provisional
  // aliases in lib/live/redfin can be pinned and the rest deleted.
  if (shape) {
    try {
      const { raw, listings, body, parsed, bytes, credits, searchUrl } =
        await fetchRedfinRentals(market, { furnished });
      const fields = describeFields(raw);
      // Describe the WHOLE response, not just the rows we managed to
      // extract: when extraction finds nothing, the rows are empty and
      // describing them explains nothing at all.
      const found = arrayPaths(body);
      const shapeOfBody = describeFields([body], 4);
      return NextResponse.json({
        searchUrl,
        parsed,
        bytes,
        credits,
        rowsReturned: raw.length,
        rowsMapped: listings.length,
        /** Every array in the payload, by path and length — the answer
         *  to "where are the listings?" without knowing the schema. */
        arrays: found,
        /** The vendor explaining itself, when it carries no records. */
        status: statusStrings(body),
        /** Top-level shape of the response. */
        responseShape: shapeOfBody,
        /** Fields of the rows our extractor did find, if any. */
        vendorFields: fields,
        proseFields: proseFields(fields),
        amenityFields: amenityFields(fields),
        sample: listings.slice(0, 3),
        verdict: !parsed
          ? "Response wasn't JSON. Read `status` and `bytes` — this is usually an error page, not a payload."
          : listings.length === 0 && raw.length > 0
            ? "Rows came back but none mapped — pin the aliases in lib/live/redfin to vendorFields."
            : raw.length === 0 && found.some((a) => a.length > 0)
              ? `The payload DOES carry records, at: ${found
                  .filter((a) => a.length > 0)
                  .map((a) => `${a.path} (${a.length})`)
                  .join(", ")}. Point extractListings at that path.`
              : raw.length === 0
                ? "The payload genuinely carries no records. Either this search has no results, or the URL is wrong — open searchUrl in a browser to tell which."
                : `Mapped ${listings.length} of ${raw.length}.`,
      });
    } catch (error) {
      return failure(error);
    }
  }

  const cacheKey = `redfin:${market.slug}:${furnished ? "furnished" : "all"}`;
  const gate = checkLiveSearch(cacheKey);
  if (!gate.allowed) {
    return NextResponse.json(
      { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const { listings, credits, searchUrl } = await fetchRedfinRentals(market, {
      furnished,
    });
    const spent = commitLiveSearch(cacheKey);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      source: "redfin",
      market: market.slug,
      furnished,
      center: { lat: market.lat, lon: market.lon },
      listings,
      credits,
      searchUrl,
      remaining: spent.remaining,
      cap: spent.cap,
    });
  } catch (error) {
    return failure(error);
  }
}
