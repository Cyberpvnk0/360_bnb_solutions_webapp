/**
 * Submarkets: neighborhoods inside each market, generated lazily and
 * deterministically per market slug (~15–19 each; ~17 on average, so 387
 * markets carry ~6.6k submarkets without materializing anything up front).
 *
 * Consistency rules:
 * - A market's submarket listing counts sum EXACTLY to the parent's
 *   activeListings.
 * - ADR / occupancy / rent jitter around the parent; occupancy and
 *   breakeven store whole-point precision so displays can't drift.
 * - Breakeven comes from lib/calc with the same benchmark inputs the
 *   market page uses.
 *
 * Flagship markets carry real neighborhood anchors (San Marco and San
 * Pablo are really in Jacksonville); the long tail uses regional name
 * pools so nothing reads fake at a glance.
 */

import { breakevenOccupancy } from "@/lib/calc/arbitrage";
import { benchmark2brInputs, MARKETS } from "./markets";
import { clamp, hashStr, Rng, roundTo } from "./seed";
import type { Market, Submarket } from "./types";

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** Real neighborhood anchors for flagship markets. */
const ANCHORS: Record<string, string[]> = {
  jacksonville: [
    "San Marco", "Riverside", "San Pablo", "Springfield", "Avondale",
    "Mandarin", "Arlington", "Murray Hill", "Southside", "Ortega",
    "Baymeadows", "Atlantic Beach",
  ],
  nashville: [
    "East Nashville", "The Gulch", "Germantown", "12 South", "Sylvan Park",
    "Green Hills", "Berry Hill", "Donelson", "Inglewood", "Madison",
  ],
  austin: [
    "Zilker", "Hyde Park", "East Austin", "South Congress", "Barton Hills",
    "Mueller", "Allandale", "Tarrytown", "Rosedale", "Cherrywood",
  ],
  miami: [
    "Wynwood", "Brickell", "Little Havana", "Coconut Grove", "Edgewater",
    "Design District", "Coral Way", "Allapattah", "Little Haiti",
  ],
  phoenix: [
    "Arcadia", "Roosevelt Row", "Encanto", "Sunnyslope", "Ahwatukee",
    "Desert Ridge", "Moon Valley", "Laveen",
  ],
  "san-antonio": [
    "Alamo Heights", "Southtown", "Stone Oak", "Monte Vista", "Tobin Hill",
    "Medical Center", "King William",
  ],
  dallas: [
    "Deep Ellum", "Bishop Arts District", "Uptown", "Oak Lawn", "Lakewood",
    "Lower Greenville", "Knox-Henderson",
  ],
  houston: [
    "The Heights", "Montrose", "Midtown", "EaDo", "Rice Village",
    "Memorial", "Spring Branch", "Third Ward",
  ],
  tampa: [
    "Ybor City", "Hyde Park", "Seminole Heights", "Westshore",
    "Channelside", "Davis Islands",
  ],
  orlando: [
    "Thornton Park", "College Park", "Baldwin Park", "Mills 50",
    "Audubon Park", "Dr. Phillips", "MetroWest",
  ],
  columbus: [
    "Short North", "German Village", "Clintonville", "Franklinton",
    "Italian Village", "Victorian Village", "Olde Towne East",
  ],
  cleveland: [
    "Ohio City", "Tremont", "Detroit-Shoreway", "University Circle",
    "Edgewater", "Little Italy",
  ],
  cincinnati: [
    "Over-the-Rhine", "Hyde Park", "Oakley", "Northside", "Mount Adams",
    "Walnut Hills", "Clifton",
  ],
  memphis: ["Cooper-Young", "Midtown", "Harbor Town", "East Memphis", "Downtown"],
  atlanta: [
    "Midtown", "Old Fourth Ward", "Inman Park", "Buckhead", "East Atlanta",
    "Grant Park", "Virginia-Highland", "West End",
  ],
  charlotte: [
    "NoDa", "South End", "Plaza Midwood", "Dilworth", "Ballantyne",
    "University City",
  ],
  indianapolis: [
    "Broad Ripple", "Fountain Square", "Mass Ave", "Irvington",
    "Meridian-Kessler",
  ],
  denver: [
    "LoDo", "RiNo", "Capitol Hill", "Highlands", "Five Points",
    "Wash Park", "Baker", "Cherry Creek",
  ],
  "las-vegas": [
    "Summerlin", "Fremont East", "Spring Valley", "Paradise",
    "Centennial Hills", "The Lakes",
  ],
  scottsdale: [
    "Old Town", "Gainey Ranch", "McCormick Ranch", "DC Ranch", "Troon",
    "Grayhawk",
  ],
  gatlinburg: ["Chalet Village", "Ski Mountain", "Arts & Crafts Community"],
};

