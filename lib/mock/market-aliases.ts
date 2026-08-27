/**
 * The names students actually type.
 *
 * The course teaches a city list, and some of its entries are not the
 * names this catalogue uses: it says Oahu where we say Honolulu, Big
 * Island where we say Kailua-Kona, "Ft Lauderdale" where we say Fort
 * Lauderdale. Every one of those was a dead end — the market sitting
 * right there, and a student following their own coursework getting an
 * empty result and concluding the market isn't covered.
 *
 * Measured, not guessed: running the real search matcher over all 78
 * course cities found 28 dead ends, seven of which were markets we
 * already carry under a different name. Those seven are here. The other
 * twenty-one are genuinely absent and want adding to the catalogue,
 * which is a different job.
 *
 * An alias is a SEARCH term only. It never renames a market, never
 * appears in the UI, and never changes which row is returned — it only
 * makes an existing row findable by a name people really use.
 */

import type { Market } from "@/lib/mock/types";

/**
 * Slug → extra search terms.
 *
 * Islands map to the town we carry on them. Where an island has more
 * than one town in the catalogue the term is deliberately attached to
 * both: "maui" matching two markets is the honest answer, and the
 * autocomplete offers both rather than guessing.
 */
export const MARKET_ALIASES: Record<string, string[]> = {
  // Hawaii by island, which is how the islands are actually referred to.
  honolulu: ["oahu"],
  "kailua-kona": ["big island", "hawaii island", "kona"],
  princeville: ["kauai"],
  kihei: ["maui"],
  lahaina: ["maui"],

  // Abbreviations and adjacent places from the course list.
  "fort-lauderdale": ["ft lauderdale"],
  monterey: ["monterey bay"],
  jacksonville: ["jacksonville beach", "jax"],
  sarasota: ["longboat key", "siesta key"],
};

/**
 * One market's searchable text, used by every search box in the app.
 *
 * Centralised because it was previously built inline in four places
 * that all had to agree, and an alias added to three of them is a bug
 * that only shows up in whichever screen was missed.
 *
 * The state code stays a standalone word on purpose — the matcher
 * relies on being able to find it at a word boundary.
 */
export function marketSearchText(market: Market): string {
  const aliases = MARKET_ALIASES[market.slug] ?? [];
  return `${market.name} ${market.state} ${market.stateCode}${
    aliases.length > 0 ? ` ${aliases.join(" ")}` : ""
  }`.toLowerCase();
}
