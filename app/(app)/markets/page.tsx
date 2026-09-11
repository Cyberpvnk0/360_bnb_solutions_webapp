/**
 * Market Explorer — where to look, before which property.
 *
 * The browser this restores was removed for duplicating the Deal
 * Finder, and the reason it does not now is the column that was
 * missing then: the local rule. An arbitrage operator's first question
 * about a city is whether nightly letting is allowed there at all, and
 * no amount of inventory answers it.
 *
 * Two reads, both free. The catalogue is in the bundle; the measured
 * figures are one query against the store — the rows analyses have
 * already paid for, shared across every account. Nothing here reaches
 * a vendor, so opening this page costs nothing and can be opened as
 * often as it is useful.
 */

import { getMarkets } from "@/lib/data";
import { readAllMarketStats } from "@/lib/db/market-store";
import { buildRows } from "@/lib/markets/explorer";
import { MarketsExplorer } from "@/components/markets/markets-explorer";

export const metadata = { title: "Markets" };

export default async function MarketsPage() {
  const [markets, stats] = await Promise.all([
    getMarkets(),
    // A store that cannot be read is a page with no measured columns,
    // never a page that fails: the rules and the coverage still stand.
    readAllMarketStats().catch(() => new Map()),
  ]);
  return <MarketsExplorer rows={buildRows(markets, stats)} />;
}
