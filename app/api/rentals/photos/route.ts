/**
 * Borrowed photos for one market's rentals:
 *   /api/rentals/photos?market=tampa
 *   /api/rentals/photos?market=tampa&shape=1   ← why a match missed
 *
 * NO LONGER SERVES PHOTOS, despite the path. What it serves is the
 * listings the rentals feed misses.
 *
 * A listing photo is copyrighted separately from the listing — the
 * photographer's, then the brokerage's, under display rules we hold no
 * licence to. Facts about a property are not: an address, a rent, a
 * bedroom count. So the rows stay and the pictures go, every card draws
 * a Street View of the kerb instead, and a "View photos" link sends
 * anyone who wants the interiors to the page that is licensed to show
 * them. A link is not a copy.
 *
 * The match is still COMPUTED, and still reported under ?shape=1: it is
 * how coverage gets diagnosed, it costs nothing extra because the same
 * fetch produces it, and if a licence ever exists the wiring is here.
 * It just does not reach a browser.
 *
 * Split out from /api/rentals on purpose. The second source is a
 * proxied scrape that can take as long as the rentals call itself, and
 * awaiting it before answering meant a student watched an empty map for
 * the sum of two vendors rather than the slower one. Rows ship first;
 * the extra inventory lands after.
 *
 * The match happens HERE, not in the browser, and the answer is keyed
 * by listing id. Both feeds are already in the server's cache, so it
 * costs nothing extra — and it means there is exactly one copy of the
 * matching rules. The earlier cut sent an address-keyed index down and
 * had the client re-derive the same keys, which is two implementations
 * that have to agree forever.
 *
 * Never fails: a market this can't cover returns an empty list and the
 * feed's own rows stand alone.
 */

import { NextResponse } from "next/server";
import {
  isFresh,
  readMarketStore,
  storeStatus,
  writeMarketPhotoMerge,
} from "@/lib/db/market-store";
import { buildMarketPhotoMerge } from "@/lib/live/photo-merge";
import { probeHouseFilters, redfinCoversMarket } from "@/lib/live/redfin";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { RentalListing } from "@/lib/mock/types";

/**
 * Strip the borrowed photo on the way out.
 *
 * Here rather than at the merge, because stored rows were written when
 * photos still shipped and would otherwise keep serving them until
 * every row aged out. One boundary, both cases.
 */
function withoutPhotos(rows: RentalListing[]): RentalListing[] {
  return rows.map((row) => {
    const shed: RentalListing = { ...row };
    delete shed.photoUrl;
    return shed;
  });
}

