/**
 * 40 US markets, weighted toward FL, TX, TN, AZ, and OH.
 *
 * Hand-authored base figures for realism; deterministic jitter for texture.
 * All derived numbers (RevPAR, deltas, average 2BR breakeven) are computed
 * through lib/calc so nothing can contradict the formulas.
 */

import { breakevenOccupancy } from "@/lib/calc/arbitrage";
import { EXPANSION_SEEDS, type MarketKind } from "./market-seeds";
import { clamp, hashStr, Rng, roundTo, trailingMonths } from "./seed";
import type { BedroomAdr, Market, MarketMonth, MarketTerrain, Regulation, RegulationStatus } from "./types";

/** Seasonality shapes — monthly multipliers, Jan..Dec, mean ≈ 1. */
const SEASON: Record<string, number[]> = {
  // Gulf / Atlantic beach towns: spring break + summer peak.
  beach: [0.82, 0.9, 1.08, 1.12, 1.1, 1.22, 1.28, 1.18, 0.92, 0.86, 0.78, 0.84],
  // Smokies / Branson-style: summer + October leaf season + December.
  mountain: [0.78, 0.82, 0.95, 1.0, 1.05, 1.2, 1.28, 1.12, 0.98, 1.22, 0.85, 1.05],
  // Desert snowbird: winter/spring peak, brutal summer trough.
  desert: [1.22, 1.3, 1.35, 1.18, 1.0, 0.78, 0.7, 0.72, 0.85, 1.02, 1.12, 1.16],
  // Year-round metro: gentle summer lift.
  metro: [0.9, 0.94, 1.02, 1.04, 1.06, 1.1, 1.12, 1.06, 1.0, 0.98, 0.88, 0.9],
};

type SeasonType = keyof typeof SEASON;

interface MarketSeed {
  name: string;
  state: string;
  code: string;
  /** Override when another market shares the slugified name. */
  slug?: string;
  lat: number;
  lon: number;
  adr: number; // 2BR benchmark ADR
  occ: number; // trailing-12 occupancy
  listings: number;
  rent2br: number;
  season: SeasonType;
  reg: RegulationStatus;
  regNote?: string;
}

