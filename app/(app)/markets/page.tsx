import { getMarkets, getMarketStates } from "@/lib/data";
import { MarketsExplorer } from "@/components/markets/markets-explorer";

export const metadata = { title: "Markets" };

export default async function MarketsPage() {
  const [markets, states] = await Promise.all([getMarkets(), getMarketStates()]);
  return <MarketsExplorer markets={markets} states={states} />;
}
