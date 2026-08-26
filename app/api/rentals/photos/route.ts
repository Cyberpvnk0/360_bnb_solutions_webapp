/**
 * Borrowed photos for one market's rentals:
 *   /api/rentals/photos?market=tampa
 *   /api/rentals/photos?market=tampa&shape=1   ← why a match missed
 *
 * Split out from /api/rentals on purpose. The rentals feed carries no
 * imagery in any of its fields, so a photo has to come from a second
 * source — and that source is a proxied scrape that can take as long as
 * the rentals call itself. Awaiting it before answering meant a student
 * watched an empty map for the sum of two vendors instead of the slower
 * one, to get a picture they hadn't asked for yet. So: rows ship first,
 * pictures land after.
 *
 * And the second source is not just a photo mine. It is the same search
 * the Furnished view shows outright, so its rows arrive as complete
 * listings — photo welded on, nothing to match. A row the feed also
 * carries lends that row its photo; a row the feed DOESN'T carry is
 * returned as a listing in its own right rather than discarded. That is
 * the Furnished approach, replicated: where a photo exists at the
 * source, the property on screen has it, because it IS that row.
 *
 * The match happens HERE, not in the browser, and the answer is keyed
 * by listing id. Both feeds are already in the server's cache, so it
 * costs nothing extra — and it means there is exactly one copy of the
 * matching rules. The earlier cut sent an address-keyed index down and
 * had the client re-derive the same keys, which is two implementations
 * that have to agree forever.
 *
 * Never fails: a market this can't cover returns an empty map and the
 * rows keep their sketch.
 */

import { NextResponse } from "next/server";
import { addressKey, buildingKey } from "@/lib/live/address";
import {
  fetchRedfinPhotoIndex,
  mapRedfinRows,
  probeHouseFilters,
  redfinAddressOf,
  redfinCoversMarket,
} from "@/lib/live/redfin";
import { fetchLiveRentals } from "@/lib/live/rentcast";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** Two paginated searches plus geocoding on a cold market. The plan's
 *  whole ceiling, because the first visit to a big market genuinely
 *  needs it — and everything after rides the caches. */
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ photos: {} }, { status: 404 });
  }
  const shape = searchParams.get("shape");

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
      photos: {},
      ...(shape ? { verdict: "No photo source is mapped for this market." } : {}),
    });
  }

  // Both are cached by the time a student is looking at the rows, so
  // this is a cache read in the common case, and parallel when it isn't.
  const [source, listings] = await Promise.all([
    fetchRedfinPhotoIndex(market).catch(() => null),
    fetchLiveRentals(market).catch(() => []),
  ]);
  const index = source?.index ?? new Map<string, string>();
  const buildings = source?.buildings ?? new Map<string, string>();

  const photos: Record<string, string> = {};
  let exact = 0;
  let byBuilding = 0;
  const misses: string[] = [];
  /** Buildings the feed already shows in some form — an extra row for
   *  the same building would read as a duplicate card. */
  const feedBuildings = new Set<string>();

  for (const listing of listings) {
    const building = buildingKey(listing.address);
    if (building) feedBuildings.add(building);
    if (listing.photoUrl) continue;
    const key = addressKey(listing.address);
    const own = key ? index.get(key) : undefined;
    const block = building ? buildings.get(building) : undefined;
    const hit = own ?? block;
    if (hit) {
      photos[listing.id] = hit;
      if (own) exact += 1;
      else byBuilding += 1;
    } else {
      misses.push(key ?? `(unkeyable) ${listing.address}`);
    }
  }

  // The rows the feed doesn't carry, offered as listings. Dedup is by
  // BUILDING on purpose: the feed lists a complex unit by unit while
  // the source lists it once, and a card for "the building" beside five
  // cards for its units reads as a sixth copy, not more inventory.
  //
  // Deduped BEFORE mapping, because mapping means geocoding, seconds
  // per cold address — placing rows that were about to be discarded is
  // how this route once outran its whole time budget on the biggest
  // market and answered with nothing.
  const candidates = (source?.rows ?? []).filter((row) => {
    const address = redfinAddressOf(row);
    const building = address ? buildingKey(address) : null;
    return building === null || !feedBuildings.has(building);
  });
  const extras = candidates.length
    ? (await mapRedfinRows(candidates, market, { furnished: false })).listings
    : [];

  return NextResponse.json({
    market: market.slug,
    photos,
    /** Complete listings the feed doesn't carry — shown, not mined. */
    listings: extras,
    /** Coverage, not a claim that every row has one. */
    matched: Object.keys(photos).length,
    extrasAdded: extras.length,
    rows: listings.length,
    ...(shape
      ? {
          // Both sides' keys, so a format mismatch is visible rather
          // than guessed at. These are normalised street addresses from
          // public listings — no contact details, no prose.
          exact,
          byBuilding,
          indexedKeys: index.size,
          // Where the photo source's rows went. A thin index is either
          // few rows or rows we failed to read, and these separate the
          // two without another round of guessing.
          photoSource: source?.stats ?? null,
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
                : source?.stats.housePassError
                  ? `Matching works, but the house pass DIED: ${source.stats.housePassError}. "quota" is the vendor's concurrency throttle, not the filter — the filter itself was measured working. Retry; the shared request gate should hold every pass under the limit now.`
                  : (source?.stats.housePassNewKeys ?? 0) < 20
                    ? "Matching works, but the house pass is INERT — it returned rows and added almost no new keys, which is what a filter the vendor ignores looks like. Compare houseSampleAddresses with sampleAddresses: if both are apartment communities, the filter is not biting. Try ?houseProbe=1."
                    : "Matching works and both passes contribute. Coverage is bounded by page depth (see morePages) and by how much inventory the two sources share.",
        }
      : {}),
  });
}
