/**
 * What a backfill run will cost, and how much of it the budget covers.
 *
 * Small enough to inline in the route and kept out of it anyway: this
 * is the arithmetic that decides how money gets spent, and the last
 * time it lived inline it was a constant `CALLS_PER_MARKET = 3` that
 * stayed 3 no matter what the run actually did.
 */

/**
 * What each call in a backfill actually costs, from the vendor's own
 * published per-endpoint table.
 *
 * NOT ONE RATE. This module priced every call at a flat $0.18 for as
 * long as that was the only figure anybody had, and the real table is
 * nothing like flat: the coordinate lookup is a cent, a summary is ten,
 * and the all-metrics endpoint is fifty — which is why the history is
 * bought as two single-metric calls instead (see fetchMarketMonths).
 * A flat rate here overstated a cheap run by nearly double and would
 * have understated an expensive one.
 */
export const PRICES = {
  /** /markets/lookup — a coordinate to the feed's own market. */
  lookup: 0.01,
  /** /markets/summary — the headline figures. Always fetched. */
  summary: 0.1,
  /** One month series: /markets/metrics/occupancy or …/average-daily-rate. */
  month: 0.1,
} as const;

export interface BackfillShape {
  /** "lookup" buys the feed's ZIP for a coordinate; "catalogue" builds
   *  the market object from our own city and state for nothing. */
  identity: "lookup" | "catalogue";
  /** The twelve-month series, which only the seasonality chart reads. */
  history: boolean;
}

/**
 * Billed calls one market costs under this shape. Never below one: the
 * summary is the whole point and is always fetched.
 *
 * The history is TWO calls, not one — occupancy and rate, bought
 * separately because the endpoint that answers both at once costs more
 * than the pair and throws in figures nothing displays.
 */
export function callsPerMarket(shape: BackfillShape): number {
  return (
    1 + (shape.identity === "lookup" ? 1 : 0) + (shape.history ? 2 : 0)
  );
}

/** What one market costs under this shape, in dollars. */
export function dollarsPerMarket(shape: BackfillShape): number {
  return (
    PRICES.summary +
    (shape.identity === "lookup" ? PRICES.lookup : 0) +
    (shape.history ? PRICES.month * 2 : 0)
  );
}

/**
 * The average price of one call in a run of this shape.
 *
 * For the call METER, which counts calls without knowing which endpoint
 * each was. Every call in a given run follows the same shape, so the
 * average is the right conversion — and it is an average, which is why
 * it is named as one rather than dressed up as a per-call price.
 */
export function dollarsPerCall(shape: BackfillShape): number {
  return dollarsPerMarket(shape) / callsPerMarket(shape);
}

/** Dollars, as a reader says them. */
export function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/**
 * How many markets to actually attempt.
 *
 * Never start a market the budget cannot finish. Without the clamp a
 * run walks the queue until the cap trips and then spends its remaining
 * markets throwing budget errors — every one counted as a fetch
 * failure, none of them a real one, and the report unreadable.
 */
export function batchSize(opts: {
  asked: number;
  pending: number;
  budgetLeft: number;
  perMarket: number;
}): number {
  const affordable = Math.floor(opts.budgetLeft / Math.max(1, opts.perMarket));
  return Math.max(0, Math.min(opts.asked, opts.pending, affordable));
}
