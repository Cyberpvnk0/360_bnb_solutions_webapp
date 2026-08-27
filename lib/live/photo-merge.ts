/**
 * The photo merge for one market, in one place.
 *
 * One caller: the route the browser asks for a beat after the rows
 * render. Nothing pre-fetches — a market costs credits the moment
 * someone searches it and not before, which is the whole trade. The
 * first student into a market each morning waits; everyone after them
 * rides the stored row for free.
 *
 * Everything expensive underneath — search pages, the feed, geocodes —
 * lands in the store, so "whoever runs this first pays" is true exactly
 * once per market per TTL rather than once per deployment.
 */

import { addressKey, buildingKey } from "@/lib/live/address";
import {
  fetchRedfinPhotoIndex,
  mapRedfinRows,
  redfinAddressOf,
  redfinCoversMarket,
  type RedfinPhotoIndex,
} from "@/lib/live/redfin";
import { fetchLiveRentals } from "@/lib/live/rentcast";
import type { Market, RentalListing } from "@/lib/mock/types";

export interface MarketPhotoMerge {
  /** False when no photo source is mapped for this market. */
  covered: boolean;
  /** The feed's own rows, so one search stores the whole day —
   *  listings and photos both — from a single computation. */
  feed: RentalListing[];
  /** Feed listing id → photo, for rows the feed already shows. */
  photos: Record<string, string>;
  /** Complete listings the feed doesn't carry — shown, not mined. */
  extras: RentalListing[];
  /** Feed rows considered. */
  rows: number;
  exact: number;
  byBuilding: number;
  /** Normalised keys of feed rows nothing matched. */
  misses: string[];
  index: Map<string, string>;
  stats: RedfinPhotoIndex["stats"] | null;
}

export async function buildMarketPhotoMerge(
  market: Market
): Promise<MarketPhotoMerge> {
  const empty: MarketPhotoMerge = {
    covered: redfinCoversMarket(market),
    feed: [],
    photos: {},
    extras: [],
    rows: 0,
    exact: 0,
    byBuilding: 0,
    misses: [],
    index: new Map(),
    stats: null,
  };
  if (!empty.covered) return empty;

  // Both are cached by the time a student is looking at the rows, so
  // this is a cache read in the common case, and parallel when it isn't.
  const [source, listings] = await Promise.all([
    fetchRedfinPhotoIndex(market).catch(() => null),
    fetchLiveRentals(market).catch(() => [] as RentalListing[]),
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

  return {
    covered: true,
    feed: listings,
    photos,
    extras,
    rows: listings.length,
    exact,
    byBuilding,
    misses,
    index,
    stats: source?.stats ?? null,
  };
}
