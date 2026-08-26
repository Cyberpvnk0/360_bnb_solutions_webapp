/**
 * Scheduled cache warming:  /api/warm  (Vercel cron, hourly)
 *
 * The first request into a cold market pays for everything — search
 * pages, the feed, a few hundred geocodes — and until this existed,
 * that first request belonged to whichever student searched the market
 * first each day. Now it belongs to the schedule: the cron walks the
 * configured list a couple of markets per run, does exactly the work
 * the photo route would do, and throws the answer away. The caches it
 * fills are the product.
 *
 * Deliberately opt-in via WARM_MARKETS, because each listed market
 * spends real vendor credits once a day whether anyone visits or not.
 * With CRON_SECRET set (Vercel sends it on cron requests), outside
 * calls are refused; without it the endpoint is still safe against
 * abuse in the way that matters — repeat calls inside the cache window
 * are cache reads and spend nothing.
 */

import { NextResponse } from "next/server";
import {
  storeConfigured,
  writeMarketListings,
  writeMarketPhotoMerge,
} from "@/lib/db/market-store";
import { buildMarketPhotoMerge } from "@/lib/live/photo-merge";
import { warmList, warmSlice } from "@/lib/live/warm";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = warmList();
  if (list.length === 0) {
    return NextResponse.json({
      enabled: false,
      note: "Set WARM_MARKETS to a comma-separated list of market slugs to warm them on schedule.",
    });
  }

  const slugs = warmSlice(list, new Date().getUTCHours());
  const results: {
    slug: string;
    ok: boolean;
    ms: number;
    matched?: number;
    extras?: number;
    error?: string;
  }[] = [];

  // Sequential on purpose: two markets warming side by side is two
  // paginated scrapes racing each other into the vendor's thread limit.
  for (const slug of slugs) {
    const market = MARKET_BY_SLUG.get(slug);
    const started = Date.now();
    if (!market) {
      results.push({ slug, ok: false, ms: 0, error: "unknown market slug" });
      continue;
    }
    try {
      const merge = await buildMarketPhotoMerge(market);
      // The point of warming: the work lands in the durable store, so
      // it survives deploys and serves every instance — not just the
      // framework cache of whichever one ran the cron.
      if (merge.feed.length > 0) {
        await writeMarketListings(slug, merge.feed);
      }
      if (merge.covered) {
        await writeMarketPhotoMerge(slug, {
          photos: merge.photos,
          extras: merge.extras,
          matched: Object.keys(merge.photos).length,
          rows: merge.rows,
        });
      }
      results.push({
        slug,
        ok: true,
        ms: Date.now() - started,
        matched: Object.keys(merge.photos).length,
        extras: merge.extras.length,
      });
    } catch (error) {
      results.push({
        slug,
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "failed",
      });
    }
  }

  return NextResponse.json({
    enabled: true,
    listSize: list.length,
    // Without the store, warming still helps the instance that ran it —
    // but only the store makes it durable. Say which mode this run was.
    durable: storeConfigured(),
    results,
  });
}
