import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { RentalListing } from "@/lib/mock/types";

/**
 * A market's name, or null when this deployment has never heard of it.
 *
 * Null rather than the slug. A saved row can carry a market this build
 * does not carry — a listing kept before a catalogue change, or one
 * from a ZIP search outside every covered market — and the old code
 * put the raw slug on screen, so a hunter read "Jacksonville, FL ·
 * jacksonville-fl" under their own saved property. A name we do not
 * have is better left unsaid than printed in kebab-case.
 */
export function marketName(slug: string): string | null {
  const m = MARKET_BY_SLUG.get(slug);
  return m ? `${m.name}, ${m.stateCode}` : null;
}

/** The unit's town, and the market it sits in when that is somewhere
 *  else — "Jacksonville, FL · Jacksonville, FL" said nothing twice. */
export function placeLine(l: RentalListing): string {
  const town = `${l.city}, ${l.stateCode}`;
  const market = marketName(l.marketSlug);
  if (!market || market.toLowerCase() === town.toLowerCase()) return town;
  return `${town} · ${market}`;
}
