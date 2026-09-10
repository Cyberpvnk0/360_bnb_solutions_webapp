/**
 * The city's measured figures — the grain a Deal Finder card falls to
 * when there are not enough real listings near the property to stand
 * on (lib/live/comp-pool).
 *
 * Every card used to be projected from the seeded catalogue's ADR and
 * occupancy for its market: a hand-authored figure, plausible, and
 * made up. The analyzer, one click away, projects from live comps
 * drawn around the property. So a card could say a deal cleared by
 * thirty points while the page it opened said it fell short — both
 * from the same product, one of them invented. The invented one is
 * gone from that screen: a card stands on the property's own comps,
 * on the listings around it, on the city's measured figures, and only
 * then — labelled — on the catalogue.
 *
 * The city's figures are the feed's market addressed by name from our
 * catalogue: one call, eighteen cents, kept a month — the same row the
 * market backfill writes, and the one thing the Deal Finder's cards
 * ever buy. The correction the city's own analyses put on the figures
 * is applied where the cards are answered (lib/live/comp-pool).
 */

import { hasAirRoiKey } from "./airroi";
import { fetchLiveMarket } from "./market-live";
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

/** Reads under way in this process, so a page of cards costs one call. */
const inFlight = new Map<string, Promise<Figures | null>>();

/**
 * The city's measured figures: from the store when fresh, otherwise
 * bought by name (one call) and stored for the month. A stale row beats
 * nothing — it is still a measurement, and it says when it was made.
 */
export async function marketFigures(market: Market): Promise<Figures | null> {
  const stored = (await readMarketStatsFor([market.slug]).catch(() => new Map()))
    .get(market.slug) as { stats: StoredMarketStats; at: string | null } | undefined;
  const kept = stored ? figuresFrom(stored.stats, stored.at, "city") : null;
  if (kept && isFresh(stored?.at, STATS_TTL_MS)) return kept;
  if (!hasAirRoiKey()) return kept;

  const running = inFlight.get(market.slug);
  if (running) return running;
  const job = (async () => {
    const live = await fetchLiveMarket(market, { identity: "catalogue", history: false });
    if (!live) return kept;
    const stats: StoredMarketStats = {
      ...live.summary,
      fullName: live.fullName,
      scope: live.ref.district ? "zip" : "city",
    };
    void writeMarketStats(market.slug, stats).catch(() => undefined);
    return figuresFrom(stats, live.asOf, "city") ?? kept;
  })().finally(() => inFlight.delete(market.slug));
  inFlight.set(market.slug, job);
  return job;
}

/** Tests only. */
export function resetMarketFiguresMemory(): void {
  inFlight.clear();
}
