/**
 * Which market a typed location means.
 *
 * The Deal Finder only loads live inventory once a search resolves to
 * exactly ONE market, and for a long time "exactly one" meant literally
 * that: one hit, or nothing happens. A market whose name is contained
 * in a neighbour's, or whose state name is in every sibling's
 * searchable text, could therefore never be searched at all — the
 * screen sat on an empty grid with no error, because from the code's
 * point of view nothing had gone wrong.
 *
 * Four of the four hundred and nine were unreachable this way:
 *
 *   Las Vegas, NV         also matched North Las Vegas, NV
 *   Colorado Springs, CO  also matched Steamboat Springs, CO
 *   Jersey City, NJ       also matched Atlantic City and Ocean City
 *   New York, NY          matched all thirteen New York markets, because
 *                         "new york" is the state name on every one
 *
 * The rule that fixes all four without knowing about any of them: when
 * several markets match, prefer the one the query actually NAMES. A
 * query that spells out a market's own name and state is a query about
 * that market, whatever else its words happen to appear inside.
 *
 * Still null when the query names none of them, or names more than one
 * — "springfield" alone is genuinely ambiguous and guessing would send
 * somebody's search to the wrong state.
 *
 * lib/live/market-resolve.test.ts asserts that EVERY market in the
 * catalogue resolves from its own canonical "Name, ST". A market added
 * later that collides with an existing one fails there rather than
 * going quietly unsearchable.
 */

import { marketMatchesQuery } from "@/components/deals/deal-filters";
import { marketSearchText } from "@/lib/mock/market-aliases";
import type { Market } from "@/lib/mock/types";

/** Lowercase, punctuation out, single spaces — so "Las Vegas, NV",
 *  "las vegas nv" and "Las  Vegas,NV" are one string. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The ways somebody writes a market's own name: bare, with the code,
 *  and with the state spelled out. */
function namesOf(market: Market): string[] {
  return [
    normalize(market.name),
    normalize(`${market.name} ${market.stateCode}`),
    normalize(`${market.name} ${market.state}`),
  ];
}

/** True when the query is this market's own name rather than something
 *  its name merely contains. */
export function queryNamesMarket(market: Market, query: string): boolean {
  return namesOf(market).includes(normalize(query));
}

/**
 * The one market a query means, or null when it means none or several.
 *
 * `markets` is the catalogue; `matches` is the loose matcher every
 * search box shares, injected so the two can never drift apart.
 */
export function resolveMarketQuery(
  markets: readonly Market[],
  query: string,
  matches: (haystack: string, query: string) => boolean = marketMatchesQuery
): Market | null {
  const q = query.trim();
  if (!q) return null;
  const hits = markets.filter((m) => matches(marketSearchText(m), q));
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  // Several matched. The query naming one of them outright decides it;
  // anything else stays ambiguous on purpose.
  const named = hits.filter((m) => queryNamesMarket(m, q));
  return named.length === 1 ? named[0] : null;
}
