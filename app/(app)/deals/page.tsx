import { getMarkets, getRentalTotals } from "@/lib/data";
import { DealsExplorer } from "@/components/deals/deals-explorer";

export const metadata = { title: "Deal Finder" };

export default async function DealsPage() {
  // No inventory ships with the page — Deal Finder is search-first, so
  // rentals load for the market or ZIP the user actually asks for.
  const [markets, totals] = await Promise.all([getMarkets(), getRentalTotals()]);
  return <DealsExplorer markets={markets} totals={totals} />;
}
