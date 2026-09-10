/**
 * The figures a Deal Finder card is projected from — measured, not
 * modelled.
 *
 * Every card used to be projected from the seeded catalogue's ADR and
 * occupancy for its market: a hand-authored figure, plausible, and
 * made up. The analyzer, one click away, projects from live comps
 * drawn around the property. So a card could say a deal cleared by
 * thirty points while the page it opened said it fell short — both
 * from the same product, one of them invented. This is the end of the
 * invented one on that screen.
 *
 * TWO GRAINS, FINEST FIRST — and a third above both:
 *
 *   zip    the feed's own market for the property's ZIP, as its lookup
 *          resolves one ("43224, Columbus, Ohio, United States"): the
 *          grain a street belongs to. One billed call the first time a
 *          ZIP has a card on screen, kept a month.
 *   city   the feed's market for the whole city, addressed by name from
 *          our catalogue. One call, kept a week — the same row the
 *          market backfill writes.
 *   comps  the property's own, when an analysis has been run. Not this
 *          file's: see lib/live/property-figures.
 *
 * WHAT THE MONEY BUYS. A call is eighteen cents. A market is one call a
 * week; a ZIP is one call a month, and only once somebody has a card
 * in it on screen. A market of fifty ZIPs browsed end to end is nine
 * dollars a month, and a ZIP nobody looks at costs nothing, ever.
 * ZIP_FIGURES_DAILY_CAP is the brake, per instance, unset by default
 * like every other cap in this product.
 *
 * Never blended: a card is projected from one grain's figures, and it
 * says which.
 */

import { fetchMarketIdentity, fetchMarketSummary, hasAirRoiKey, type MarketSummary } from "./airroi";
import { catalogueRef, fetchLiveMarket } from "./market-live";
import {
  isFresh,
  readMarketStatsFor,
  STATS_TTL_MS,
  writeMarketStats,
  type StoredMarketStats,
} from "@/lib/db/market-store";
import type { Market } from "@/lib/mock/types";

export interface Figures {
  /** Average nightly rate across the area's listings, every size. */
  adr: number;
  /** Fraction. */
  occupancy: number;
  scope: "zip" | "city";
  /** The feed's own name for the area, when it gave one. */
  area: string | null;
  /** When measured, ISO. */
  at: string | null;
}

/** A month: a ZIP's trailing-twelve figures do not move week to week. */
export const ZIP_FIGURES_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A ZIP the feed had nothing for is not asked again for this long,
 *  per process: a burst of cards in it must not become a burst of
 *  billed calls that all answer nothing. */
const FAILURE_MEMORY_MS = 60 * 60 * 1000;

