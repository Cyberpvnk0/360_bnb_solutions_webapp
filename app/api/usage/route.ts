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
import { requireStaff } from "@/lib/auth/gate";
import { scraperUsage } from "@/lib/live/scraper-usage";
import { airRoiBudget, COMP_SHAPE_KEY, compFieldsSeen, hasAirRoiKey } from "@/lib/live/airroi";
import { rentcastBudget } from "@/lib/live/quota";
import { planTablesReady } from "@/lib/db/usage";
import {
  readKeyedBlob,
  storeConfigured,
  storeCounts,
  storeStatus,
} from "@/lib/db/market-store";
import { maxPages } from "@/lib/live/redfin";

export const dynamic = "force-dynamic";

export async function GET() {
  // Vendor balances and the arithmetic behind the bill: reads, no
  // spend. Staff — which is everyone signed in until a list is set.
  const staff = await requireStaff();
  if (!staff.ok) return staff.response;

  const usage = await scraperUsage();
  // One furnished search is one paginated pass. The structured endpoint
  // bills one credit per page, and the page cap is the only knob. Read
  // through the same function the search uses, ceiling included — an
  // env value of 400 must not be quoted here as 400 pages when the
  // search would run 25.
  const pages = maxPages();

  const airroi = airRoiBudget();
  const rentcast = rentcastBudget();
  const plan = await planTablesReady();
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
  // Memory first (same process), then the store (any process).
  const compsShape =
    compFieldsSeen() ?? (await readKeyedBlob(COMP_SHAPE_KEY).catch(() => null))?.value ?? null;
  const health = await storeStatus().catch(() => ({
    ok: false,
    detail: "health check threw",
  }));

  return NextResponse.json({
    /** The comps feed's field names from the last analysis this
     *  server ran — names only. How the link and photo readers get
     *  checked against what the feed really sends. */
    compsPayloadShape: compsShape,
    compsPayloadShapeNote:
      compsShape === null
        ? "No comp set has been bought since this was added. Cached analyses never reach the vendor; analyze a NEW address (or change a property's size) once, then reload this."
        : [
            "The vendor's last comp payload, described across the WHOLE set. Names and counts only, never a value.",
            "$fields: every field path any comp carried, with how many carried it — the union, because a JSON feed omits a null field per row and the first comp cannot say what the twentieth holds.",
            "$calendar: on how many comps the feed states each of the last-90-day counts. All zeros means the payload carries no calendar, whatever the rest of the file assumes.",
            "$span: the spread of l90d_total_days and ttm_total_days. This is the one pair that could tell a listing still on the platform from one that has come down, and only if the counts are days observed rather than window lengths — read its own `reading` line.",
            "$withheld: how many comps had no open or booked night in that window and so are shown without a room link, and how many the calendar cannot judge.",
            "$inactive / $rooms: how many comps were left out of the set entirely, and why.",
            "$ids: every id by digit length, and how many survived as exact integers rather than the printed form of a double — rounded ones here mean the vendor sends them rounded.",
            "$response: the estimate response's own top-level keys, which is where a data-as-of stamp would be if the vendor ships one.",
          ].join(" "),

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
        "No cap unless AIRROI_DAILY_CALLS is set (dailyCap null means none): each account's plan meter is the limit, and this is an optional breaker behind it. Measured price is $0.18 a call. " +
        "A cached analysis costs nothing and never reaches this counter, which is why callsToday staying flat while analyses are viewed is the cache working, not the meter breaking.",
    },
    /**
     * The feed's own meter. Its allowance is quoted per MONTH and every
     * other ledger here is per day; a cap that assumed the two were the
     * same number is how one afternoon spent a month.
     */
    /**
     * Did the plan SQL take? The meter and the pack tables are created
     * by supabase/auth-schema.sql; a false here with a reason is the
     * answer to "I ran it, did it work" without a round of clicking.
     */
    plan: {
      tablesReady: plan.usage && plan.credits,
      usageTable: plan.usage,
      creditTables: plan.credits,
      detail: plan.detail,
      note:
        "Both true means the monthly meter and the pack balance are live and the secret key can reach them. " +
        "To test another plan before checkout exists, set MOCK_CHECKOUT=1 and pick it on Settings → Billing.",
    },
    rentcast: {
      monthlyPlan: rentcast.monthly,
      dailyCap: rentcast.cap,
      usedToday: rentcast.used,
      left: rentcast.remaining,
      note:
        "No cap unless set (null means none): each student's plan is the only limit on markets. " +
        "To hold the feed to a plan, RENTCAST_MONTHLY_REQUESTS states it and the daily cap is that spread over 31 days, floor one; RENTCAST_DAILY_CAP overrides the arithmetic.",
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
