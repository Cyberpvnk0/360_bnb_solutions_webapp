/**
 * What's left in the tank:  /api/usage
 *
 * Free to call — the vendor's account endpoint bills nothing — so this
 * can be hit as often as it's useful, which is the point. A credit
 * budget you can only check by logging into a dashboard is a budget
 * nobody checks until it's empty, which is exactly how the last one
 * went.
 *
 * Also prints the arithmetic behind a market search, because "is the
 * plan big enough" is a question about cost per search and searches per
 * day, and neither number is written down anywhere else.
 */

import { NextResponse } from "next/server";
import { scraperUsage } from "@/lib/live/scraper-usage";
import { airRoiBudget, hasAirRoiKey } from "@/lib/live/airroi";
import {
  storeConfigured,
  storeCounts,
  storeStatus,
} from "@/lib/db/market-store";
import { DEFAULT_MAX_PAGES } from "@/lib/live/redfin";

export const dynamic = "force-dynamic";

export async function GET() {
  const usage = await scraperUsage();
  // One furnished search is one paginated pass. The structured endpoint
  // bills one credit per page, and the page cap is the only knob.
  const pages = Number(process.env.REDFIN_MAX_PAGES) || DEFAULT_MAX_PAGES;

  const airroi = airRoiBudget();
  // One database, so this answers across instances where the in-memory
  // counter cannot.
  const stored = await storeCounts().catch(() => null);
  /**
   * The only check that distinguishes the two ways storage fails.
   *
   * `storeConfigured` says the variables exist, which is not the same
   * claim as the key working — and with row-level security on and no
   * policies, an under-privileged key does not error loudly, it returns
   * a cheerful nothing. Counts cannot tell that apart from an empty
   * table either. This writes a sentinel row and reads it back, so it
   * answers the actual question and names the reason when the answer is
   * no.
   */
  const health = await storeStatus().catch(() => ({
    ok: false,
    detail: "health check threw",
  }));

  return NextResponse.json({
    usage,
    /**
     * The OTHER meter. Two vendors bill this product and only one of
     * them was visible here, which is how a balance gets spent by a
     * code path nobody was watching.
     */
    airroi: {
      configured: hasAirRoiKey(),
      callsToday: airroi.used,
      dailyCap: airroi.cap,
      left: airroi.left,
      note:
        "Per-instance and per-day, so the fleet total is this times however many instances are warm — a brake, not a lock. " +
        "Measured price is $0.18 a call, so this cap is about $9 of exposure per instance per day. AIRROI_DAILY_CALLS overrides it. " +
        "A cached analysis costs nothing and never reaches this counter, which is why callsToday staying flat while analyses are viewed is the cache working, not the meter breaking.",
    },
    costModel: {
      pagesPerSearch: pages,
      creditsPerFurnishedSearch: pages,
      note:
        "The scraping vendor's one job in the product is a furnished-filtered rental search, billed one credit per page. " +
        "That search opens no listing pages and fetches no photos — a card's picture is Street View or an aerial, and the listing's own photos are a link away on its source page.",
    },
    durability: {
      storeConfigured: storeConfigured(),
      /** Write-then-read, so this is "can it store", not "is it set up". */
      writable: health.ok,
      writeDetail: health.ok ? null : health.detail,
      /**
       * The real test of whether anything is being kept. `keyed` counts
       * cached property analyses and resolved city ids; run one analysis
       * and it should go up by one, reload it and it should not move.
       */
      rows: stored,
      detail:
        "Nothing pre-fetches: a market costs credits when someone searches it and not before. With the store configured, that search's result survives deploys, so the next student rides for free. Without it, it falls back to the framework cache, which every deployment discards — that is what made a day of pushes cost a day of credits.",
    },
  });
}
