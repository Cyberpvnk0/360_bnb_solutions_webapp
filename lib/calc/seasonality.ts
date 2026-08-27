/**
 * A deal, month by month.
 *
 * The rest of this engine works in annual averages, and an average
 * hides the thing that actually sinks an arbitrage deal. A property can
 * clear its costs comfortably over twelve months and still lose money
 * for four of them in a row — and the lease is due monthly, in cash,
 * whether or not September cooperated. "Breaks even at 41% against a
 * market at 45%" reads as a margin. It is a margin on the year. It says
 * nothing about whether the student can carry the autumn.
 *
 * The weights come from the feed: twelve fractions of annual revenue,
 * for the actual address, summing to one.
 *
 * ONE ASSUMPTION, STATED PLAINLY: the season is applied to occupancy,
 * not to nightly rate. Both move in reality, and revenue weights alone
 * cannot say how the lift divides between them. Occupancy is the
 * choice because breakeven is expressed in occupancy — the number this
 * whole product turns on — so a seasonal reading in the same unit can
 * be compared against it directly. Where that pushes a peak month past
 * a full calendar it is capped, and `capped` says so rather than
 * quietly swallowing the difference.
 */

import {
  grossRevenue,
  netCashFlow,
  type DealInputs,
  type MarketAssumptions,
} from "@/lib/calc/arbitrage";

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export interface MonthOutlook {
  /** 0 = January. */
  month: number;
  label: string;
  /** This month's share of the year's revenue. */
  weight: number;
  /** Share against an even twelfth: 1.0 is an average month, 1.28 is a
   *  peak, 0.79 a trough. The number worth showing. */
  index: number;
  occupancy: number;
  /**
   * Gross booking revenue for the month — nightly takings plus cleaning
   * fees collected. Shown beside net because the two answer different
   * questions and the gap between them IS the cost of operating: a
   * strong revenue month can still be a losing one.
   */
  revenue: number;
  /** Net cash flow for the month, at that occupancy. */
  net: number;
  /** True when the season would have pushed occupancy past 100% and it
   *  was capped — the month's real upside is higher than shown. */
  capped: boolean;
}

/**
 * Whether a set of weights can be believed.
 *
 * Twelve finite, non-negative numbers that sum to roughly one. A feed
 * that returns eleven months, or percentages, or nulls, gets rejected
 * here rather than drawn as a chart that looks authoritative.
 */
export function usableWeights(weights: unknown): number[] | null {
  if (!Array.isArray(weights) || weights.length !== 12) return null;
  const nums = weights.filter(
    (w): w is number => typeof w === "number" && Number.isFinite(w) && w >= 0
  );
  if (nums.length !== 12) return null;
  const total = nums.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  // Tolerate rounding, reject a different unit entirely.
  if (Math.abs(total - 1) > 0.02) return null;
  return nums;
}

export function monthlyOutlook(
  inputs: DealInputs,
  assumptions: MarketAssumptions,
  weights: number[]
): MonthOutlook[] | null {
  const usable = usableWeights(weights);
  if (!usable) return null;

  return usable.map((weight, month) => {
    const index = weight * 12;
    const raw = assumptions.marketOccupancy * index;
    const occupancy = Math.min(1, raw);
    return {
      month,
      label: MONTH_LABELS[month],
      weight,
      index: Math.round(index * 100) / 100,
      occupancy: Math.round(occupancy * 1000) / 1000,
      revenue: Math.round(grossRevenue(inputs, assumptions, occupancy)),
      net: Math.round(netCashFlow(inputs, assumptions, occupancy)),
      capped: raw > 1,
    };
  });
}

export interface SeasonalRisk {
  /** Months whose cash flow is negative. */
  negativeMonths: number;
  /** The longest unbroken run of them — the figure that decides how
   *  much cash a student needs to hold, since consecutive losses
   *  compound where scattered ones can be absorbed. */
  longestNegativeRun: number;
  /** Total shortfall across the negative months, as a positive number:
   *  what the year costs out of pocket before the good months repay it. */
  worstCaseDrawdown: number;
  weakest: MonthOutlook;
  strongest: MonthOutlook;
  /** Gross revenue across the year, for the headline beside the strip. */
  annualRevenue: number;
  /** Net across the year — what the deal actually returns. */
  annualNet: number;
}

export function seasonalRisk(months: MonthOutlook[]): SeasonalRisk | null {
  if (months.length === 0) return null;

  let run = 0;
  let longest = 0;
  // Twice around, because a loss-making stretch can straddle December
  // into January and a single pass would report two short runs where
  // the calendar has one long one.
  for (const m of [...months, ...months]) {
    run = m.net < 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  return {
    negativeMonths: months.filter((m) => m.net < 0).length,
    longestNegativeRun: Math.min(12, longest),
    worstCaseDrawdown: Math.abs(
      months.filter((m) => m.net < 0).reduce((a, m) => a + m.net, 0)
    ),
    weakest: months.reduce((a, b) => (b.net < a.net ? b : a)),
    strongest: months.reduce((a, b) => (b.net > a.net ? b : a)),
    annualRevenue: Math.round(months.reduce((a, m) => a + m.revenue, 0)),
    annualNet: Math.round(months.reduce((a, m) => a + m.net, 0)),
  };
}
