import { getMarkets, getMarketStates } from "@/lib/data";
import {
  readAllMarketStats,
  type StoredMarketStats,
} from "@/lib/db/market-store";
import { MarketsExplorer } from "@/components/markets/markets-explorer";

export const metadata = { title: "Markets" };

export default async function MarketsPage() {
  const [markets, states, stored] = await Promise.all([
    getMarkets(),
    getMarketStates(),
    // One query, no vendor calls. The grid shows measured figures for
    // whatever has already been paid for — by someone opening that
    // market, or by a deliberate backfill — and the seeded model for
    // the rest. Rendering 409 cards must never itself cost money.
    readAllMarketStats().catch(() => new Map()),
  ]);

  const liveStats: Record<string, StoredMarketStats> = {};
  for (const [slug, row] of stored) liveStats[slug] = row.stats;

  return (
    <MarketsExplorer markets={markets} states={states} liveStats={liveStats} />
  );
}
