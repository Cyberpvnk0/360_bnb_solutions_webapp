/**
 * What a backfill run will cost, and how much of it the budget covers.
 *
 * Small enough to inline in the route and kept out of it anyway: this
 * is the arithmetic that decides how money gets spent, and the last
 * time it lived inline it was a constant `CALLS_PER_MARKET = 3` that
 * stayed 3 no matter what the run actually did.
 */

/** Their measured price. Published as a cent; billed as eighteen. */
export const DOLLARS_PER_CALL = 0.18;

export interface BackfillShape {
  /** "lookup" buys the feed's ZIP for a coordinate; "catalogue" builds
   *  the market object from our own city and state for nothing. */
  identity: "lookup" | "catalogue";
  /** The twelve-month series, which only the seasonality chart reads. */
  history: boolean;
}

/** Billed calls one market costs under this shape. Never below one:
 *  the summary is the whole point and is always fetched. */
export function callsPerMarket(shape: BackfillShape): number {
  return 1 + (shape.identity === "lookup" ? 1 : 0) + (shape.history ? 1 : 0);
}

export function money(calls: number): string {
  return `$${(calls * DOLLARS_PER_CALL).toFixed(2)}`;
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
