/**
 * Live rentals for one market or ZIP:
 *   /api/rentals?market=jacksonville
 *   /api/rentals?zip=32224
 *
 * A daily cap on DISTINCT areas (lib/live/quota) guards the bill: the
 * first search of a market or ZIP each day spends a slot, repeats ride
 * the 24-hour cache for free, and failures spend nothing.
 *
 * No photos are fetched here, or anywhere. A listing photo is
 * copyrighted separately from the facts around it and this product
 * displays none: the card draws Street View or an aerial of the kerb
 * and links to the listing's own page for the rest.
 *
 * The RentCast key never leaves the server; the browser only ever sees
 * mapped listings. Every response is honest about its provenance:
 * `live: true` with a timestamp and the area's center (the map's camera
 * target), or `live: false` with a specific reason — "auth" means the
 * key is wrong, "quota" means the plan is spent, "network" means the
 * feed is unreachable — so the UI can say which, not just "no data".
 */

import { after, NextResponse } from "next/server";
import {
  fetchLiveRentals,
  fetchLiveRentalsByZip,
  fetchRawRentals,
  mapRentCastListing,
  RentCastError,
} from "@/lib/live/rentcast";
import {
  checkLiveSearch,
  commitLiveSearch,
  reserveJoin,
} from "@/lib/live/quota";
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
import { fetchRedfinRentals, siteRowsFrom } from "@/lib/live/redfin";
import {
  indexBySite,
  joinListingFacts,
  needsListingPages,
} from "@/lib/live/listing-join";
import type { Market, RentalListing } from "@/lib/mock/types";

/** One vendor call. Stated so a slow feed fails as a timeout we can
 *  report, not a platform default that varies by plan. */
export const maxDuration = 60;

/**
 * The rentals feed's rows, joined to the listing site's own search for
 * the same market, so each one carries its page URL and the contact the
 * listing publishes.
 *
 * ONE extra search per market per day, on the same cache the furnished
 * filter already rides. The feed knows about more inventory than the
 * portal does, so this never gates which rows are shown — it only adds
 * to the ones the portal also carries, and a market where the search
 * fails outright returns the rows exactly as they arrived.
 *
 * Failure is deliberately silent. A listing page is an enhancement; a
 * market's inventory is the product. An unreachable portal must not
 * take the rentals down with it.
 */
async function withListingPages(
  market: Market,
  rows: RentalListing[]
): Promise<RentalListing[]> {
  try {
    // `map: false` skips the geocoder and the mapper. The join reads an
    // address and a URL; running the full mapper to get them bought
    // coordinates nobody here uses, at a couple of dollars of geocoding
    // per market, and threw away every row the mapper could not place —
    // page URL and all. See siteRowsFrom.
    const { raw } = await fetchRedfinRentals(market, {
      pages: joinPages(),
      map: false,
    });
    return joinListingFacts(rows, indexBySite(siteRowsFrom(raw)));
  } catch {
    return rows;
  }
}

/**
 * How deep the join reads the portal's search.
 *
 * COVERAGE IS THE BINDING CONSTRAINT HERE, not latency. The rentals
 * feed returns up to five hundred rows for a market; the portal search
 * paginates at about forty, so four pages could only ever offer a
 * listing page to the first hundred and sixty addresses it happens to
 * carry. Every row past that fell back to a search link no matter how
 * well the matcher worked — which is what a student saw as "none of
 * these open the property".
 *
 * TWELVE IS A DELIBERATE PURCHASE, not a default that drifted. Each
 * page is its own billed scrape at about ten credits, so this triples
 * a market's join cost — from roughly forty credits to a hundred and
 * twenty — to reach about four hundred and ninety rows, which is the
 * whole of what the feed returns. It is bounded on both paths: the
 * live-search cap gates a fresh fetch, and the join cap gates a
 * backfill. REDFIN_JOIN_PAGES moves it either way without a deploy.
 *
 * Smaller markets cost less, not the same: a search that runs out of
 * pages stops, so twelve is a ceiling rather than a price.
 */
export const DEFAULT_JOIN_PAGES = 12;

function joinPages(): number {
  const raw = Number(process.env.REDFIN_JOIN_PAGES);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_JOIN_PAGES;
}

/**
 * Row sets we have already offered to the join in this process, keyed by
 * market and by the timestamp of the rows themselves.
 *
 * The backfill below is self-healing and therefore has to be
 * self-limiting: a market the portal genuinely cannot match would
 * otherwise re-run the whole geocode-and-map pass on every request for
 * as long as its stored rows stay fresh. Keyed by timestamp so the next
 * day's rows get their own attempt rather than inheriting this one's.
 */
const joinAttempted = new Set<string>();

/**
 * Run the join AFTER the response has gone out, and store what it
 * finds. Returns immediately; the caller does not wait.
 *
 * NOTHING ABOUT THIS BELONGS IN A REQUEST. Reading a dozen pages of the
 * portal's search is seconds of work, and it buys an ENHANCEMENT: a
 * card whose row has no listing page yet still shows, still prices,
 * still links out through the fallback search. Making every student in
 * a market wait on it — including the ones who never click a photo
 * link — was paying the whole market's latency for one row's polish.
 *
 * So the response ships the inventory, and the join lands in the store
 * behind it. The next reader of that market gets the pages for free,
 * and with the store shared across every student the "next reader" is
 * usually seconds later, not the same person.
 *
 * ONCE PER ROW SET. The attempt is recorded before any awaiting, so a
 * burst of requests on a cold market schedules one join rather than
 * twenty. Keyed by timestamp, so tomorrow's rows get their own attempt.
 *
 * ZERO coverage is the trigger, deliberately: any row carrying a page
 * proves the join has run over this set, and the portal never matches
 * all of a market — so testing "some" rather than "enough" is what
 * makes this run exactly once instead of on every request forever.
 */
function joinAfterResponse(
  market: Market,
  rows: RentalListing[],
  listingsAt: string | null
): void {
  if (!needsListingPages(rows)) return;

  const attempt = `${market.slug}@${listingsAt ?? "unknown"}`;
  if (joinAttempted.has(attempt)) return;

  // Its own daily ceiling. A market refused today still shows its rows
  // and still links out through the fallback search — it waits its turn.
  if (!reserveJoin(market.slug).allowed) return;
  joinAttempted.add(attempt);

  after(async () => {
    const joined = await withListingPages(market, rows);
    if (!joined.some((r) => r.sourceUrl)) return;
    // The rows' own timestamp, never now: only their listing pages are
    // new, and restamping them would tell the next reader this
    // inventory is fresh and hold off the real refresh for a day.
    await writeMarketListings(market.slug, joined, listingsAt);
  });
}

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
    // Rows written before the join shipped carry no listing page, and
    // this early return is what kept them from ever getting one. Fill
    // them in behind the response rather than in front of it.
    joinAfterResponse(market, stored.listings, stored.listingsAt);
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
    // One timestamp for both writes, so the join's rewrite lands on the
    // same row rather than aging it forward.
    const asOf = new Date().toISOString();
    // Stored for the next instance, deploy, and student. Awaited so a
    // serverless runtime can't freeze the write mid-flight; it still
    // never throws.
    await writeMarketListings(market.slug, listings, asOf);
    joinAfterResponse(market, listings, asOf);
    return NextResponse.json({
      live: true,
      asOf,
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
