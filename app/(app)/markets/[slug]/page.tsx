import { notFound } from "next/navigation";
import { getMarket, getSubmarkets } from "@/lib/data";
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
  return <MarketDetail market={market} submarkets={submarkets} />;
}
