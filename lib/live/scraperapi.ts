/**
 * ScraperAPI — the description source behind the Furnished filter.
 *
 * THE ONE RULE OF THIS MODULE: listing prose goes in, feature FLAGS come
 * out. The fetched document is a local inside `describeListing` and is
 * never returned, stored, cached in our own layer, logged, or sent to a
 * browser. What we keep is a fact about a property ("this unit is
 * furnished"), not somebody else's sentence about it. `enrich.test.ts`
 * enforces that the enriched listing carries no prose, so a later
 * refactor can't quietly start persisting it.
 *
 * Server-side ONLY: the key lives in SCRAPERAPI_KEY and every call goes
 * through app/api/enrich, never the browser.
 *
 * Cost shape (their credit model, not requests): a plain page is 1
 * credit, a PerimeterX/DataDome bypass adds 10, and JS rendering
 * multiplies further. Zillow is protected AND JS-rendered, so this tries
 * the cheap path first and only escalates to rendering when the cheap
 * path came back with nothing to read.
 */

import { mineFeatures } from "@/lib/live/features";

const BASE = "https://api.scraperapi.com/";

/** 30 days. A lease listing's own words don't change; only its
 *  availability does, and that comes from RentCast, not from here. */
export const ENRICH_REVALIDATE_SECONDS = 2_592_000;

/** Escalate to JS rendering when the cheap fetch yields no text.
 *  Set SCRAPERAPI_ALLOW_RENDER=0 to hard-cap spend at the cheap path. */
function renderAllowed(): boolean {
  return process.env.SCRAPERAPI_ALLOW_RENDER !== "0";
}

/** Why an enrichment attempt failed, in words the diagnostics can show. */
export class ScraperApiError extends Error {
  constructor(
    readonly reason:
      | "no-key"
      | "auth"
      | "quota"
      | "blocked"
      | "http"
      | "network",
    readonly status?: number
  ) {
    super(`ScraperAPI ${reason}${status ? ` (${status})` : ""}`);
    this.name = "ScraperApiError";
  }
}

/** Zillow's own search-by-address URL — the same link the app already
 *  shows on every card, so we read exactly the page a student would. */
export function listingSearchUrl(
  address: string,
  city: string,
  stateCode: string
): string {
  return `https://www.zillow.com/homes/for_rent/${encodeURIComponent(
    `${address}, ${city}, ${stateCode}`
  )}_rb/`;
}

/* ------------------------------------------------------------------ */
/* Extraction — several ways to find prose in a listing page           */
/* ------------------------------------------------------------------ */

/** Keys worth reading out of any embedded JSON blob. */
const DESCRIPTION_KEYS =
  /^(?:description|homeDescription|marketingRemarks|publicRemarks|remarks|overview|summary)$/i;

/** Pull every string sitting under a description-ish key, at any depth. */
function harvestDescriptions(value: unknown, depth = 0, out: string[] = []) {
  if (depth > 8 || out.length > 20) return out;
  if (Array.isArray(value)) {
    for (const v of value) harvestDescriptions(v, depth + 1, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && DESCRIPTION_KEYS.test(k) && v.length > 40) {
        out.push(v);
      } else {
        harvestDescriptions(v, depth + 1, out);
      }
    }
  }
  return out;
}

function scriptBodies(doc: string, matcher: RegExp): string[] {
  return [...doc.matchAll(matcher)].map((m) => m[1]).filter(Boolean);
}

