/** Server render reads cached facts only. Once opened, the client completes
 * missing analysis sections through the priced POST; link prefetch never buys. */

import { notFound } from "next/navigation";
import { readMarketStore, isFresh, STATS_TTL_MS } from "@/lib/db/market-store";
import { readPool } from "@/lib/live/comp-pool";
import { readAreaStats } from "@/lib/live/area-stats";
import { storedMarketMonths } from "@/lib/live/market-history";
import { storedMarketPacing } from "@/lib/live/market-pacing";
import { buildAreas } from "@/lib/markets/areas";
import { buildSizes } from "@/lib/markets/sizes";
import { readAmenities } from "@/lib/markets/amenities";
import { readCompetition } from "@/lib/markets/competition";
import { zipOf } from "@/lib/live/zip";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { MarketDetail } from "@/components/markets/market-detail";


export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const market = MARKET_BY_SLUG.get(slug);
  return { title: market ? `${market.name}, ${market.stateCode}` : "Market" };
}

import { DEFAULT_TIER, TIERS } from "@/config/app";
import { resolveTier } from "@/lib/db/usage";
import { currentUser } from "@/lib/supabase/server";
import { MarketsLocked } from "@/components/markets/markets-locked";

/**
 * Whether this account's plan includes the market analyzer.
 *
 * Checked on the page rather than in the proxy so a reader who followed
 * a link here gets told what the surface is and which plan has it,
 * instead of a redirect that looks like the page is gone.
 */
async function allowed(): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;
  const tier = await resolveTier(user.id).catch(() => DEFAULT_TIER);
  return TIERS[tier].marketAnalyzer;
}

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await allowed())) return <MarketsLocked />;
  const { slug } = await params;
  const market = MARKET_BY_SLUG.get(slug);
  if (!market) notFound();

  const [store, pool, history, pacing] = await Promise.all([
    readMarketStore(slug).catch(() => null),
    readPool(slug).catch(() => ({ comps: [], anchors: [] })),
    storedMarketMonths(slug).catch(() => null),
    storedMarketPacing(slug).catch(() => null),
  ]);

  const listings = store?.listings ?? [];
  // The bought rows, for the ZIPs this market actually has. Asking for
  // the ZIPs we hold rather than for everything keeps one round trip
  // proportional to the market rather than to the store.
  const zips = [...new Set(listings.map((l) => zipOf(l)).filter(Boolean))] as string[];
  const measured = await readAreaStats(slug, zips).catch(() => new Map());

  // The year, when a backfill bought it alongside the headline figures.
  const freshStats = store?.stats && isFresh(store.statsAt, STATS_TTL_MS) ? store.stats : null;
  const inline = freshStats?.monthly ?? [];

  const areas = buildAreas({ market, listings, comps: pool.comps, measured });
  const sizes = buildSizes({ comps: pool.comps, listings });
  // Free, and better the more this market is used: every analysis drops
  // its comps here, amenities included.
  const amenities = readAmenities(pool.comps);
  // Who a first unit would be bidding against — same pool, same price.
  const competition = readCompetition(pool.comps);

  return (
    <MarketDetail
      key={market.slug}
      market={market}
      stats={freshStats}
      statsAt={freshStats ? (store?.statsAt ?? null) : null}
      // Read, never bought: the year is a billed call and this page
      // makes none. It lands inline on the stats row when a backfill
      // bought both together, and under its own key when somebody
      // bought the year on its own from the chart below.
      months={history?.months ?? inline}
      // The byline follows whichever series was chosen, not whichever
      // date happens to exist: a chart drawn from the stats row dated
      // by a later standalone buy would be telling the reader the
      // wrong thing about the numbers in front of them.
      monthsAt={history?.at ?? (inline.length > 0 ? (store?.statsAt ?? null) : null)}
      pace={pacing?.days ?? []}
      paceAt={pacing?.at ?? null}
      amenities={amenities}
      competition={competition}
      listingsAt={store?.listingsAt ?? null}
      areas={areas}
      sizes={sizes}
      poolSize={pool.comps.length}
    />
  );
}
