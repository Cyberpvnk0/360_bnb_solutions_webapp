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

export default async function MarketsPage() {
  if (!(await allowed())) return <MarketsLocked />;

  const [markets, stats] = await Promise.all([
    getMarkets(),
    // A store that cannot be read is a page with no measured columns,
    // never a page that fails: the rules and the coverage still stand.
    readAllMarketStats().catch(() => new Map()),
  ]);
  return <MarketsExplorer rows={buildRows(markets, stats)} />;
}
