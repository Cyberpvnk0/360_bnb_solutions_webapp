/**
 * Address pulls (analyses) with their comp evidence.
 *
 * Consistency guarantees:
 * - The revenue projection's ADR/occupancy assumptions are derived from the
 *   STR comp list via lib/calc/comps — the same list rendered in the UI.
 * - The calculator's default rent is the median of the LTR comp list via
 *   lib/calc/comps — the same list rendered in the UI.
 * There is no stored projection anywhere; only inputs and evidence.
 */

import type { DealInputs } from "@/lib/calc/arbitrage";
import { estimateRentFromComps } from "@/lib/calc/comps";
import { BR_MULT, MARKET_BY_SLUG, MARKETS, RENT_MULT } from "./markets";
import { clamp, daysAgo, hashStr, MOCK_TODAY, Rng, roundTo } from "./seed";
import type {
  Analysis,
  LtrComp,
  Market,
  PropertyType,
  RentalListing,
  StrComp,
} from "./types";

const STREETS = [
  "Maple", "Oakwood", "Cypress", "Palmetto", "Juniper", "Cedar Ridge",
  "Willow", "Sycamore", "Magnolia", "Dogwood", "Bluebonnet", "Saguaro",
  "Chestnut", "Lakeview", "Sunset", "Highland", "Prairie", "Canyon",
  "Bayshore", "Harborview", "Foxglove", "Ironwood", "Meadowbrook", "Stonegate",
];
const STREET_TYPES = ["St", "Ave", "Ln", "Dr", "Ct", "Way", "Blvd"];

const COMP_ADJ = [
  "Sunlit", "Modern", "Updated", "Quiet", "Bright", "Stylish", "Renovated",
  "Comfortable", "Spacious", "Designer", "Restored", "Polished",
];
const COMP_PLACE = [
  "near Downtown", "by the Convention Center", "in the Arts District",
  "near the Historic District", "by the Riverfront", "near the University",
  "close to Main Street", "by the Medical Center", "on the Greenway",
  "near the Stadium", "in Midtown", "by the Old Town square",
];

const LTR_STATUS = [
  "Active listing",
  "Leased 12 days ago",
  "Leased 34 days ago",
  "Active listing",
  "Pending application",
  "Active listing",
];

const PROPERTY_TYPES: PropertyType[] = ["apartment", "house", "condo", "townhome"];

function bathsFor(bedrooms: number, rng: Rng): number {
  if (bedrooms <= 1) return 1;
  if (bedrooms === 2) return rng.chance(0.5) ? 2 : 1;
  if (bedrooms === 3) return 2;
  return rng.chance(0.5) ? 3 : 2.5;
}

function buildStrComps(
  marketAdr: number,
  marketOcc: number,
  bedrooms: number,
  analysisIdx: number | string,
  rng: Rng
): StrComp[] {
  const count = rng.int(8, 10);
  const baseAdr = marketAdr * BR_MULT[bedrooms];
  const comps: StrComp[] = [];
  for (let c = 0; c < count; c++) {
    const adr = roundTo(rng.jitter(baseAdr, 0.14), 1);
    const occupancy =
      Math.round(clamp(rng.jitter(marketOcc, 0.1), 0.4, 0.8) * 100) / 100;
    comps.push({
      id: `sc-${analysisIdx}-${c}`,
      name: `${rng.pick(COMP_ADJ)} ${bedrooms}BR ${rng.pick(COMP_PLACE)}`,
      bedrooms,
      bathrooms: bathsFor(bedrooms, rng),
      adr,
      occupancy,
      distanceMiles: Math.round(rng.float(0.3, 4.5) * 10) / 10,
    });
  }
  return comps;
}

function buildLtrComps(
  medianRent2br: number,
  bedrooms: number,
  city: string,
  stateCode: string,
  analysisIdx: number | string,
  rng: Rng
): LtrComp[] {
  const baseRent = medianRent2br * RENT_MULT[bedrooms];
  const comps: LtrComp[] = [];
  for (let c = 0; c < 6; c++) {
    comps.push({
      id: `lc-${analysisIdx}-${c}`,
      address: `${rng.int(100, 9800)} ${rng.pick(STREETS)} ${rng.pick(STREET_TYPES)}, ${city}, ${stateCode}`,
      bedrooms,
      bathrooms: bathsFor(bedrooms, rng),
      rent: roundTo(rng.jitter(baseRent, 0.1), 5),
      sqft: roundTo(bedrooms * 430 + 280 * rng.float(0.85, 1.25), 10),
      distanceMiles: Math.round(rng.float(0.2, 3.8) * 10) / 10,
      status: LTR_STATUS[c % LTR_STATUS.length],
    });
  }
  return comps;
}

