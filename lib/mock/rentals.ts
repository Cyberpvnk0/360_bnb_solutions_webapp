/**
 * Rental listings for the Deal Finder: rentals ONLY, never for-sale.
 *
 * Generated lazily and deterministically per SUBMARKET (1–3 listings in
 * each of a market's 15–19 neighborhoods, so a city's inventory spreads
 * across the whole metro the way real inventory does — beaches and
 * suburbs included, never a downtown blob). Per-entity seeds keep
 * generation order-independent; nothing materializes until a screen asks.
 *
 * Consistency rules:
 * - Rents jitter ±10% around the SUBMARKET's 2 bd median scaled by a
 *   bedroom factor, rounded to $25 like every other rent in the product,
 *   so a metro's internal price gradient survives.
 * - The card's cushion figure comes from lib/calc with the same benchmark
 *   inputs the market pages use — never an inline formula.
 * - rentals.ts must NOT import analyses.ts (analyses.ts may import this
 *   module — the graph stays acyclic).
 */

import { breakevenOccupancy } from "@/lib/calc/arbitrage";
import { benchmark2brInputs, MARKETS } from "./markets";
import { hashStr, Rng, roundTo } from "./seed";
import { submarketsFor } from "./submarkets";
import type {
  ListingContact,
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

/* ------------------------------------------------------------------ */
/* Contacts — who to call about the unit                               */
/* ------------------------------------------------------------------ */

const MGMT_PREFIX = [
  "Anchor", "Beacon", "Cornerstone", "Dunehill", "Evergreen", "Foxglove",
  "Granite", "Harborview", "Ironwood", "Juniper", "Keystone", "Lakeshore",
  "Meridian", "Northgate", "Oakfield", "Pinecrest", "Quarry", "Redstone",
  "Summit", "Trailhead", "Vantage", "Westbrook",
];
const MGMT_SUFFIX = [
  "Property Group", "Residential", "Rentals", "Property Management",
  "Realty", "Leasing Co", "Holdings", "Management",
];
const FIRST = [
  "Alan", "Bianca", "Carmen", "Devon", "Elena", "Franklin", "Grace",
  "Hector", "Imani", "Jonah", "Kelsey", "Luis", "Marisol", "Nadia",
  "Omar", "Priya", "Quinn", "Rosa", "Simone", "Terrence", "Uma", "Victor",
];
const LAST = [
  "Alvarez", "Bishop", "Castellano", "Dunbar", "Eriksen", "Farrow",
  "Gallagher", "Hollis", "Ibarra", "Jennings", "Kowalski", "Lindqvist",
  "Marchetti", "Novak", "Okafor", "Pemberton", "Reyes", "Sandoval",
  "Thibodeaux", "Vance", "Whitfield", "Yates",
];

/**
 * A seeded contact for preview inventory. Numbers use the 555-01xx range
 * and addresses the example.com domain — both reserved for fiction, so a
 * demo can never ring a real person. Live rows carry the feed's own
 * agent or office instead.
 */
function contactFor(id: string): ListingContact {
  const rng = new Rng(hashStr(`contact|${id}`));
  const first = rng.pick(FIRST);
  const last = rng.pick(LAST);
  const managed = rng.chance(0.72);
  const company = managed
    ? `${rng.pick(MGMT_PREFIX)} ${rng.pick(MGMT_SUFFIX)}`
    : undefined;
  const domain = company
    ? `${company.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example.com`
    : "example.com";
  return {
    name: `${first} ${last}`,
    company,
    phone: `(${rng.pick(AREA_CODES)}) 555-01${String(rng.int(0, 99)).padStart(2, "0")}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
    role: managed ? "Property manager" : "Owner",
  };
}

/** Plausible US area codes for preview contacts. */
const AREA_CODES = [
  "205", "212", "303", "305", "312", "404", "407", "512", "602", "615",
  "702", "704", "813", "817", "904", "919",
];

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

/** 1–3 listings per neighborhood — enough to read as a real market
 *  without inventing a city's worth of fake addresses. */
function rentalCountForSubmarket(submarketId: string): number {
  return 1 + (hashStr(`rentals|${submarketId}`) % 3);
}

/** Listings for one market, summed across its submarkets. */
export function rentalCountFor(market: Market): number {
  return submarketsFor(market).reduce(
    (sum, sub) => sum + rentalCountForSubmarket(sub.id),
    0
  );
}

/** Total listings across every market. */
export function totalRentalCount(): number {
  return MARKETS.reduce((sum, m) => sum + rentalCountFor(m), 0);
}

const cache = new Map<string, RentalListing[]>();

/** Deterministic rental listings for one market (memoized), spread
 *  across its neighborhoods. */
export function rentalsFor(market: Market): RentalListing[] {
  const hit = cache.get(market.slug);
  if (hit) return hit;

  const listings: RentalListing[] = [];
  for (const sub of submarketsFor(market)) {
    const rng = new Rng(hashStr(`rentals|${sub.id}`));
    const count = rentalCountForSubmarket(sub.id);
    for (let i = 0; i < count; i++) {
      const bedrooms = rng.pick(BEDROOM_POOL);
      const bathrooms = bathsFor(bedrooms, rng);
      const propertyType = rng.pick(TYPE_POOL);
      const unit =
        (propertyType === "apartment" || propertyType === "condo") &&
        rng.chance(0.6)
          ? ` #${rng.int(2, 48)}`
          : "";
      const id = `rl--${sub.id}--${i}`;
      const base = {
        id,
        analysisId: `r--${sub.id}--${i}`,
        address: `${rng.int(100, 9800)} ${rng.pick(STREETS)} ${rng.pick(STREET_TYPES)}${unit}`,
        city: market.name,
        stateCode: market.stateCode,
        marketSlug: market.slug,
        submarketName: sub.name,
        // Tight around the neighborhood, which itself sits away from
        // the market center — so a metro fills out, block by block.
        lat: Math.round((sub.lat + rng.float(-0.012, 0.012)) * 1000) / 1000,
        lon: Math.round((sub.lon + rng.float(-0.012, 0.012)) * 1000) / 1000,
        bedrooms,
        bathrooms,
        sqft: roundTo(rng.jitter(420 + bedrooms * 360, 0.12), 10),
        propertyType,
        // The neighborhood's own median carries the market's price
        // gradient: San Marco doesn't rent like Springfield.
        rentMonthly: roundTo(
          rng.jitter(sub.medianRent2br * BEDROOM_RENT_FACTOR[bedrooms], 0.1),
          25
        ),
        daysOnMarket: rng.int(0, 45),
        petFriendly: rng.chance(0.45),
      };
      listings.push({
        ...base,
        features: featuresFor(id, market.terrain, base.petFriendly),
        contact: contactFor(id),
      });
    }
  }

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
