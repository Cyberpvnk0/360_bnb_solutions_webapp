import { getMarkets, getMarketStates, getRentals } from "@/lib/data";
import { DealsExplorer } from "@/components/deals/deals-explorer";

export const metadata = { title: "Deal Finder" };

export default async function DealsPage() {
  const [rentals, markets, states] = await Promise.all([
    getRentals(),
    getMarkets(),
    getMarketStates(),
  ]);
  return <DealsExplorer rentals={rentals} markets={markets} states={states} />;
}