/* 10 FL, 8 TX, 6 TN, 5 AZ, 5 OH, 6 other = 40. */
const SEEDS: MarketSeed[] = [
  // Florida
  { name: "Kissimmee", state: "Florida", code: "FL", lat: 28.29, lon: -81.41, adr: 168, occ: 0.63, listings: 9800, rent2br: 1750, season: "beach", reg: "permitted", regNote: "Short-term rental zones cover most of the tourism corridor." },
  { name: "Davenport", state: "Florida", code: "FL", lat: 28.16, lon: -81.6, adr: 176, occ: 0.61, listings: 6400, rent2br: 1780, season: "beach", reg: "permitted", regNote: "Resort communities are built for nightly rentals." },
  { name: "Orlando", state: "Florida", code: "FL", lat: 28.54, lon: -81.38, adr: 158, occ: 0.65, listings: 7200, rent2br: 1820, season: "beach", reg: "permit-required", regNote: "City registration required; most activity sits just outside city limits." },
  { name: "Tampa", state: "Florida", code: "FL", lat: 27.95, lon: -82.46, adr: 172, occ: 0.64, listings: 3900, rent2br: 1900, season: "metro", reg: "permitted", regNote: "State preemption keeps the city from banning rentals under 30 days." },
  { name: "St. Petersburg", state: "Florida", code: "FL", lat: 27.77, lon: -82.64, adr: 189, occ: 0.66, listings: 2700, rent2br: 1950, season: "beach", reg: "permit-required", regNote: "Stays under 30 days limited to three times per year in residential zones." },
  { name: "Panama City Beach", state: "Florida", code: "FL", lat: 30.18, lon: -85.8, adr: 214, occ: 0.58, listings: 5600, rent2br: 1650, season: "beach", reg: "permitted", regNote: "Registration is routine; beach zoning welcomes nightly rentals." },
  { name: "Destin", state: "Florida", code: "FL", lat: 30.39, lon: -86.5, adr: 262, occ: 0.57, listings: 4800, rent2br: 1850, season: "beach", reg: "permit-required", regNote: "Annual registration and occupancy limits enforced." },
  { name: "Cape Coral", state: "Florida", code: "FL", lat: 26.56, lon: -81.95, adr: 181, occ: 0.55, listings: 3100, rent2br: 1700, season: "beach", reg: "permitted", regNote: "Seven-day minimum in some residential districts; verify the parcel." },
  { name: "Jacksonville", state: "Florida", code: "FL", lat: 30.33, lon: -81.66, adr: 139, occ: 0.6, listings: 2400, rent2br: 1450, season: "metro", reg: "unverified" },
  { name: "Miami", state: "Florida", code: "FL", lat: 25.76, lon: -80.19, adr: 243, occ: 0.68, listings: 8900, rent2br: 2850, season: "metro", reg: "banned", regNote: "Residential zones prohibit rentals under 30 days outside licensed districts." },
  // Texas
  { name: "San Antonio", state: "Texas", code: "TX", lat: 29.42, lon: -98.49, adr: 142, occ: 0.58, listings: 3600, rent2br: 1350, season: "metro", reg: "permit-required", regNote: "Type 2 (non-owner-occupied) permits capped per block face." },
  { name: "Dallas", state: "Texas", code: "TX", lat: 32.78, lon: -96.8, adr: 155, occ: 0.59, listings: 4100, rent2br: 1550, season: "metro", reg: "banned", regNote: "Single-family zoning excludes short-term rentals; litigation ongoing." },
  { name: "Fort Worth", state: "Texas", code: "TX", lat: 32.76, lon: -97.33, adr: 146, occ: 0.57, listings: 1900, rent2br: 1450, season: "metro", reg: "permit-required", regNote: "Registration required; most residential districts excluded." },
  { name: "Austin", state: "Texas", code: "TX", lat: 30.27, lon: -97.74, adr: 187, occ: 0.62, listings: 5200, rent2br: 1750, season: "metro", reg: "permit-required", regNote: "License required; enforcement has loosened after court rulings." },
  { name: "Houston", state: "Texas", code: "TX", lat: 29.76, lon: -95.37, adr: 138, occ: 0.56, listings: 4600, rent2br: 1400, season: "metro", reg: "permitted", regNote: "Registration ordinance took effect 2025; no zoning restrictions." },
  { name: "Galveston", state: "Texas", code: "TX", lat: 29.3, lon: -94.8, adr: 198, occ: 0.54, listings: 4300, rent2br: 1500, season: "beach", reg: "permitted", regNote: "Registration plus hotel occupancy tax; otherwise open." },
  { name: "Corpus Christi", state: "Texas", code: "TX", lat: 27.8, lon: -97.4, adr: 164, occ: 0.52, listings: 1700, rent2br: 1300, season: "beach", reg: "permit-required", regNote: "Permit zones split the island from the mainland." },
  { name: "El Paso", state: "Texas", code: "TX", lat: 31.76, lon: -106.49, adr: 105, occ: 0.55, listings: 900, rent2br: 1100, season: "metro", reg: "unverified" },
  // Tennessee
  { name: "Nashville", state: "Tennessee", code: "TN", lat: 36.16, lon: -86.78, adr: 219, occ: 0.64, listings: 6800, rent2br: 1850, season: "metro", reg: "permit-required", regNote: "Non-owner-occupied permits limited to specific zoning districts." },
  { name: "Memphis", state: "Tennessee", code: "TN", lat: 35.15, lon: -90.05, adr: 121, occ: 0.54, listings: 1400, rent2br: 1150, season: "metro", reg: "unverified" },
  { name: "Pigeon Forge", state: "Tennessee", code: "TN", lat: 35.79, lon: -83.55, adr: 231, occ: 0.6, listings: 5900, rent2br: 1500, season: "mountain", reg: "permitted", regNote: "Tourism zoning; nightly rentals are the local economy." },
  { name: "Gatlinburg", state: "Tennessee", code: "TN", lat: 35.71, lon: -83.51, adr: 248, occ: 0.59, listings: 5100, rent2br: 1550, season: "mountain", reg: "permitted", regNote: "Permitted citywide with standard registration." },
  { name: "Chattanooga", state: "Tennessee", code: "TN", lat: 35.05, lon: -85.31, adr: 152, occ: 0.6, listings: 1600, rent2br: 1400, season: "metro", reg: "permit-required", regNote: "Certificates capped outside commercial zones; waitlist active." },
  { name: "Knoxville", state: "Tennessee", code: "TN", lat: 35.96, lon: -83.92, adr: 141, occ: 0.61, listings: 1300, rent2br: 1350, season: "metro", reg: "permit-required", regNote: "Owner-occupancy required in residential zones." },
  // Arizona
  { name: "Phoenix", state: "Arizona", code: "AZ", lat: 33.45, lon: -112.07, adr: 171, occ: 0.61, listings: 5400, rent2br: 1550, season: "desert", reg: "permitted", regNote: "State law preempts city bans; registration only." },
  { name: "Scottsdale", state: "Arizona", code: "AZ", lat: 33.49, lon: -111.93, adr: 289, occ: 0.62, listings: 4700, rent2br: 2100, season: "desert", reg: "permit-required", regNote: "License, neighbor notification, and event rules enforced." },
  { name: "Mesa", state: "Arizona", code: "AZ", lat: 33.42, lon: -111.83, adr: 149, occ: 0.58, listings: 2100, rent2br: 1450, season: "desert", reg: "permitted", regNote: "State preemption applies; local registration required." },
  { name: "Tucson", state: "Arizona", code: "AZ", lat: 32.22, lon: -110.97, adr: 128, occ: 0.57, listings: 1800, rent2br: 1250, season: "desert", reg: "permitted", regNote: "Registration only; university demand steadies winters." },
  { name: "Sedona", state: "Arizona", code: "AZ", lat: 34.87, lon: -111.76, adr: 305, occ: 0.67, listings: 1900, rent2br: 2300, season: "desert", reg: "permitted", regNote: "State preemption; city tracks licenses closely." },
  // Ohio
  { name: "Columbus", state: "Ohio", code: "OH", lat: 39.96, lon: -83.0, adr: 132, occ: 0.62, listings: 1700, rent2br: 1300, season: "metro", reg: "permit-required", regNote: "Short-term rental permit and hotel tax registration required." },
  { name: "Cleveland", state: "Ohio", code: "OH", lat: 41.5, lon: -81.69, adr: 118, occ: 0.58, listings: 1200, rent2br: 1150, season: "metro", reg: "unverified" },
  { name: "Cincinnati", state: "Ohio", code: "OH", lat: 39.1, lon: -84.51, adr: 126, occ: 0.6, listings: 1300, rent2br: 1250, season: "metro", reg: "permit-required", regNote: "Registration ordinance active since 2022." },
  { name: "Dayton", state: "Ohio", code: "OH", lat: 39.76, lon: -84.19, adr: 98, occ: 0.55, listings: 500, rent2br: 950, season: "metro", reg: "unverified" },
  { name: "Akron", state: "Ohio", code: "OH", lat: 41.08, lon: -81.52, adr: 102, occ: 0.53, listings: 420, rent2br: 1000, season: "metro", reg: "unverified" },
  // Other states
  { name: "Las Vegas", state: "Nevada", code: "NV", lat: 36.17, lon: -115.14, adr: 176, occ: 0.66, listings: 3800, rent2br: 1500, season: "metro", reg: "banned", regNote: "Unincorporated Clark County licenses are lottery-limited; city rules strict." },
  { name: "Denver", state: "Colorado", code: "CO", lat: 39.74, lon: -104.99, adr: 163, occ: 0.63, listings: 2900, rent2br: 1850, season: "metro", reg: "banned", regNote: "License requires primary residence — arbitrage effectively excluded." },
  { name: "Atlanta", state: "Georgia", code: "GA", lat: 33.75, lon: -84.39, adr: 154, occ: 0.6, listings: 4200, rent2br: 1700, season: "metro", reg: "permit-required", regNote: "Two-permit cap per host; one must be primary residence." },
  { name: "Charlotte", state: "North Carolina", code: "NC", lat: 35.23, lon: -80.84, adr: 143, occ: 0.61, listings: 2200, rent2br: 1550, season: "metro", reg: "unverified" },
  { name: "Indianapolis", state: "Indiana", code: "IN", lat: 39.77, lon: -86.16, adr: 129, occ: 0.59, listings: 1600, rent2br: 1250, season: "metro", reg: "permitted", regNote: "State law protects short-term rentals; registration only." },
  { name: "Myrtle Beach", state: "South Carolina", code: "SC", lat: 33.69, lon: -78.89, adr: 187, occ: 0.56, listings: 6200, rent2br: 1450, season: "beach", reg: "permitted", regNote: "Resort zoning; nightly rentals long established." },
];

