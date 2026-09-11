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
   * row IS a ZIP.
   *
   * It goes in as a ZIP rather than as query text, because those are
   * two different searches. A market name in the box resolves to a
   * market and the market's rentals load on their own; a ZIP in the
   * box is just five characters nothing acts on — the ZIP search is
   * driven by its own state. Seeding the text left the box looking
   * searched and the page saying "Where are you hunting?".
   */
  const area = zip && /^\d{5}$/.test(zip) ? zip : null;
  const initialQuery = found ? `${found.name}, ${found.stateCode}` : "";

  return (
    <DealsExplorer
      markets={markets}
      totals={totals}
      initialQuery={initialQuery}
      initialZip={area}
      // ?list=<id> arrives from the Saved page: open on that list's rows.
      initialList={list ?? null}
    />
  );
}
