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
import { fetchRedfinRentals, redfinRentalsUrlFor, RedfinError } from "@/lib/live/redfin";
import { probeCityId } from "@/lib/live/redfin-city";
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

  // Resolver check: which city id this market lands on, and the URL it
  // produces — cheap, and the answer worth pasting into the seeded map
  // so the lookup never has to run again.
  if (searchParams.get("resolve")) {
    const probe = await probeCityId(market);
    const { cityId } = probe;
    return NextResponse.json({
      market: market.slug,
      name: `${market.name}, ${market.stateCode}`,
      cityId,
      searchUrl:
        cityId === null
          ? null
          : redfinRentalsUrlFor(market, cityId, { furnished: true }),
      /** Every step, so a null answer says WHICH thing went wrong:
       *  blocked, unparseable, or matched nothing. */
      diagnostics: {
        autocompleteUrl: probe.autocompleteUrl,
        status: probe.status,
        parsed: probe.parsed,
        bytes: probe.bytes,
        head: probe.head,
        candidatesFound: probe.candidates.length,
        candidates: probe.candidates,
      },
      verdict:
        cityId !== null
          ? `Open searchUrl in a browser: it must be ${market.name}, ${market.stateCode}. If it is, add "${market.slug}: ${cityId}" to REDFIN_CITY_ID.`
          : probe.status === null
            ? "The resolver never got a response — check SCRAPERAPI_KEY."
            : !probe.parsed
              ? "Response wasn't JSON. Read `head`: an unrecognised guard prefix, or a block page rather than a payload."
              : probe.candidates.length === 0
                ? "Parsed, but no rows looked like cities. The payload shape differs from what extractCandidates expects."
                : "Rows came back but none matched this city AND state — see `candidates`.",
    });
  }

  // Setup diagnostic: the vendor's own field names, so the provisional
  // aliases in lib/live/redfin can be pinned and the rest deleted.
  if (shape) {
    try {
      const {
        raw,
        listings,
        skipped,
        geocodedBy,
        pages,
        morePages,
        body,
        parsed,
        bytes,
        credits,
        searchUrl,
      } = await fetchRedfinRentals(market, { furnished });
      const fields = describeFields(raw);
      // Describe the WHOLE response, not just the rows we managed to
      // extract: when extraction finds nothing, the rows are empty and
      // describing them explains nothing at all.
      const found = arrayPaths(body);
      // Deep enough to see inside the objects Redfin wraps its price in.
      const shapeOfBody = describeFields([body], 7);
      return NextResponse.json({
        searchUrl,
        parsed,
        bytes,
        credits,
        rowsReturned: raw.length,
        rowsMapped: listings.length,
        /** Why unusable rows were dropped — a zero result that explains
         *  itself instead of looking like an empty market. */
        skipped,
        /** Pages followed, and whether the cap cut the market short. */
        pages,
        morePages,
        /** Which geocoder placed the rows we kept. Redfin ships no
         *  coordinates, so this is the real gate on how many show. */
        geocodedBy,
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
