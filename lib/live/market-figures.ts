/**
 * Measured figures replace modelled ones together, or not at all.
 *
 * A market card carries a rate, an occupancy and the RevPAR they imply.
 * The store may hold all three, some of them, or nothing. The rule this
 * file exists to hold: a real rate printed beside an invented occupancy
 * reads as one measurement and is two, so a partial row falls back
 * whole rather than blending.
 *
 * It is a pure function over a stored row so the same rule serves every
 * surface that shows market figures, and so a test can hold it still.
 */

import type { StoredMarketStats } from "@/lib/db/market-store";
import { revpar } from "@/lib/calc/arbitrage";

export interface DisplayFigures {
  /** True when these came from the feed rather than the model. */
  measured: boolean;
  adr: number;
  /** Fraction, 0–1. */
  occupancy: number;
  revpar: number;
  /** When the measurement was taken. Null whenever `measured` is false
   *  — a modelled figure has no date, and giving it one would be the
   *  same lie in a different font. */
  asOf: string | null;
}

export function displayFigures(
  modelled: { adr: number; occupancy: number },
  live: StoredMarketStats | null | undefined,
  at: string | null = null
): DisplayFigures {
  const measured = live?.adr != null && live.occupancy != null;
  if (!measured) {
    return {
      measured: false,
      adr: modelled.adr,
      occupancy: modelled.occupancy,
      revpar: revpar(modelled.adr, modelled.occupancy),
      asOf: null,
    };
  }
  const adr = live!.adr!;
  const occupancy = live!.occupancy!;
  return {
    measured: true,
    adr,
    occupancy,
    // The feed's own RevPAR where it gave one: it is computed over the
    // same nights that produced the rate, which is not always what
    // multiplying the two summaries back together gives.
    revpar: live!.revpar ?? revpar(adr, occupancy),
    asOf: at,
  };
}
