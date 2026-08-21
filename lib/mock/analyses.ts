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
import { BR_MULT, MARKETS, RENT_MULT } from "./markets";
import { clamp, daysAgo, Rng, roundTo } from "./seed";
import type { Analysis, LtrComp, PropertyType, StrComp } from "./types";

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
  analysisIdx: number,
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
  analysisIdx: number,
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

function buildDefaults(ltrComps: LtrComp[], bedrooms: number, rng: Rng): DealInputs {
  const monthlyRent = estimateRentFromComps(ltrComps);
  return {
    monthlyRent,
    securityDeposit: monthlyRent,
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
    platformFeePct: 0.03,
    mgmtFeePct: 0,
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
