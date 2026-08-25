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
import {
  normalizeCity,
  REDFIN_CITY_ID,
  resolveCityIdOnce,
  type OnceResult,
} from "@/lib/live/redfin-city";

const SCRAPER = "https://api.scraperapi.com/";

/** State pages are static; a year is if anything conservative. */
const STATE_PAGE_REVALIDATE_SECONDS = 31_536_000;

/**
 * Requests in flight.
 *
 * Three, not five. Five matches the trial thread limit exactly, which
 * leaves no headroom: run two batches close together and the second
 * invocation's requests collide with the first's, which is how a run
 * came back thirteen-of-twenty rate limited.
 */
const CONCURRENCY = 3;
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

/* ------------------------------------------------------------------ */
/* The tail: markets the state indexes don't list                      */
/* ------------------------------------------------------------------ */

export interface MissingResult {
  batch: number;
  batches: number;
  attempted: string[];
  resolved: Record<string, number>;
  unresolved: string[];
  /** HTTP statuses seen, by count — the difference between blocked,
   *  timed out, and answered-but-unreadable. */
  statuses?: Record<string, number>;
  /** First characters of a couple of failed responses. */
  sampleResponses?: string[];
  /** Rows that looked like cities across the batch. Zero with a 200
   *  means the payload shape changed, not that the towns don't exist. */
  candidatesSeen?: number;
  remainingAfter: number;
}

/**
 * Resolve a batch of the markets no state index covered.
 *
 * These are asked for by name, one lookup each, which is why they're
 * batched: twenty at five in flight fits a serverless budget, and eight
 * runs clear the tail. The same verification applies — a lookup that
 * can't confirm both city and state returns nothing rather than a
 * plausible neighbour.
 */
export async function resolveMissingBatch(
  batch: number,
  perBatch = 12
): Promise<MissingResult> {
  const missing = stillMissing();
  const batches = Math.ceil(missing.length / perBatch) || 1;
  const slugs = missing.slice(batch * perBatch, (batch + 1) * perBatch);
  const key = process.env.SCRAPERAPI_KEY;

  const base: MissingResult = {
    batch,
    batches,
    attempted: slugs,
    resolved: {},
    unresolved: slugs,
    remainingAfter: missing.length,
  };
  if (!key || slugs.length === 0) return base;

  const markets = slugs
    .map((slug) => MARKETS.find((m) => m.slug === slug))
    .filter((m): m is Market => m !== undefined);

  const outcomes: OnceResult[] = new Array(markets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, markets.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= markets.length) return;
        outcomes[i] = await resolveCityIdOnce(markets[i], key);
      }
    })
  );

  const resolved: Record<string, number> = {};
  const unresolved: string[] = [];
  const statuses: Record<string, number> = {};
  const heads: string[] = [];
  markets.forEach((m, i) => {
    const o = outcomes[i];
    statuses[String(o.status)] = (statuses[String(o.status)] ?? 0) + 1;
    if (heads.length < 2 && o.id === null) heads.push(o.head);
    if (o.id === null) unresolved.push(m.slug);
    else resolved[m.slug] = o.id;
  });

  return {
    batch,
    batches,
    attempted: slugs,
    resolved,
    unresolved,
    // A zero result has to say WHY. Blaming the towns was wrong: this
    // batch included El Paso, Fresno and Anaheim.
    statuses,
    sampleResponses: heads,
    candidatesSeen: outcomes.reduce((n, o) => n + o.candidates, 0),
    remainingAfter: missing.length - Object.keys(resolved).length,
  };
}

/* ------------------------------------------------------------------ */
/* Raw page probe: find a complete city index                          */
/* ------------------------------------------------------------------ */

/**
 * Fetch any Redfin page and report what city links it carries.
 *
 * The state index pages work but list only a state's popular cities —
 * California returned seven, and Napa, Monterey and Fresno were not
 * among them. Rather than guess at a fuller index and burn another
 * round per guess, this reads whatever URL it is handed and says how
 * many cities came back, so candidate pages can be tested in seconds.
 *
 * Restricted to redfin.com: the URL comes from a query string, and an
 * open fetcher would proxy anything asked of it.
 */
export interface PageProbe {
  url: string;
  status: number;
  bytes: number;
  cityLinksFound: number;
  sampleLinks: CityLink[];
  /** Sitemap URLs, when the page is a robots.txt. They sit at the
   *  BOTTOM of the file, so a head-of-response preview never shows
   *  them — which is how the first probe returned a perfectly good
   *  robots.txt and told us nothing. */
  sitemaps: string[];
  /** <loc> entries, when the page is itself a sitemap. */
  locs: string[];
  locCount: number;
  /** Internal link shapes on the page, by count — what navigation
   *  exists, without dumping thousands of hrefs. Finding a fuller city
   *  index means knowing what kinds of page Redfin links to at all. */
  linkPatterns: { prefix: string; count: number }[];
  /** Marks which build answered, so an empty result can never be
   *  mistaken for a stale deploy again. */
  probe: "v2";
  head: string;
}

/** `/city/8907/FL/...` → `/city/{id}/{ST}` — the SHAPE of a link. */
function linkShapes(text: string): { prefix: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/href="(\/[^"?#]{1,80})/g)) {
    const shape = m[1]
      .split("/")
      .slice(0, 4)
      .map((part) =>
        /^\d+$/.test(part) ? "{n}" : /^[A-Z]{2}$/.test(part) ? "{ST}" : part
      )
      .join("/");
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 18);
}

/** `Sitemap: https://…` — case-insensitive, one per line. */
function sitemapLines(text: string): string[] {
  return [...text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
}

function sitemapLocs(text: string): string[] {
  return [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

export async function probePage(
  url: string,
  tier: "standard" | "premium" = "premium"
): Promise<PageProbe> {
  const key = process.env.SCRAPERAPI_KEY;
  const empty: PageProbe = {
    url,
    status: 0,
    bytes: 0,
    cityLinksFound: 0,
    sampleLinks: [],
    sitemaps: [],
    locs: [],
    locCount: 0,
    linkPatterns: [],
    probe: "v2",
    head: "",
  };
  if (!key) return empty;
  if (!/^https:\/\/(?:www\.)?redfin\.com\//i.test(url)) {
    return { ...empty, status: 400, head: "not a redfin.com URL" };
  }

  try {
    const res = await fetch(
      `${SCRAPER}?${new URLSearchParams({
        api_key: key,
        url,
        // A sitemap is published FOR crawlers, so it may not need the
        // bypass at all — and the bypass is what makes a multi-megabyte
        // file too slow to finish inside the budget.
        ...(tier === "premium" ? { premium: "true" } : {}),
      })}`,
      {
        next: { revalidate: STATE_PAGE_REVALIDATE_SECONDS },
        // Most of the budget: a large sitemap is a slow transfer, not a
        // hung request, and 25s was cutting it off mid-download.
        signal: AbortSignal.timeout(50_000),
      }
    );
    const text = await res.text();
    const links = extractCityLinks(text);
    const maps = sitemapLines(text);
    const locs = sitemapLocs(text);
    return {
      url,
      status: res.status,
      bytes: text.length,
      cityLinksFound: links.length,
      sampleLinks: links.slice(0, 8),
      // Always present, even when empty: an omitted field is
      // indistinguishable from an old deploy, which is exactly how the
      // last robots.txt probe managed to answer nothing twice.
      sitemaps: maps,
      locCount: locs.length,
      locs: locs.slice(0, 40),
      linkPatterns: linkShapes(text),
      probe: "v2",
      head: text.slice(0, 300),
    };
  } catch {
    return { ...empty, status: 408, head: "timed out" };
  }
}
