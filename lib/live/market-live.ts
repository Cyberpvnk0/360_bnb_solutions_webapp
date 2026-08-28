/**
 * A market's real numbers, on demand.
 *
 * Every ADR, occupancy and RevPAR in the seeded catalogue is invented —
 * deterministic from a `kind`, plausible, and entirely made up. That was
 * honest while no live source existed. One does, and this fetches it.
 *
 * COST IS THE WHOLE DESIGN. At the measured price of $0.18 a call, the
 * three-call version of this — identity, summary, history — is $0.54 a
 * market, and $221 for the catalogue. So nothing is pre-fetched: a
 * market costs money the first time someone opens it and not before,
 * and the answer is kept in the durable store for as long as the TTL
 * allows. A market nobody visits costs nothing, forever.
 *
 * Two of those three calls are now optional, because a deliberate
 * backfill wants a different trade than a page load does:
 *
 *   identity  — /markets/lookup turns a coordinate into the feed's own
 *               {country, region, locality, district}. Our catalogue
 *               already knows the city and state, so the same object can
 *               be built for nothing. Different answer, though: the
 *               lookup resolves to a ZIP and the catalogue to a whole
 *               city, so the figures are not interchangeable and the
 *               choice is the caller's to make out loud.
 *   history   — the twelve-month series. Only the seasonality chart
 *               reads it, and that chart already has a labelled seeded
 *               fallback, so a run that just wants headline figures for
 *               a lot of markets can skip it and pay two thirds.
 *
 * Falls back silently to the seeded figures whenever the feed is
 * missing, capped, unreachable or incomplete. The caller says which it
 * got; the two are never blended, because a card showing a real ADR
 * against an invented occupancy is worse than one showing neither.
 */

import {
  airRoiBudget,
  fetchMarketIdentity,
  fetchMarketMetrics,
  fetchMarketSummary,
  hasAirRoiKey,
  type LiveMarketMonth,
  type MarketSummary,
} from "@/lib/live/airroi";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import type { Market } from "@/lib/mock/types";

/** The feed's address for an area, in the shape its POST bodies want. */
export interface MarketRef {
  country?: string;
  region?: string;
  locality?: string;
  district?: string;
}

export interface LiveMarket {
  summary: MarketSummary;
  /** Twelve months of history — empty when the call failed or was not
   *  asked for, which is survivable: the headline figures still stand
   *  and the charts fall back to the seeded series. */
  monthly: LiveMarketMonth[];
  /** What the feed calls this place. From the lookup where one was
   *  paid for, otherwise from the summary response if it echoes a name.
   *  Never our own label dressed up as theirs. */
  fullName: string | null;
  /** How the market was addressed, so a stored row can say whether its
   *  figures are ZIP-wide or city-wide. */
  ref: MarketRef;
  /** Billed calls this actually made, successes and failures alike. */
  calls: number;
  asOf: string;
}

export interface LiveMarketOptions {
  /**
   * Where the feed's market identifier comes from.
   *
   * "lookup" pays for /markets/lookup and gets the ZIP the coordinate
   * falls in. "catalogue" builds {country, region, locality} from our
   * own city and state for nothing, and gets the whole city.
   */
  identity?: "lookup" | "catalogue";
  /** Fetch the twelve-month series. Costs a call. */
  history?: boolean;
  /**
   * Skip the daily distinct-area ledger.
   *
   * That ledger rations what STUDENTS search in a day. A backfill is
   * bounded by its own secret, its own batch limit and the call budget,
   * and letting it spend the search quota too means one admin run
   * locks students out of live searches for the rest of the day.
   */
  ignoreSearchQuota?: boolean;
}

/**
 * A summary is only usable if it carries the two figures every screen
 * reads. A partial one would leave a card mixing a live rate with a
 * seeded occupancy, which reads as one measurement and is two.
 */
function complete(s: MarketSummary | null | undefined): s is MarketSummary {
  return !!s && s.adr !== null && s.adr > 0 && s.occupancy !== null;
}

/**
 * The feed's address for a market, from our own catalogue.
 *
 * `state` is the full name ("Florida", not "FL") and `name` is the city,
 * which is exactly the region/locality pair their market object wants.
 * No district: that is the ZIP, we do not have one, and leaving it out
 * is what widens the answer from a ZIP to the city.
 */
export function catalogueRef(market: Market): MarketRef {
  return {
    country: "United States",
    region: market.state,
    locality: market.name,
  };
}

export async function fetchLiveMarket(
  market: Market,
  opts: LiveMarketOptions = {}
): Promise<LiveMarket | null> {
  if (!hasAirRoiKey()) return null;

  const { identity = "lookup", history = true, ignoreSearchQuota = false } = opts;

  // One slot for the whole market: the lookup exists only to address
  // the summary, so charging the budget twice for one answer would make
  // the cap mean something different here than everywhere else.
  const key = `market:${market.slug}`;
  if (!ignoreSearchQuota && !checkLiveSearch(key).allowed) return null;

  // Counted from the meter rather than assumed from the plan, so a run
  // cut short by the budget reports what it spent and not what it
  // intended to spend.
  const before = airRoiBudget().used;
  const spent = () => airRoiBudget().used - before;

  try {
    let ref: MarketRef;
    let fullName: string | null = null;

    if (identity === "catalogue") {
      ref = catalogueRef(market);
    } else {
      const found = await fetchMarketIdentity({
        lat: market.lat,
        lon: market.lon,
      });
      if (!found.market) return null;
      ref = found.market;
      fullName = found.fullName;
    }

    const summary = await fetchMarketSummary(ref);
    if (!complete(summary?.summary)) return null;
    fullName = fullName ?? summary.fullName;

    // The history is worth a call but never worth failing over: a page
    // with real headline figures and a seeded chart is far better than
    // one that falls back to seeded everything because the series was
    // unavailable.
    const monthly = history
      ? await fetchMarketMetrics(ref).catch(() => [])
      : [];

    if (!ignoreSearchQuota) commitLiveSearch(key);
    return {
      summary: summary.summary,
      monthly,
      fullName,
      ref,
      calls: spent(),
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
