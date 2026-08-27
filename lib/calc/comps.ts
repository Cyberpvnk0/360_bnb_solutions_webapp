/**
 * Deriving projection assumptions from comparable listings.
 *
 * The revenue projection shown anywhere in the product is ALWAYS computed
 * from the comp set displayed beside it, through these functions. Nothing
 * stores a separate "projected ADR" — so the projection can never
 * contradict its evidence.
 */

export interface StrCompLike {
  adr: number;
  occupancy: number;
  /** What the listing actually earned over twelve months, when the feed
   *  reports it. Absent on seeded comps. */
  annualRevenue?: number;
}

export interface LtrCompLike {
  rent: number;
}

/** Arithmetic mean, rounded to whole dollars. */
function meanDollars(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * ADR assumption = mean of comp ADRs, whole dollars.
 * Occupancy assumption = mean of comp occupancies, rounded to whole points
 * so the displayed figure and the math agree exactly.
 */
export function deriveMarketAssumptions(comps: StrCompLike[]): {
  adr: number;
  marketOccupancy: number;
} {
  if (comps.length === 0) return { adr: 0, marketOccupancy: 0 };
  const adr = meanDollars(comps.map((c) => c.adr));
  const occMean =
    comps.reduce((a, c) => a + c.occupancy, 0) / comps.length;
  const marketOccupancy = Math.round(occMean * 100) / 100;
  return { adr, marketOccupancy };
}

/**
 * Comp set strength: how much to trust the projection, 1 (thin) to 5
 * (high). More comps and tighter ADR agreement mean a stronger read.
 * Purely descriptive — never a deal grade.
 */
export function compSetStrength(comps: StrCompLike[]): {
  score: 1 | 2 | 3 | 4 | 5;
  label: "Thin" | "Fair" | "Good" | "High";
} {
  const n = comps.length;
  if (n === 0) return { score: 1, label: "Thin" };
  const mean = comps.reduce((a, c) => a + c.adr, 0) / n;
  const variance =
    comps.reduce((a, c) => a + (c.adr - mean) ** 2, 0) / n;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;

  let score = 2;
  if (n >= 8) score += 1;
  if (n >= 10) score += 1;
  if (cv < 0.12) score += 1;
  else if (cv > 0.2) score -= 1;
  const clamped = Math.min(5, Math.max(1, score)) as 1 | 2 | 3 | 4 | 5;
  const label =
    clamped >= 5 ? "High" : clamped === 4 ? "Good" : clamped === 3 ? "Fair" : "Thin";
  return { score: clamped, label };
}

/**
 * Lease estimate = median rent of long-term comps, rounded to $25.
 * Median (not mean) so one outlier listing can't skew the lease you
 * negotiate against.
 */
export function estimateRentFromComps(comps: LtrCompLike[]): number {
  if (comps.length === 0) return 0;
  const rents = comps.map((c) => c.rent).sort((a, b) => a - b);
  const mid = Math.floor(rents.length / 2);
  const median =
    rents.length % 2 === 1 ? rents[mid] : (rents[mid - 1] + rents[mid]) / 2;
  return Math.round(median / 25) * 25;
}

/* ------------------------------------------------------------------ */
/* Revenue distribution                                                */
/* ------------------------------------------------------------------ */

/** Nights in a year, matching annualRevenueFromAdr. */
const NIGHTS_PER_YEAR = 365;

/**
 * The comp set's annual revenues, and on what basis.
 *
 * Two bases exist and they are NOT interchangeable. A measured figure
 * is what a listing actually earned. A modelled one is rate times
 * occupancy times 365, which is the same arithmetic the projection
 * uses. Measured is the better evidence — it captures a real calendar,
 * where rate and occupancy move together across a season, instead of
 * multiplying two averages and hoping.
 *
 * All or nothing, deliberately. Mixing measured and modelled values in
 * one distribution builds a histogram out of two different quantities
 * and shows it as one, which reads as a spread in outcomes when part of
 * it is a spread in methodology. Live comps all carry a measured
 * figure; seeded ones carry none; so in practice this is a clean
 * switch rather than a compromise.
 */
export function revenueBasis(comps: StrCompLike[]): {
  values: number[];
  basis: "measured" | "modelled";
} {
  const measured = comps
    .map((c) => c.annualRevenue)
    .filter((r): r is number => typeof r === "number" && r > 0);

  if (measured.length === comps.length && comps.length > 0) {
    return { values: measured, basis: "measured" };
  }
  return {
    values: comps.map((c) => Math.round(c.adr * c.occupancy * NIGHTS_PER_YEAR)),
    basis: "modelled",
  };
}

/**
 * Where a projection sits in the comp set, as quartiles.
 *
 * The single number a projection produces hides the thing that decides
 * whether a deal works: the same address earns wildly different money
 * depending on who runs it. One live pull showed comps from about
 * five thousand to forty-seven on the same two-bedroom search. A band
 * says that out loud; a point estimate lets a student read one number
 * and plan around it.
 *
 * Linear interpolation between the two nearest ranks — the textbook
 * definition, and stable on the small sets a comp search returns.
 */
export function revenueQuartiles(values: number[]): {
  p25: number;
  p50: number;
  p75: number;
  min: number;
  max: number;
} | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return Math.round(
      lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
    );
  };
  return {
    p25: at(0.25),
    p50: at(0.5),
    p75: at(0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}
