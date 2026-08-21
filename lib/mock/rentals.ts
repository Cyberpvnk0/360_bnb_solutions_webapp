/**
 * Rental listings for the Deal Finder: rentals ONLY, never for-sale.
 *
 * Generated lazily and deterministically per market (6–12 each; ~3.5k
 * nationwide across ~390 markets) with per-entity seeds, so generation is
 * order-independent and nothing materializes until a screen asks.
 *
 * Consistency rules:
 * - Rents jitter ±10% around the parent market's 2 bd median scaled by a
 *   bedroom factor, rounded to $25 like every other rent in the product.
 * - The card's cushion figure comes from lib/calc with the same benchmark
 *   inputs the market pages use — never an inline formula.
 * - rentals.ts must NOT import analyses.ts (analyses.ts may import this
 *   module — the graph stays acyclic).
 */

import { breakevenOccupancy } from "@/lib/calc/arbitrage";
import { benchmark2brInputs, MARKETS } from "./markets";
import { hashStr, Rng, roundTo } from "./seed";
import type {
  Market,
  MarketTerrain,
  PropertyType,
  RentalListing,
} from "./types";

/* ------------------------------------------------------------------ */
/* Name pools                                                          */
/* ------------------------------------------------------------------ */

const STREETS = [
  "Alder", "Birchwood", "Crestline", "Driftwood", "Elm Hollow", "Fernwood",
  "Goldenrod", "Hawthorne", "Kingfisher", "Larkspur", "Mulberry", "Nettle Creek",
  "Oleander", "Pecan Grove", "Quailwood", "Redbud", "Sable Ridge", "Tanager",
  "Vineyard", "Wisteria", "Boxelder", "Cottonwood", "Silver Birch", "Amberfield",
];
const STREET_TYPES = ["St", "Ave", "Ln", "Dr", "Ct", "Way", "Blvd", "Ter"];

/* ------------------------------------------------------------------ */
/* Factors                                                             */
/* ------------------------------------------------------------------ */

/** Long-term asking-rent multipliers by bedroom count vs the 2 bd median. */
export const BEDROOM_RENT_FACTOR: Record<number, number> = {
  1: 0.78,
  2: 1,
  3: 1.28,
  4: 1.55,
  5: 1.8,
};

/** ADR multipliers by bedroom count vs the market's 2 bd benchmark ADR —
 *  used for the card-level cushion estimate. */
export const BEDROOM_ADR_FACTOR: Record<number, number> = {
  1: 0.78,
  2: 1,
  3: 1.22,
  4: 1.45,
  5: 1.62,
};

/** Bedrooms 1–5, weighted toward 2–3 like the arbitrage sweet spot. */
const BEDROOM_POOL = [1, 2, 2, 2, 3, 3, 3, 4, 5] as const;

/** Property types weighted toward the units operators actually lease. */
const TYPE_POOL: readonly PropertyType[] = [
  "apartment", "apartment", "apartment",
  "house", "house",
  "condo", "condo",
  "townhome",
];

/* ------------------------------------------------------------------ */
/* Feature tags — the Zillow-style keyword surface                     */
/* ------------------------------------------------------------------ */

/** Tags any listing can carry, anywhere in the country. */
export const BASE_FEATURES = [
  "Renovated",
  "Washer & dryer",
  "Garage",
  "Balcony",
  "Fenced yard",
  "New build",
  "Corner unit",
  "Gated community",
  "Near downtown",
  "Covered parking",
] as const;

/** Tags that only make sense in a market's terrain — a mountain-town
 *  listing can be ski-in, a coastal one waterfront, never the reverse. */
export const TERRAIN_FEATURES: Record<MarketTerrain, readonly string[]> = {
  metro: ["Rooftop deck", "Near transit", "City view", "Private pool"],
  coastal: ["Waterfront", "Ocean view", "Near the beach", "Boat slip", "Private pool"],
  mountain: ["Mountain view", "Hot tub", "Fireplace", "Ski storage"],
  desert: ["Private pool", "Casita", "Desert view", "Covered patio"],
};

/**
 * Seeded independently of the listing's own value stream (`feat|id`), so
 * adding tags never reshuffles rents or addresses. "Furnished" is rolled
 * on its own — it is the tag arbitrage operators hunt for, since it can
 * zero out the furnishing budget. Terrain tags appear twice in the pool
 * so a coastal market actually reads coastal.
 */
function featuresFor(
  id: string,
  terrain: MarketTerrain,
  petFriendly: boolean
): string[] {
  const rng = new Rng(hashStr(`feat|${id}`));
  const features: string[] = [];
  if (rng.chance(0.2)) features.push("Furnished");
  if (petFriendly) features.push("Pet friendly");
  const pool = [
    ...TERRAIN_FEATURES[terrain],
    ...TERRAIN_FEATURES[terrain],
    ...BASE_FEATURES,
  ];
  const wanted = rng.int(2, 4);
  const chosen = new Set<string>();
  while (chosen.size < wanted) chosen.add(pool[rng.int(0, pool.length - 1)]);
  features.push(...chosen);
  return features;
}

