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
import { fetchRedfinPhotoIndex, redfinCoversMarket } from "@/lib/live/redfin";
import { fetchLiveRentals } from "@/lib/live/rentcast";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** One proxied search, paginated. Comfortably inside the ceiling. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ photos: {} }, { status: 404 });
  }
  const shape = searchParams.get("shape");

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

  const photos: Record<string, string> = {};
  let exact = 0;
  let byBuilding = 0;
  const unmatched: string[] = [];

  for (const listing of listings) {
    if (listing.photoUrl) continue;
    const key = addressKey(listing.address);
    const building = buildingKey(listing.address);
    const hit = (key && index.get(key)) ?? (building && index.get(building));
    if (hit) {
      photos[listing.id] = hit;
      if (key && index.get(key)) exact += 1;
      else byBuilding += 1;
    } else if (unmatched.length < 12) {
      unmatched.push(key ?? `(unkeyable) ${listing.address}`);
    }
  }

  return NextResponse.json({
    market: market.slug,
    photos,
    /** Coverage, not a claim that every row has one. */
    matched: Object.keys(photos).length,
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
          sampleUnmatchedRowKeys: unmatched,
          verdict:
            index.size === 0
              ? "The photo source returned nothing for this market — read photoSource: pages and rows say whether the fetch worked, withAddress and withPhoto whether the rows were readable."
              : Object.keys(photos).length === 0
                ? "Both sides have rows and NOTHING matched: compare sampleIndexKeys with sampleUnmatchedRowKeys — the two are writing addresses differently."
                : "Matching works. Coverage is bounded by how many rows the photo source returns for this market.",
        }
      : {}),
  });
}
