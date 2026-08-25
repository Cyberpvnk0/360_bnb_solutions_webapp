/**
 * Bulk city-id discovery.
 *
 * Resolving markets one at a time is fine for a straggler and hopeless
 * for a country: 370 markets is 370 slow, billed lookups against an
 * undocumented endpoint. Redfin already publishes the answer in bulk —
 * every state has an index page whose links carry the city ids — so 51
 * page reads cover every market we have, once, and the result is a
 * static map that never needs looking up again.
 *
 * Output is deliberately paste-ready: the point is to end up with the
 * ids committed in source, not to keep asking for them at runtime.
 */

import { MARKETS } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import { normalizeCity, REDFIN_CITY_ID } from "@/lib/live/redfin-city";

const SCRAPER = "https://api.scraperapi.com/";

/** State pages are static; a year is if anything conservative. */
const STATE_PAGE_REVALIDATE_SECONDS = 31_536_000;

/** Requests in flight, matching the vendor's trial thread limit. */
const CONCURRENCY = 5;
/** Per-page ceiling, so one slow state can't spend the whole budget. */
const PAGE_TIMEOUT_MS = 18_000;

/** Every state our markets sit in, in a stable order so batches are
 *  reproducible across runs. */
export function statesInPlay(): string[] {
  return [...new Set(MARKETS.map((m) => m.state))].sort();
}

export function stateIndexUrl(state: string): string {
  return `https://www.redfin.com/state/${state.trim().replace(/\s+/g, "-")}`;
}

/** `/city/8907/FL/Jacksonville` — the id is in the path of every link. */
const CITY_LINK = /\/city\/(\d+)\/([A-Z]{2})\/([A-Za-z0-9.\-']+)/g;

export interface CityLink {
  id: number;
  stateCode: string;
  name: string;
}

export function extractCityLinks(html: string): CityLink[] {
  const seen = new Set<string>();
  const out: CityLink[] = [];
  for (const m of html.matchAll(CITY_LINK)) {
    const id = Number(m[1]);
    const stateCode = m[2];
    const name = m[3].replace(/-/g, " ");
    const key = `${stateCode}:${normalizeCity(name)}`;
    if (!Number.isFinite(id) || seen.has(key)) continue;
    seen.add(key);
    out.push({ id, stateCode, name });
  }
  return out;
}

/**
 * Match links to our markets.
 *
 * The same verification the single resolver uses: city name whole and
 * state exact, because Jacksonville FL and Jacksonville NC both exist
 * and a near-miss would hard-code the wrong city into source.
 */
export function matchMarkets(
  links: readonly CityLink[],
  markets: readonly Market[]
): Record<string, number> {
  const byKey = new Map<string, number>();
  for (const link of links) {
    byKey.set(`${link.stateCode}:${normalizeCity(link.name)}`, link.id);
  }
  const out: Record<string, number> = {};
  for (const market of markets) {
    const id = byKey.get(
      `${market.stateCode}:${normalizeCity(market.name)}`
    );
    if (id !== undefined) out[market.slug] = id;
  }
  return out;
}

async function fetchStatePage(
  state: string,
  key: string
): Promise<{ state: string; html: string; status: number }> {
  const params = new URLSearchParams({
    api_key: key,
    url: stateIndexUrl(state),
    // redfin.com is a protected domain on the plain endpoint; the
    // standard tier is served a block page rather than the index.
    premium: "true",
  });
  try {
    const res = await fetch(`${SCRAPER}?${params}`, {
      next: { revalidate: STATE_PAGE_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    return { state, html: res.ok ? await res.text() : "", status: res.status };
  } catch {
    return { state, html: "", status: 408 };
  }
}

export interface BulkResult {
  batch: number;
  batches: number;
  states: string[];
  /** slug → city id, ready to paste into REDFIN_CITY_ID. */
  resolved: Record<string, number>;
  /** Markets in these states we could not match, by slug. */
  unresolved: string[];
  /** States whose index page didn't come back, with the status. */
  failedStates: { state: string; status: number }[];
}

/**
 * One batch of states, resolved.
 *
 * Batched because a bypass request against a protected domain takes
 * seconds and a serverless function has a budget: ten states at five in
 * flight fits comfortably, and six runs cover the country.
 */
export async function resolveBatch(
  batch: number,
  perBatch = 10
): Promise<BulkResult> {
  const all = statesInPlay();
  const batches = Math.ceil(all.length / perBatch);
  const states = all.slice(batch * perBatch, (batch + 1) * perBatch);
  const key = process.env.SCRAPERAPI_KEY;

  const empty: BulkResult = {
    batch,
    batches,
    states,
    resolved: {},
    unresolved: [],
    failedStates: [],
  };
  if (!key || states.length === 0) return empty;

  // Pooled, so the vendor's thread limit is respected.
  const pages: { state: string; html: string; status: number }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, states.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= states.length) return;
        pages[i] = await fetchStatePage(states[i], key);
      }
    })
  );

  const inBatch = MARKETS.filter((m) => states.includes(m.state));
  const links = pages.flatMap((p) => extractCityLinks(p.html));
  const resolved = matchMarkets(links, inBatch);

  return {
    batch,
    batches,
    states,
    resolved,
    unresolved: inBatch
      .filter((m) => resolved[m.slug] === undefined)
      .map((m) => m.slug),
    failedStates: pages
      .filter((p) => p.html === "")
      .map((p) => ({ state: p.state, status: p.status })),
  };
}

/** Markets still missing an id across the whole set — what's left to do. */
export function stillMissing(): string[] {
  return MARKETS.filter((m) => REDFIN_CITY_ID[m.slug] === undefined).map(
    (m) => m.slug
  );
}