const GENERIC = [
  "Old Town", "Downtown", "Midtown", "Riverside", "Highland Park",
  "Westside", "Eastside", "North End", "South End", "Parkview", "Lakeview",
  "Fairview", "Oakdale", "Elmwood", "Brookside", "Hillcrest", "Sunset Park",
  "Garden District", "University District", "Warehouse District",
  "Arts District", "Historic District", "Cedar Grove", "Willow Bend",
  "Stonegate", "Meadowbrook", "Foxridge", "Orchard Heights", "Mill Creek",
  "Founders Row",
];

const COASTAL = [
  "Harborview", "Bayfront", "Seaside", "Marina District", "Lighthouse Point",
  "Dune Ridge", "Pelican Bay", "Shorecrest", "Boardwalk", "Inlet Beach",
];

const MOUNTAIN = [
  "Summit View", "Aspen Hollow", "Pine Ridge", "Timberline", "Creekside",
  "Alpine Meadows", "Eagle Crest", "Boulder Flats", "Elk Run",
];

const DESERT = [
  "Mesa Vista", "Vista del Sol", "Palo Verde", "Ocotillo", "Saguaro Ridge",
  "Casa Linda", "Agave Flats", "Cholla Springs",
];

const DIRECTIONS = ["North", "South", "East", "West", "Upper", "Lower"];

function poolFor(market: Market): string[] {
  switch (market.terrain) {
    case "coastal":
      return [...COASTAL, ...GENERIC];
    case "mountain":
      return [...MOUNTAIN, ...GENERIC];
    case "desert":
      return [...DESERT, ...GENERIC];
    default:
      return GENERIC;
  }
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** 15–19 submarkets per market — derived from the slug alone so totals
 *  can be counted without generating anything. */
export function submarketCountFor(marketSlug: string): number {
  return 15 + (hashStr(marketSlug) % 5);
}

/** Total submarkets across every market, computed analytically. */
export function totalSubmarketCount(): number {
  return MARKETS.reduce((sum, m) => sum + submarketCountFor(m.slug), 0);
}

const cache = new Map<string, Submarket[]>();

/** Deterministic submarkets for one market (memoized). */
export function submarketsFor(market: Market): Submarket[] {
  const hit = cache.get(market.slug);
  if (hit) return hit;

  const rng = new Rng(hashStr(market.slug) ^ 0x5ab5);
  const count = submarketCountFor(market.slug);

  // Names: real anchors first, then regional pool, then directional
  // variants — unique within the market.
  const names: string[] = [];
  const used = new Set<string>();
  const anchors = ANCHORS[market.slug] ?? [];
  for (const a of anchors) {
    if (names.length >= count) break;
    if (!used.has(a)) {
      used.add(a);
      names.push(a);
    }
  }
  const pool = rng.shuffle(poolFor(market));
  let pi = 0;
  while (names.length < count) {
    const base = pool[pi % pool.length];
    const candidate =
      pi < pool.length ? base : `${rng.pick(DIRECTIONS)} ${base}`;
    pi += 1;
    if (!used.has(candidate)) {
      used.add(candidate);
      names.push(candidate);
    }
  }

  // Listing split: random weights, then force the sum to match the parent
  // exactly (largest submarket absorbs rounding drift).
  const weights = names.map(() => rng.float(0.5, 1.6));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const listings = weights.map((w) =>
    Math.max(3, Math.round((market.activeListings * w) / weightSum))
  );
  const drift = market.activeListings - listings.reduce((a, b) => a + b, 0);
  const largest = listings.indexOf(Math.max(...listings));
  listings[largest] = Math.max(3, listings[largest] + drift);

  const subs: Submarket[] = names.map((name, i) => {
    const adr = roundTo(clamp(rng.jitter(market.adr, 0.15), 80, 340), 1);
    const occupancy =
      Math.round(clamp(rng.jitter(market.occupancy, 0.09), 0.42, 0.78) * 100) /
      100;
    const medianRent2br = roundTo(rng.jitter(market.medianRent2br, 0.12), 25);
    const be = breakevenOccupancy(benchmark2brInputs(medianRent2br), {
      adr,
      marketOccupancy: occupancy,
    });
    return {
      id: `${market.slug}--${slugify(name)}`,
      slug: slugify(name),
      name,
      marketSlug: market.slug,
      marketName: market.name,
      stateCode: market.stateCode,
      lat: Math.round((market.lat + rng.float(-0.12, 0.12)) * 1000) / 1000,
      lon: Math.round((market.lon + rng.float(-0.12, 0.12)) * 1000) / 1000,
      adr,
      occupancy,
      activeListings: listings[i],
      medianRent2br,
      avgBreakeven2br: Math.round(be * 100) / 100,
    };
  });

  cache.set(market.slug, subs);
  return subs;
}

let allCache: Submarket[] | null = null;

/** Every submarket across every market (memoized; ~6.6k lean objects). */
export function allSubmarkets(): Submarket[] {
  if (allCache) return allCache;
  allCache = MARKETS.flatMap((m) => submarketsFor(m));
  return allCache;
}
