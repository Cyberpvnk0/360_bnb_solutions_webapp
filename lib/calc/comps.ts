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
