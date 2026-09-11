import { getMarkets, getRentalTotals } from "@/lib/data";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { DealsExplorer } from "@/components/deals/deals-explorer";

export const metadata = { title: "Deal Finder" };

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; zip?: string; list?: string }>;
}) {
  // No inventory ships with the page — Deal Finder is search-first, so
  // rentals load for the market or ZIP the user actually asks for.
  const [{ market, zip, list }, markets, totals] = await Promise.all([
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
  /**
   * ?zip=<5 digits> arrives from a market page's area table, where a
   * row IS a ZIP. The box already speaks ZIP, so this is the same
   * resolution one level finer rather than a second search mode.
   */
  const area = zip && /^\d{5}$/.test(zip) ? zip : "";
  const initialQuery = area || (found ? `${found.name}, ${found.stateCode}` : "");

  return (
    <DealsExplorer
      markets={markets}
      totals={totals}
      initialQuery={initialQuery}
      // ?list=<id> arrives from the Saved page: open on that list's rows.
      initialList={list ?? null}
    />
  );
}