/** Default 2BR operating assumptions used for the market-level breakeven
 *  benchmark. Mirrors the calculator's starting values: rent + utilities
 *  and the host fee — cleaning is guest-paid, everything else starts at
 *  $0 until the operator adds it. */
export function benchmark2brInputs(rent2br: number) {
  return {
    monthlyRent: rent2br,
    securityDeposit: rent2br,
    furnishingBudget: 0,
    utilitiesMonthly: 210,
    internetMonthly: 0,
    cleaningCostPerTurnover: 0,
    avgStayNights: 3,
    suppliesMonthly: 0,
    insuranceMonthly: 0,
    platformFeePct: 0.03,
    mgmtFeePct: 0,
    firstMonthFree: false,
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const REG_SOURCES: Record<RegulationStatus, string> = {
  permitted: "Municipal code review",
  "permit-required": "City licensing portal",
  banned: "Zoning ordinance text",
  unverified: "Not yet reviewed",
};

function buildRegulation(seed: MarketSeed, rng: Rng): Regulation {
  const checkedDaysAgo = rng.int(20, 160);
  const note =
    seed.regNote ??
    (seed.reg === "unverified"
      ? "No verified ruling on file yet. Confirm with the city before signing."
      : "");
  return {
    status: seed.reg,
    note,
    sourceNote:
      seed.reg === "unverified"
        ? "Not yet reviewed by our research desk."
        : `${REG_SOURCES[seed.reg]}, checked ${checkedDaysAgo} days ago.`,
  };
}

function buildMonthly(seed: MarketSeed, rng: Rng): MarketMonth[] {
  const months = trailingMonths(12);
  return months.map((month) => {
    const mIdx = new Date(`${month}T00:00:00Z`).getUTCMonth();
    const shape = SEASON[seed.season][mIdx];
    // ADR moves with season at about half strength; occupancy at full.
    const adr = roundTo(seed.adr * (1 + (shape - 1) * 0.55) * rng.float(0.97, 1.03), 1);
    const occupancy = clamp(
      seed.occ * shape * rng.float(0.96, 1.04),
      0.34,
      0.86
    );
    return { month, adr, occupancy: Math.round(occupancy * 1000) / 1000 };
  });
}

/** ADR multipliers by bedroom count relative to the 2BR benchmark. */
export const BR_MULT: Record<number, number> = { 1: 0.72, 2: 1, 3: 1.31, 4: 1.62, 5: 1.94 };

/** Long-term rent multipliers by bedroom count relative to the 2BR median. */
export const RENT_MULT: Record<number, number> = { 1: 0.78, 2: 1, 3: 1.28, 4: 1.52, 5: 1.75 };

function buildBedroomAdr(seed: MarketSeed, rng: Rng): BedroomAdr[] {
  const shares = [0.24, 0.34, 0.24, 0.13, 0.05];
  return [1, 2, 3, 4, 5].map((br, idx) => ({
    bedrooms: br,
    adr: roundTo(seed.adr * BR_MULT[br] * rng.float(0.96, 1.04), 1),
    listings: Math.max(10, Math.round(seed.listings * shares[idx] * rng.float(0.85, 1.15))),
  }));
}

const TERRAIN_BY_SEASON: Record<SeasonType, MarketTerrain> = {
  beach: "coastal",
  mountain: "mountain",
  desert: "desert",
  metro: "metro",
};

function buildMarket(seed: MarketSeed, rng: Rng): Market {
  const monthly = buildMonthly(seed, rng);
  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];

  // The market-level breakeven benchmark, straight from the calc engine.
  const avgBreakeven2br = breakevenOccupancy(benchmark2brInputs(seed.rent2br), {
    adr: seed.adr,
    marketOccupancy: seed.occ,
  });

  return {
    slug: seed.slug ?? slugify(seed.name),
    name: seed.name,
    state: seed.state,
    stateCode: seed.code,
    terrain: TERRAIN_BY_SEASON[seed.season],
    lat: seed.lat,
    lon: seed.lon,
    adr: seed.adr,
    occupancy: seed.occ,
    activeListings: seed.listings,
    medianRent2br: seed.rent2br,
    // Whole-point precision so every screen that shows this figure, or a
    // margin derived from it, rounds identically and can never disagree.
    avgBreakeven2br: Math.round(avgBreakeven2br * 100) / 100,
    regulation: buildRegulation(seed, rng),
    monthly,
    adrByBedroom: buildBedroomAdr(seed, rng),
    deltas: {
      adr: Math.round(((last.adr - prev.adr) / prev.adr) * 1000) / 1000,
      occupancy: Math.round((last.occupancy - prev.occupancy) * 1000) / 1000,
      listings: Math.round(rng.float(-0.04, 0.06) * 1000) / 1000,
    },
  };
}

const rng = new Rng(0xa11ce);

/** The 40 hand-authored flagship markets (stable RNG stream — do not
 *  reorder or the seeded world shifts). */
const FLAGSHIPS: Market[] = SEEDS.map((seed) => buildMarket(seed, rng));

/* ------------------------------------------------------------------ */
/* Expansion to full coverage                                          */
/* ------------------------------------------------------------------ */

/** Value bands per market kind. Occupancy and ADR stay inside the
 *  product-wide bands (45–72%, $95–$310). */
const KIND_CONFIG: Record<
  MarketKind,
  {
    adr: [number, number];
    occ: [number, number];
    listings: [number, number];
    rent: [number, number];
    season: SeasonType;
  }
> = {
  metro: { adr: [120, 195], occ: [0.55, 0.67], listings: [2400, 9000], rent: [1250, 2200], season: "metro" },
  mid: { adr: [105, 165], occ: [0.51, 0.63], listings: [700, 3200], rent: [1000, 1650], season: "metro" },
  small: { adr: [95, 145], occ: [0.45, 0.58], listings: [150, 950], rent: [850, 1350], season: "metro" },
  beach: { adr: [155, 305], occ: [0.5, 0.66], listings: [800, 7000], rent: [1300, 2300], season: "beach" },
  mountain: { adr: [150, 310], occ: [0.5, 0.66], listings: [400, 6000], rent: [1200, 2100], season: "mountain" },
  lake: { adr: [135, 260], occ: [0.46, 0.6], listings: [250, 3500], rent: [1050, 1800], season: "beach" },
  desert: { adr: [130, 300], occ: [0.52, 0.67], listings: [500, 5200], rent: [1200, 2200], season: "desert" },
};

/** Each expansion market seeds its own RNG from its identity, so adding
 *  or reordering seeds never shifts anyone else's numbers. */
const EXPANSION: Market[] = EXPANSION_SEEDS.map((e) => {
  const marketRng = new Rng(hashStr(`${e.name}|${e.code}`));
  const cfg = KIND_CONFIG[e.kind];
  const seed: MarketSeed = {
    name: e.name,
    state: e.state,
    code: e.code,
    slug: e.slug,
    lat: e.lat,
    lon: e.lon,
    adr: clamp(roundTo(marketRng.float(...cfg.adr), 1), 95, 310),
    occ: clamp(Math.round(marketRng.float(...cfg.occ) * 100) / 100, 0.45, 0.72),
    listings: Math.max(120, roundTo(marketRng.float(...cfg.listings), 10)),
    rent2br: roundTo(marketRng.float(...cfg.rent), 25),
    season: cfg.season,
    reg: "unverified",
  };
  return buildMarket(seed, marketRng);
});

export const MARKETS: Market[] = [...FLAGSHIPS, ...EXPANSION];

export const MARKET_BY_SLUG: Map<string, Market> = new Map(
  MARKETS.map((m) => [m.slug, m])
);