/** Same shape as the analyses generator: 1–3 baths in half steps. */
function bathsFor(bedrooms: number, rng: Rng): number {
  if (bedrooms <= 1) return 1;
  if (bedrooms === 2) return rng.chance(0.5) ? 2 : 1;
  if (bedrooms === 3) return 2;
  return rng.chance(0.5) ? 3 : 2.5;
}

/* ------------------------------------------------------------------ */
/* Cushion estimate — the card's signal figure                         */
/* ------------------------------------------------------------------ */

/**
 * Whole points of cushion (market occupancy − breakeven) for one listing:
 * benchmark operating costs at this listing's rent, the market's ADR
 * scaled to the listing's bedroom count, the market's actual occupancy.
 * Pure — same inputs, same answer, everywhere it's shown.
 */
export function estimateCushionPts(
  listing: RentalListing,
  market: Market
): number {
  const inputs = benchmark2brInputs(listing.rentMonthly);
  const assumptions = {
    adr: Math.round(market.adr * BEDROOM_ADR_FACTOR[listing.bedrooms]),
    marketOccupancy: market.occupancy,
  };
  const be = breakevenOccupancy(inputs, assumptions);
  return Math.round((market.occupancy - be) * 100);
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** 6–12 listings per market — derived from the slug alone so totals can
 *  be counted without generating anything. */
export function rentalCountFor(marketSlug: string): number {
  return 6 + (hashStr(`rentals|${marketSlug}`) % 7);
}

/** Total listings across every market, computed analytically. */
export function totalRentalCount(): number {
  return MARKETS.reduce((sum, m) => sum + rentalCountFor(m.slug), 0);
}

const cache = new Map<string, RentalListing[]>();

/** Deterministic rental listings for one market (memoized). */
export function rentalsFor(market: Market): RentalListing[] {
  const hit = cache.get(market.slug);
  if (hit) return hit;

  const rng = new Rng(hashStr(`rentals|${market.slug}`));
  const count = rentalCountFor(market.slug);

  const listings: RentalListing[] = Array.from({ length: count }, (_, i) => {
    const bedrooms = rng.pick(BEDROOM_POOL);
    const bathrooms = bathsFor(bedrooms, rng);
    const propertyType = rng.pick(TYPE_POOL);
    const unit =
      (propertyType === "apartment" || propertyType === "condo") &&
      rng.chance(0.6)
        ? ` #${rng.int(2, 48)}`
        : "";
    const id = `rl--${market.slug}--${i}`;
    // The base draws stay in their original order so adding features never
    // reshuffles addresses or rents; features use their own per-id stream.
    const base = {
      id,
      analysisId: `r--${market.slug}--${i}`,
      address: `${rng.int(100, 9800)} ${rng.pick(STREETS)} ${rng.pick(STREET_TYPES)}${unit}`,
      city: market.name,
      stateCode: market.stateCode,
      marketSlug: market.slug,
      lat: Math.round((market.lat + rng.float(-0.045, 0.045)) * 1000) / 1000,
      lon: Math.round((market.lon + rng.float(-0.045, 0.045)) * 1000) / 1000,
      bedrooms,
      bathrooms,
      sqft: roundTo(rng.jitter(420 + bedrooms * 360, 0.12), 10),
      propertyType,
      rentMonthly: roundTo(
        rng.jitter(market.medianRent2br * BEDROOM_RENT_FACTOR[bedrooms], 0.1),
        25
      ),
      daysOnMarket: rng.int(0, 45),
      petFriendly: rng.chance(0.45),
    };
    return {
      ...base,
      features: featuresFor(id, market.terrain, base.petFriendly),
    };
  });

  cache.set(market.slug, listings);
  return listings;
}

/* ------------------------------------------------------------------ */
/* Live listings registry                                              */
/* ------------------------------------------------------------------ */

/** Live rows fetched this session (RentCast via /api/rentals), indexed by
 *  analysis id so "Run the numbers" resolves them exactly like seeded
 *  inventory. Session-scoped by design: a hard refresh on a live
 *  analysis id simply falls back to the blank analyzer entry. */
const LIVE_BY_ANALYSIS_ID = new Map<string, RentalListing>();

export function registerLiveListings(listings: RentalListing[]): void {
  for (const l of listings) LIVE_BY_ANALYSIS_ID.set(l.analysisId, l);
}

export function liveListingByAnalysisId(
  id: string
): RentalListing | undefined {
  return LIVE_BY_ANALYSIS_ID.get(id);
}

let allCache: RentalListing[] | null = null;

/** Listings by their analysis id — filled the first time allRentals()
 *  materializes the nationwide set. Call allRentals() before reading. */
export const RENTAL_BY_ANALYSIS_ID = new Map<string, RentalListing>();

/** Every listing across every market (memoized; ~3.5k lean objects). */
export function allRentals(): RentalListing[] {
  if (allCache) return allCache;
  allCache = MARKETS.flatMap((m) => rentalsFor(m));
  for (const listing of allCache) {
    RENTAL_BY_ANALYSIS_ID.set(listing.analysisId, listing);
  }
  return allCache;
}