/** Two paginated searches plus geocoding on a cold market. The plan's
 *  whole ceiling, because the first visit to a big market genuinely
 *  needs it — and everything after rides the caches. */
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ listings: [] }, { status: 404 });
  }
  const shape = searchParams.get("shape");

  // Setup check: does the durable store actually work, and if not, why.
  // Its own flag because it WRITES — a sentinel row, never a market —
  // and proving a key's access is worth a round trip nobody pays for on
  // a page load.
  if (searchParams.get("storeCheck")) {
    return NextResponse.json({ store: await storeStatus() });
  }

  // One page per candidate URL, run only when asked. The house filter
  // has to be found by measurement: a form the vendor ignores answers
  // with the unfiltered set, so the only way to tell a working filter
  // from a dead one is to compare what each returns.
  if (searchParams.get("houseProbe")) {
    return NextResponse.json(await probeHouseFilters(market));
  }

  if (!redfinCoversMarket(market)) {
    return NextResponse.json({
      market: market.slug,
      listings: [],
      ...(shape ? { verdict: "No second source is mapped for this market." } : {}),
    });
  }

  // The durable store first — a fresh photo merge is the whole answer,
  // computed once by whoever searched this market first and paid for
  // it. The shape probe always computes live: it exists to watch the
  // pipeline run, and a stored answer would hide exactly what it is
  // for.
  const stored = await readMarketStore(market.slug);
  if (!shape && stored?.photoMerge && isFresh(stored.photoMergeAt)) {
    const kept = stored.photoMerge;
    return NextResponse.json({
      market: market.slug,
      listings: withoutPhotos(kept.extras),
      matched: kept.matched,
      extrasAdded: kept.extras.length,
      rows: kept.rows,
    });
  }

  const merge = await buildMarketPhotoMerge(market);
  const { photos, extras, index, misses } = merge;
  const gotSomething = Object.keys(photos).length > 0 || extras.length > 0;

  // A live pass that produced nothing, with a stored one sitting there,
  // means the vendor didn't answer — exhausted credits, a throttle, an
  // outage. Yesterday's photos are the right answer to that: the same
  // buildings, and rental stock does not turn over overnight. Only ever
  // a fallback, never preferred over a live result.
  if (!shape && !gotSomething && stored?.photoMerge) {
    const kept = stored.photoMerge;
    return NextResponse.json({
      market: market.slug,
      listings: withoutPhotos(kept.extras),
      matched: kept.matched,
      extrasAdded: kept.extras.length,
      rows: kept.rows,
      /** Said plainly: this is the stored copy, and when it was taken. */
      stale: true,
      asOf: stored.photoMergeAt,
    });
  }

  // Never overwrite a real answer with an empty one. A pass that failed
  // has nothing to teach the store, and storing its emptiness would
  // discard the copy that is still serving people.
  if (merge.covered && gotSomething) {
    await writeMarketPhotoMerge(market.slug, {
      photos,
      extras,
      matched: Object.keys(photos).length,
      rows: merge.rows,
    });
  }

  return NextResponse.json({
    market: market.slug,
    /** Complete listings the feed doesn't carry — facts, not pictures. */
    listings: withoutPhotos(extras),
    /** Match coverage, for the probe. No photo rides along with it. */
    matched: Object.keys(photos).length,
    extrasAdded: extras.length,
    rows: merge.rows,
    ...(shape
      ? {
          // Both sides' keys, so a format mismatch is visible rather
          // than guessed at. These are normalised street addresses from
          // public listings — no contact details, no prose.
          exact: merge.exact,
          byBuilding: merge.byBuilding,
          indexedKeys: index.size,
          // Where the photo source's rows went. A thin index is either
          // few rows or rows we failed to read, and these separate the
          // two without another round of guessing.
          photoSource: merge.stats,
          // What the durable store held when this probe began, so a
          // stale or missing row is visible next to the live numbers.
          store: {
            listingsAt: stored?.listingsAt ?? null,
            photoMergeAt: stored?.photoMergeAt ?? null,
          },
          sampleIndexKeys: [...index.keys()].slice(0, 12),
          // Spread across the whole miss list. The rows arrive sorted
          // by rent, so "the first twelve" was the twelve cheapest —
          // and a sample of one end of a sorted list shaped a whole
          // round of this investigation.
          sampleUnmatchedRowKeys: Array.from(
            { length: Math.min(12, misses.length) },
            (_, i) => misses[Math.floor((i * misses.length) / Math.min(12, misses.length))]
          ),
          verdict:
            index.size === 0
              ? "The photo source returned nothing for this market — read photoSource: pages and rows say whether the fetch worked, withAddress and withPhoto whether the rows were readable."
              : Object.keys(photos).length === 0
                ? "Both sides have rows and NOTHING matched: compare sampleIndexKeys with sampleUnmatchedRowKeys — the two are writing addresses differently."
                : merge.stats?.housePassError?.includes("no-credits")
                  ? "The scraping plan's credits are spent for this cycle — nothing here is broken and no code change will help. Stored markets keep serving (stale: true); the rest wait for the reset or a plan with credits in it."
                  : merge.stats?.housePassError
                  ? `Matching works, but the house pass DIED: ${merge.stats?.housePassError}. "quota" is the vendor's concurrency throttle, not the filter — the filter itself was measured working. Retry; the shared request gate should hold every pass under the limit now.`
                  : (merge.stats?.housePassNewKeys ?? 0) < 20
                    ? "Matching works, but the house pass is INERT — it returned rows and added almost no new keys, which is what a filter the vendor ignores looks like. Compare houseSampleAddresses with sampleAddresses: if both are apartment communities, the filter is not biting. Try ?houseProbe=1."
                    : "Matching works and both passes contribute. Coverage is bounded by page depth (see morePages) and by how much inventory the two sources share.",
        }
      : {}),
  });
}