/**
 * The calculator's starting values.
 *
 * `askingRent` IS THE PROPERTY'S OWN RENT, and it wins outright when
 * there is one. The comp median is an estimate of what a place like
 * this leases for; the asking rent is what THIS lease costs, and every
 * figure on the page — cushion, cash flow, breakeven — is computed off
 * it. Starting a real listing's analysis from a modelled median put a
 * number on screen that disagreed with the card the person had just
 * clicked, in the one field they came to the page to reason about.
 *
 * The median is the fallback, not the default: a typed address has no
 * listing behind it and genuinely has to be estimated. Callers must say
 * which of the two they got — see AnalyzeResult's rentSource.
 */
function buildDefaults(
  ltrComps: LtrComp[],
  bedrooms: number,
  rng: Rng,
  askingRent?: number
): DealInputs {
  const monthlyRent =
    askingRent !== undefined && Number.isFinite(askingRent) && askingRent > 0
      ? Math.round(askingRent)
      : estimateRentFromComps(ltrComps);
  return {
    monthlyRent,
    // Operators negotiate these away routinely, so the calculator starts
    // where a well-negotiated deal starts — add them back when a landlord
    // insists.
    securityDeposit: 0,
    // Product stance: the guest's cleaning fee pays the cleaner, so
    // cleaning nets out of the P&L and has no input. Furnishing and every
    // advanced cost start at $0 — operators add what applies to them.
    furnishingBudget: 0,
    utilitiesMonthly: roundTo(160 + 40 * bedrooms * rng.float(0.9, 1.15), 10),
    internetMonthly: 0,
    cleaningCostPerTurnover: 0,
    avgStayNights: 3,
    suppliesMonthly: 0,
    insuranceMonthly: 0,
    platformFeePct: 0.15,
    mgmtFeePct: 0,
    firstMonthFree: true,
  };
}

const rng = new Rng(0xbee5);

/**
 * 30 pre-generated analyses. The first 25 back the pipeline's saved deals;
 * the rest appear as recent pull history. `ANALYSES[0]` is also the demo
 * result the /analyze flow lands on.
 */
/** The last four analyses are the "recent pulls" the activity feed cites,
 *  so their creation dates must match the feed's timestamps exactly. */
const RECENT_PULL_DAYS: Record<number, number> = { 26: 6, 27: 0, 28: 1, 29: 3 };

export const ANALYSES: Analysis[] = Array.from({ length: 30 }, (_, i) => {
  // Rotate through markets with a bias toward the first (hotter) states.
  const market = MARKETS[(i * 7 + rng.int(0, 4)) % MARKETS.length];
  const bedrooms = rng.pick([1, 2, 2, 2, 3, 3, 4]);
  const created =
    i in RECENT_PULL_DAYS ? daysAgo(RECENT_PULL_DAYS[i]) : daysAgo(rng.int(7, 110));
  const strComps = buildStrComps(market.adr, market.occupancy, bedrooms, i, rng);
  const ltrComps = buildLtrComps(
    market.medianRent2br,
    bedrooms,
    market.name,
    market.stateCode,
    i,
    rng
  );
  return {
    id: `a-${String(i + 1).padStart(2, "0")}`,
    address: `${rng.int(100, 9800)} ${rng.pick(STREETS)} ${rng.pick(STREET_TYPES)}`,
    city: market.name,
    stateCode: market.stateCode,
    marketSlug: market.slug,
    bedrooms,
    bathrooms: bathsFor(bedrooms, rng),
    propertyType: rng.pick(PROPERTY_TYPES),
    createdAt: created,
    strComps,
    ltrComps,
    defaults: buildDefaults(ltrComps, bedrooms, rng),
  };
});

export const ANALYSIS_BY_ID: Map<string, Analysis> = new Map(
  ANALYSES.map((a) => [a.id, a])
);

/** Address suggestions for the mocked autocomplete on /analyze.
 *  Each suggestion resolves to a pre-generated analysis. */
