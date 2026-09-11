/**
 * /markets/[slug] — one market, in as much depth as real data allows.
 *
 * Every read here is free. The headline figures are whatever the store
 * already holds for this market, the areas are built from rentals and
 * short-let listings the product has already seen, and nothing on this
 * page buys anything: opening a market must never be a purchase, or
 * browsing the catalogue becomes a bill.
 */

import { notFound } from "next/navigation";
import { readMarketStore } from "@/lib/db/market-store";
import { readPool } from "@/lib/live/comp-pool";
import { readAreaStats } from "@/lib/live/area-stats";
import { buildAreas } from "@/lib/markets/areas";
import { buildSizes } from "@/lib/markets/sizes";
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

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const market = MARKET_BY_SLUG.get(slug);
  if (!market) notFound();

  const [store, pool] = await Promise.all([
    readMarketStore(slug).catch(() => null),
    readPool(slug).catch(() => ({ comps: [], anchors: [] })),
  ]);

  const listings = store?.listings ?? [];
  // The bought rows, for the ZIPs this market actually has. Asking for
  // the ZIPs we hold rather than for everything keeps one round trip
  // proportional to the market rather than to the store.
  const zips = [...new Set(listings.map((l) => zipOf(l)).filter(Boolean))] as string[];
  const measured = await readAreaStats(slug, zips).catch(() => new Map());

  const areas = buildAreas({ market, listings, comps: pool.comps, measured });
  const sizes = buildSizes({ comps: pool.comps, listings });

  return (
    <MarketDetail
      market={market}
      stats={store?.stats ?? null}
      statsAt={store?.statsAt ?? null}
      // Only ever what the stats row already carries. The year is a
      // separate billed call and this page does not make it; a market
      // backfilled at the cheap setting simply has no chart, and the
      // size panel — which costs nothing — is the one that matters.
      months={store?.stats?.monthly ?? []}
      listingsAt={store?.listingsAt ?? null}
      areas={areas}
      sizes={sizes}
      poolSize={pool.comps.length}
    />
  );
}
