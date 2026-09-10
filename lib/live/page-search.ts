/**
 * The listing site's page for an address, found the way a person
 * would: by searching for the address.
 *
 * The site's own search box is an endpoint it does not let servers
 * call, so asking it means a proxied request that takes half a minute
 * and often fails. The search engines have already crawled every page
 * on the site, and a server may ask them in a second. So the address
 * is put to them, scoped to the site — the house number and the
 * street's own name quoted, the rest not (lib/live/listing-links,
 * searchTerms) — and the result whose PATH spells this exact address
 * is the page. The path is what is trusted, never the result's rank:
 * the site writes the state, the town, the street and the unit into
 * every property URL, and lib/live/redfin-page's picker holds a
 * result to all of them. A near miss is no page.
 *
 * Two engines, asked at once, no keys, no proxy: Bing's feed of a
 * search, which is plain XML, and DuckDuckGo's plain-HTML results.
 * Whichever answers first with a property page wins; an engine that
 * refuses, throttles or answers oddly is skipped, and a click is never
 * held past a couple of seconds for either.
 */

import { searchTerms } from "./listing-links";

export interface PageSearch {
  /** Property-page URLs on the listing site, in the engines' order. */
  urls: string[];
  /** What each engine said, for a diagnostic. */
  detail: string;
}

const SITE = "redfin.com";
const DEFAULT_TIMEOUT_MS = 2_500;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** The query: the two words with one spelling, quoted; the town and
 *  state bare; the site. */
export function pageSearchQuery(place: { address: string; city: string; stateCode: string }): string | null {
  const street = place.address.split(",")[0].trim();
  const { number, name } = searchTerms(street);
  const pin = number && name ? `"${number}" "${name}"` : street.length >= 3 ? `"${street}"` : null;
  if (!pin || !place.city.trim()) return null;
  return `site:${SITE} ${pin} ${place.city.trim()} ${place.stateCode.trim().toUpperCase()}`.trim();
}

/** A property page on the listing site, or null for anything else. */
function propertyPage(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)redfin\.com$/i.test(u.hostname)) return null;
    if (!/\/(home|apartment)\/\d+/.test(u.pathname)) return null;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** The links in Bing's feed: <item><link>…</link></item>, sometimes
 *  wrapped in CDATA. */
export function linksInRss(xml: string): string[] {
  const out: string[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items) {
    const m = /<link>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/i.exec(item);
    if (m) out.push(decodeEntities(m[1]));
  }
  return out;
}

/** The result links in DuckDuckGo's plain HTML: direct, or wrapped in
 *  their redirect with the destination in `uddg`. */
export function linksInDuckHtml(html: string): string[] {
  const out: string[] = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1]);
    const wrapped = /[?&]uddg=([^&]+)/.exec(href);
    if (wrapped) {
      try {
        out.push(decodeURIComponent(wrapped[1]));
      } catch {
        // A destination that does not decode is not a link.
      }
    } else if (/^https?:\/\//i.test(href)) {
      out.push(href);
    } else if (href.startsWith("//")) {
      out.push(`https:${href}`);
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function ask(
  url: string,
  accept: string,
  timeoutMs: number,
  parse: (body: string) => string[]
): Promise<{ urls: string[]; detail: string }> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept, "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return { urls: [], detail: `HTTP ${res.status}` };
    const body = await res.text();
    const links = parse(body);
    const urls = links.map(propertyPage).filter((u): u is string => u !== null);
    return {
      urls,
      detail: urls.length > 0 ? `${urls.length} page${urls.length === 1 ? "" : "s"}` : `${links.length} results, none a page`,
    };
  } catch (e) {
    return {
      urls: [],
      detail: e instanceof Error && e.name === "TimeoutError" ? "no answer in time" : "unreachable",
    };
  }
}

/**
 * The listing site's property pages the engines hold for this address,
 * best answer first. Empty when neither engine had one within the
 * time — which says nothing about the address, only about the engines.
 */
export async function searchListingPages(
  place: { address: string; city: string; stateCode: string },
  opts: { timeoutMs?: number } = {}
): Promise<PageSearch> {
  const query = pageSearchQuery(place);
  if (!query) return { urls: [], detail: "too little of an address to search for" };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const q = encodeURIComponent(query);
  const [bing, duck] = await Promise.all([
    ask(`https://www.bing.com/search?q=${q}&format=rss`, "application/rss+xml, application/xml, text/xml, */*", timeoutMs, linksInRss),
    ask(`https://html.duckduckgo.com/html/?q=${q}`, "text/html", timeoutMs, linksInDuckHtml),
  ]);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const u of [...bing.urls, ...duck.urls]) {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  return { urls, detail: `bing: ${bing.detail}; duckduckgo: ${duck.detail}` };
}