export const ADDRESS_SUGGESTIONS: {
  analysisId: string;
  label: string;
  city: string;
  stateCode: string;
}[] = ANALYSES.map((a) => ({
  analysisId: a.id,
  label: `${a.address}, ${a.city}, ${a.stateCode}`,
  city: a.city,
  stateCode: a.stateCode,
}));

/* ------------------------------------------------------------------ */
/* Lazy analyses for Deal Finder listings                              */
/* ------------------------------------------------------------------ */

const LISTING_ANALYSES = new Map<string, Analysis>();

/**
 * The full Analysis behind a Deal Finder listing, built on demand and
 * memoized per `listing.analysisId`. Seeded from that id alone (its own
 * Rng — the shared sequential stream above never moves), so the result
 * is identical no matter which screen asks first. Address, unit details
 * and market come straight from the listing; the comp evidence and the
 * calculator defaults follow the exact same construction — and the same
 * internal consistency — as the 30 seeded pulls.
 */
export function analysisForListing(listing: RentalListing): Analysis {
  const hit = LISTING_ANALYSES.get(listing.analysisId);
  if (hit) return hit;

  const market = MARKET_BY_SLUG.get(listing.marketSlug);
  if (!market) {
    throw new Error(`Unknown market for listing: ${listing.marketSlug}`);
  }

  const rng = new Rng(hashStr(listing.analysisId));
  const strComps = buildStrComps(
    market.adr,
    market.occupancy,
    listing.bedrooms,
    listing.analysisId,
    rng
  );
  const ltrComps = buildLtrComps(
    market.medianRent2br,
    listing.bedrooms,
    market.name,
    market.stateCode,
    listing.analysisId,
    rng
  );
  const analysis: Analysis = {
    id: listing.analysisId,
    address: listing.address,
    city: listing.city,
    stateCode: listing.stateCode,
    marketSlug: listing.marketSlug,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    propertyType: listing.propertyType,
    createdAt: MOCK_TODAY,
    strComps,
    ltrComps,
    // The listing's asking rent, not a median of places like it. The
    // row on the card and the number in the calculator are then the
    // same figure, which is the only way they can agree.
    defaults: buildDefaults(ltrComps, listing.bedrooms, rng, listing.rentMonthly),
  };
  LISTING_ANALYSES.set(listing.analysisId, analysis);
  return analysis;
}

/* ------------------------------------------------------------------ */
/* Reusable builders for a searched address                            */
/* ------------------------------------------------------------------ */

/**
 * Lease comps and calculator defaults for a property that is not in the
 * seeded set.
 *
 * Thin wrappers, exported rather than reimplemented, so a searched
 * address starts from exactly the same assumptions as a saved deal. A
 * second copy of buildDefaults would drift, and the drift would show up
 * as two different answers for one property depending on how the user
 * arrived at it.
 *
 * Long-term comps stay seeded for now: the rental feed answers "what is
 * listed in this market", not "what would this specific unit lease
 * for", and the calculator's rent field is the first thing an operator
 * overrides anyway.
 */
export function buildLtrCompsFor(
  market: Market,
  bedrooms: number,
  seed: string
): LtrComp[] {
  return buildLtrComps(
    market.medianRent2br,
    bedrooms,
    market.name,
    market.stateCode,
    seed,
    new Rng(hashStr(seed))
  );
}

export function buildDefaultsFor(
  ltrComps: LtrComp[],
  bedrooms: number,
  seed: string,
  /** The property's own asking rent, when a listing supplied one. */
  askingRent?: number
): DealInputs {
  return buildDefaults(ltrComps, bedrooms, new Rng(hashStr(seed)), askingRent);
}

/**
 * Modelled short-term comps for a market, when the live feed gave none.
 *
 * The fallback of last resort for a searched address. Without it a
 * failed lookup leaves an empty comp set, and every derived figure on
 * the page divides by zero — the analyzer renders as a row of dashes
 * for a property that may be perfectly good.
 *
 * The caller MUST label these. They describe the market, not the
 * address, and a modelled comp shown with the confidence of a measured
 * one is the single most expensive mistake this product could make.
 */
export function buildStrCompsFor(
  market: Market,
  bedrooms: number,
  seed: string
): StrComp[] {
  return buildStrComps(
    market.adr,
    market.occupancy,
    bedrooms,
    seed,
    new Rng(hashStr(seed))
  );
}
