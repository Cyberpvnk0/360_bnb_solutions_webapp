import { notFound } from "next/navigation";
import { getMarket, getSubmarkets } from "@/lib/data";
import { marketStats } from "@/lib/live/market-stats";
import { MarketDetail } from "@/components/markets/market-detail";

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [market, submarkets] = await Promise.all([
    getMarket(slug),
    getSubmarkets(slug),
  ]);
  if (!market) notFound();

  // Opening this page is what pays for it. Nothing pre-fetches markets,
  // so a market nobody looks at costs nothing — and one that has been
  // looked at recently costs nothing again until its row goes stale.
  const live = await marketStats(market).catch(() => null);

  return (
    <MarketDetail market={market} submarkets={submarkets} live={live} />
  );
}
