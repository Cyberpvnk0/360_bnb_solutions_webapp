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
import { storeConfigured } from "@/lib/db/market-store";
import { photoPages } from "@/lib/live/redfin";

export const dynamic = "force-dynamic";

export async function GET() {
  const usage = await scraperUsage();
  const pages = photoPages();
  // One search = the default pass plus one pass per extra property
  // type, each paginated. The structured endpoint bills one per page.
  const passes = 1 + (process.env.REDFIN_PHOTO_TYPES?.split(",").filter(Boolean).length ?? 1);

  return NextResponse.json({
    usage,
    costModel: {
      pagesPerPass: pages,
      passesPerSearch: passes,
      creditsPerMarketSearch: pages * passes,
      creditsPerListingDetail: 10,
      note: "A market search is billed once per page per pass at one credit each. A listing detail is ten, and is the only call students trigger by hand.",
    },
    durability: {
      storeConfigured: storeConfigured(),
      detail:
        "Nothing pre-fetches: a market costs credits when someone searches it and not before. With the store configured, that search's result AND any listing details opened from it survive deploys, so the next student rides for free. Without it both fall back to the framework cache, which every deployment discards — that is what made a day of pushes cost a day of credits.",
    },
  });
}