function fromJsonLd(doc: string): string | null {
  const blobs = scriptBodies(
    doc,
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const found: string[] = [];
  for (const blob of blobs) {
    try {
      harvestDescriptions(JSON.parse(blob), 0, found);
    } catch {
      // A malformed blob is not a reason to abandon the others.
    }
  }
  return found.length > 0 ? found.join(" \n ") : null;
}

function fromEmbeddedState(doc: string): string | null {
  const blobs = scriptBodies(
    doc,
    /<script[^>]*id=["'](?:__NEXT_DATA__|hdpApolloPreloadedData)["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const found: string[] = [];
  for (const blob of blobs) {
    try {
      harvestDescriptions(JSON.parse(blob), 0, found);
    } catch {
      // Same: best effort, next strategy will try.
    }
  }
  return found.length > 0 ? found.join(" \n ") : null;
}

function fromMetaTags(doc: string): string | null {
  const metas = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{40,})["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{40,})["']/i,
  ];
  const found = metas.map((re) => doc.match(re)?.[1]).filter(Boolean);
  return found.length > 0 ? found.join(" \n ") : null;
}

function fromVisibleText(doc: string): string | null {
  const text = doc
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Enough to be a page, capped so a mine never walks a megabyte.
  return text.length > 200 ? text.slice(0, 20_000) : null;
}

/** Cheapest and most precise first; the last is a blunt fallback. */
const STRATEGIES: [string, (doc: string) => string | null][] = [
  ["json-ld", fromJsonLd],
  ["embedded-state", fromEmbeddedState],
  ["meta-description", fromMetaTags],
  ["visible-text", fromVisibleText],
];

/** Which strategy found readable prose, and how much — never the prose. */
export interface ExtractionOutcome {
  strategy: string | null;
  length: number;
}

export function extractListingText(
  doc: string
): { text: string; outcome: ExtractionOutcome } | null {
  // A JSON response (structured endpoint / autoparse) parses directly.
  const trimmed = doc.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const found = harvestDescriptions(JSON.parse(doc));
      if (found.length > 0) {
        const text = found.join(" \n ");
        return { text, outcome: { strategy: "json", length: text.length } };
      }
    } catch {
      // Not JSON after all — fall through to the HTML strategies.
    }
  }
  for (const [strategy, run] of STRATEGIES) {
    const text = run(doc);
    if (text) return { text, outcome: { strategy, length: text.length } };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

/** Credit spend, when ScraperAPI reports it on the response. */
function creditsFrom(res: Response): number | null {
  for (const header of ["sa-credit-cost", "x-credit-cost", "sa-credits-used"]) {
    const raw = res.headers.get(header);
    if (raw !== null && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

interface FetchOutcome {
  doc: string;
  credits: number | null;
  rendered: boolean;
}

/** One ScraperAPI call. The document it returns is a local everywhere it
 *  is used — see the module rule. */
async function scrape(
  targetUrl: string,
  render: boolean
): Promise<FetchOutcome> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new ScraperApiError("no-key");

  const params = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    country_code: "us",
  });
  if (render) params.set("render", "true");

  let res: Response;
  try {
    res = await fetch(`${BASE}?${params}`, {
      // Shared across every student for a month: the same address is
      // one vendor call no matter how many people surface it.
      next: { revalidate: ENRICH_REVALIDATE_SECONDS },
    });
  } catch {
    throw new ScraperApiError("network");
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ScraperApiError("auth", res.status);
    }
    if (res.status === 429) throw new ScraperApiError("quota", res.status);
    // ScraperAPI answers 500 when it exhausted its own retries upstream.
    if (res.status === 500) throw new ScraperApiError("blocked", res.status);
    throw new ScraperApiError("http", res.status);
  }

  return { doc: await res.text(), credits: creditsFrom(res), rendered: render };
}

/* ------------------------------------------------------------------ */
/* The public surface: flags only                                      */
/* ------------------------------------------------------------------ */

/** Everything this module will tell you about a listing. Note what is
 *  absent: the text it read to get here. */
export interface ListingFacts {
  features: string[];
  /** False when nothing readable came back — the caller must keep
   *  treating this listing's amenities as unknown, never as none. */
  featuresKnown: boolean;
  /** Diagnostics for the measurement probe; no listing content. */
  strategy: string | null;
  textLength: number;
  credits: number | null;
  rendered: boolean;
}

const UNKNOWN: ListingFacts = {
  features: [],
  featuresKnown: false,
  strategy: null,
  textLength: 0,
  credits: null,
  rendered: false,
};

/**
 * Read one listing page and return what it says about the property.
 *
 * Tries the cheap fetch first and escalates to JS rendering only when
 * the cheap one had nothing readable — on a protected, JS-rendered
 * target that is the difference between ~11 credits and several times
 * that, on every property.
 *
 * Throws only on transport and auth problems, which the route turns into
 * an honest reason. A page that simply had no prose is not a failure: it
 * returns featuresKnown false, which the UI already knows how to say.
 */
export async function describeListing(
  address: string,
  city: string,
  stateCode: string
): Promise<ListingFacts> {
  const url = listingSearchUrl(address, city, stateCode);

  let spent = 0;
  let attempt = await scrape(url, false);
  spent += attempt.credits ?? 0;
  let found = extractListingText(attempt.doc);

  if (!found && renderAllowed()) {
    attempt = await scrape(url, true);
    spent += attempt.credits ?? 0;
    found = extractListingText(attempt.doc);
  }

  if (!found) return { ...UNKNOWN, credits: spent || null, rendered: attempt.rendered };

  const mined = mineFeatures([found.text]);
  return {
    features: mined ?? [],
    featuresKnown: mined !== null,
    strategy: found.outcome.strategy,
    textLength: found.outcome.length,
    credits: spent || null,
    rendered: attempt.rendered,
  };
  // `found.text` goes out of scope here and is never persisted.
}