const ZIP_DAILY_CAP = (() => {
  const raw = Number(process.env.ZIP_FIGURES_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Number.POSITIVE_INFINITY;
})();

function usable(
  stats: StoredMarketStats | null | undefined
): stats is StoredMarketStats & { adr: number; occupancy: number } {
  return (
    !!stats &&
    typeof stats.adr === "number" &&
    stats.adr > 0 &&
    typeof stats.occupancy === "number" &&
    stats.occupancy >= 0 &&
    stats.occupancy <= 1
  );
}

/** Figures out of a stored row, or null when the row cannot carry a
 *  projection — a summary without both figures is not one. */
export function figuresFrom(
  stats: StoredMarketStats | null | undefined,
  at: string | null,
  scope: Figures["scope"]
): Figures | null {
  if (!usable(stats)) return null;
  return {
    adr: Math.round(stats.adr),
    occupancy: Math.round(stats.occupancy * 100) / 100,
    scope: stats.scope ?? scope,
    area: stats.fullName ?? null,
    at,
  };
}

function complete(s: MarketSummary | null | undefined): s is MarketSummary {
  return !!s && s.adr !== null && s.adr > 0 && s.occupancy !== null;
}

/** The store's slug for a ZIP's figures — beside the markets' own rows. */
export function zipFiguresSlug(zip: string): string {
  return `zip-${zip}`;
}

/** Reads under way in this process, so two cards in one area cost one call. */
const inFlight = new Map<string, Promise<Figures | null>>();

function once(key: string, job: () => Promise<Figures | null>): Promise<Figures | null> {
  const running = inFlight.get(key);
  if (running) return running;
  const started = job().finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

/**
 * The city's measured figures: from the store when fresh, otherwise
 * bought by name (one call) and stored for the week. A stale row beats
 * nothing — it is still a measurement, and it says when it was made.
 */
export async function marketFigures(market: Market): Promise<Figures | null> {
  const stored = (await readMarketStatsFor([market.slug]).catch(() => new Map()))
    .get(market.slug) as { stats: StoredMarketStats; at: string | null } | undefined;
  const kept = stored ? figuresFrom(stored.stats, stored.at, "city") : null;
  if (kept && isFresh(stored?.at, STATS_TTL_MS)) return kept;
  if (!hasAirRoiKey()) return kept;

  return once(`market:${market.slug}`, async () => {
    const live = await fetchLiveMarket(market, { identity: "catalogue", history: false });
    if (!live) return kept;
    const stats: StoredMarketStats = {
      ...live.summary,
      fullName: live.fullName,
      scope: live.ref.district ? "zip" : "city",
    };
    void writeMarketStats(market.slug, stats).catch(() => undefined);
    return figuresFrom(stats, live.asOf, "city") ?? kept;
  });
}

let zipDay = "";
let zipCalls = 0;
function zipSlot(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== zipDay) {
    zipDay = today;
    zipCalls = 0;
  }
  if (zipCalls >= ZIP_DAILY_CAP) return false;
  zipCalls += 1;
  return true;
}

const zipFailures = new Map<string, number>();

/**
 * A ZIP's measured figures: from the store when fresh, otherwise bought
 * and stored for the month.
 *
 * By name first — the city from our catalogue with the ZIP as the
 * district, which is how the feed's own lookup writes a ZIP's market —
 * for one call. When that comes back without figures and a point in
 * the ZIP is known, the feed is asked to name the point's market itself
 * and that is summarised: two more calls, and the feed's own word on
 * which area the point belongs to.
 */
export async function zipFigures(
  zip: string,
  market: Market,
  point?: { lat: number; lon: number }
): Promise<Figures | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const slug = zipFiguresSlug(zip);
  const stored = (await readMarketStatsFor([slug]).catch(() => new Map()))
    .get(slug) as { stats: StoredMarketStats; at: string | null } | undefined;
  if (stored && isFresh(stored.at, ZIP_FIGURES_TTL_MS)) {
    const kept = figuresFrom(stored.stats, stored.at, "zip");
    if (kept) return kept;
  }
  if (!hasAirRoiKey()) return null;
  const failedAt = zipFailures.get(zip);
  if (failedAt && Date.now() - failedAt < FAILURE_MEMORY_MS) return null;

  return once(`zip:${zip}`, async () => {
    if (!zipSlot()) return null;
    try {
      let answer = await fetchMarketSummary({ ...catalogueRef(market), district: zip }).catch(
        () => null
      );
      let area = answer?.fullName ?? null;
      if (!complete(answer?.summary) && point && zipSlot()) {
        const found = await fetchMarketIdentity(point).catch(() => null);
        if (found?.market?.district && zipSlot()) {
          answer = await fetchMarketSummary(found.market).catch(() => null);
          area = found.fullName ?? answer?.fullName ?? null;
        }
      }
      if (!complete(answer?.summary)) {
        zipFailures.set(zip, Date.now());
        return null;
      }
      const stats: StoredMarketStats = { ...answer.summary, fullName: area, scope: "zip" };
      void writeMarketStats(slug, stats).catch(() => undefined);
      return figuresFrom(stats, new Date().toISOString(), "zip");
    } catch {
      zipFailures.set(zip, Date.now());
      return null;
    }
  });
}

/** Tests only. */
export function resetMarketFiguresMemory(): void {
  inFlight.clear();
  zipFailures.clear();
  zipDay = "";
  zipCalls = 0;
}
