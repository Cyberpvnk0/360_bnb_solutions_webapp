import { getMarkets, getRentalTotals } from "@/lib/data";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { DealsExplorer } from "@/components/deals/deals-explorer";

export const metadata = { title: "Deal Finder" };

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  // No inventory ships with the page — Deal Finder is search-first, so
  // rentals load for the market or ZIP the user actually asks for.
  const [{ market }, markets, totals] = await Promise.all([
    searchParams,
    getMarkets(),
    getRentalTotals(),
  ]);

  /**
   * ?market=<slug> arrives from everywhere that used to link to a
   * market page — a saved deal, an analysis, a listing. Resolved to the
   * location string the search box already speaks, rather than adding a
   * second way to express "this market" that could disagree with the
   * first.
   */
  const found = market ? MARKET_BY_SLUG.get(market) : undefined;
  const initialQuery = found ? `${found.name}, ${found.stateCode}` : "";

  return (
    <DealsExplorer
      markets={markets}
      totals={totals}
      initialQuery={initialQuery}
    />
  );
}
