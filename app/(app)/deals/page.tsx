import { getMarkets, getRentalTotals } from "@/lib/data";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { searchFromParams } from "@/lib/deals/search-url";
import { DealsExplorer } from "@/components/deals/deals-explorer";

export const metadata = { title: "Deal Finder" };

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // No inventory ships with the page — Deal Finder is search-first, so
  // rentals load for the market or ZIP the user actually asks for.
  const [params, markets, totals] = await Promise.all([
    searchParams,
    getMarkets(),
    getRentalTotals(),
  ]);

  const one = (key: string): string | null => {
    const v = params[key];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
  };

  /**
   * The whole search, out of the URL.
   *
   * The explorer writes it there as somebody narrows, so a refresh
   * lands back on the eleven rentals they had rather than on "Where are
   * you hunting?". See lib/deals/search-url — the reading and the
   * writing are one module so they cannot drift.
   */
  const search = searchFromParams(one);

  /**
   * ?market=<slug> arrives from everywhere that links to a market — a
   * saved deal, an analysis, a market page. Resolved to the location
   * string the search box already speaks, rather than adding a second
   * way to express "this market" that could disagree with the first.
   * A ?q= written by the explorer itself wins, because it is already
   * in that language.
   */
  const found = one("market") ? MARKET_BY_SLUG.get(one("market")!) : undefined;
  const initialQuery =
    search.query || (found ? `${found.name}, ${found.stateCode}` : "");

  return (
    <DealsExplorer
      markets={markets}
      totals={totals}
      initialQuery={initialQuery}
      /**
       * A ZIP is its own search mode rather than text in the box: a
       * market name resolves to a market whose rentals then load on
       * their own, and five digits in the box are five characters
       * nothing acts on.
       */
      initialZip={search.zip}
      initialFilters={{ ...search.filters, query: initialQuery }}
      initialSort={search.sort}
      /**
       * ?listing=<id> arrives from a lease comp on an analysis: open
       * that rental's panel once the search it came with has landed.
       * The rental is not on this page yet — the search brings it in —
       * so this is an id to watch for rather than a row.
       */
      initialListing={search.listing}
      // ?list=<id> arrives from the Saved page: open on that list's rows.
      initialList={search.list}
    />
  );
}
