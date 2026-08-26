/**
 * Borrowed photos for one market's rentals:
 *   /api/rentals/photos?market=tampa
 *
 * Split out from /api/rentals on purpose. The rentals feed carries no
 * imagery in any of its 500 fields, so a photo has to come from a
 * second source — and that source is a proxied scrape that can take as
 * long as the rentals call itself. Awaiting it before answering meant a
 * student watched an empty map for the sum of two vendors instead of
 * the slower one, to get a picture they hadn't asked for yet.
 *
 * So: rows ship first, pictures land after. A market this can't cover
 * returns an empty index and the rows keep their sketch — never an
 * error, because nothing here is load-bearing.
 *
 * Keyed by normalised address rather than listing id: the two vendors
 * share no identifiers, only buildings.
 */

import { NextResponse } from "next/server";
import { fetchRedfinPhotoIndex } from "@/lib/live/redfin";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** One proxied search, paginated. Comfortably inside the ceiling. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ photos: {} }, { status: 404 });
  }

  let index: Map<string, string>;
  try {
    index = await fetchRedfinPhotoIndex(market);
  } catch {
    // A missing picture is not a failed search.
    return NextResponse.json({ market: market.slug, photos: {} });
  }

  return NextResponse.json({
    market: market.slug,
    photos: Object.fromEntries(index),
  });
}
