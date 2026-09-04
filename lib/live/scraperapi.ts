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

/**
 * Request tiers, cheapest first.
 *
 * A live run settled which of these is realistic: the standard tier was
 * served Zillow's anti-bot interstitial on 8 of 8 addresses, in ~210ms,
 * for 1 credit — the vendor never attempted a bypass because we never
 * asked for one. Starting there just spends a credit to be told no, so
 * the ladder starts at `premium`.
 */
export type ScrapeTier = "standard" | "premium" | "ultra";

const TIER_PARAMS: Record<ScrapeTier, Record<string, string>> = {
  standard: {},
  premium: { premium: "true" },
  // Last resort: heaviest proxies AND JS rendering, since Zillow builds
  // the description client-side.
  ultra: { ultra_premium: "true", render: "true" },
};

const TIER_ORDER: ScrapeTier[] = ["standard", "premium", "ultra"];

/** Where the ladder starts. Standard is pointless on a protected
 *  target; override with SCRAPERAPI_TIER if a cheaper one ever works. */
function startTier(): ScrapeTier {
  const raw = process.env.SCRAPERAPI_TIER as ScrapeTier | undefined;
  return raw && TIER_ORDER.includes(raw) ? raw : "premium";
}

/** How far the ladder may climb. `ultra` is many times the price of
 *  `premium`, so SCRAPERAPI_MAX_TIER is the spend ceiling. */
function maxTier(): ScrapeTier {
  const raw = process.env.SCRAPERAPI_MAX_TIER as ScrapeTier | undefined;
  return raw && TIER_ORDER.includes(raw) ? raw : "ultra";
}

function tiersToTry(): ScrapeTier[] {
  const from = TIER_ORDER.indexOf(startTier());
  const to = TIER_ORDER.indexOf(maxTier());
  return to < from ? [TIER_ORDER[from]] : TIER_ORDER.slice(from, to + 1);
}

export type ScraperApiReason =
  | "no-key"
  /** 401 — the key itself is wrong. */
  | "auth"
  /** 403 — the key is fine but the account may not do THIS. Kept apart
   *  from `auth` because "your key is wrong" sends you to fix a key that
   *  was working a minute earlier. */
  | "forbidden"
  | "quota"
  | "blocked"
  | "http"
  | "network";

/** Why an enrichment attempt failed, in words the diagnostics can show. */
export class ScraperApiError extends Error {
  constructor(
    readonly reason: ScraperApiReason,
    readonly status?: number,
    /** The vendor's own explanation, verbatim and bounded. This is their
     *  error copy, not listing content — and it is the difference
     *  between knowing why a tier was refused and guessing. */
    readonly detail?: string
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

/**
 * Templated text a portal serves about ANY address, as opposed to what
 * the lister wrote about this unit.
 *
 * This distinction is the difference between honesty and a lie. A
 * search page's SEO blurb ("… is a 2 bedroom, 1 bathroom apartment.
 * Zillow has 12 photos …") reads as perfectly good text to an extractor
 * and mines to zero features — which would be recorded as "we read this
 * listing and it has no amenities". It has amenities; we just never saw
 * its description. Boilerplate must therefore count as NOTHING FOUND,
 * so the row stays honestly unknown.
 */
const BOILERPLATE_MARKERS: RegExp[] = [
  /\bzillow has\b/i,
  /\bis a \d+ bed(?:room)?,? [\d.]+ bath/i,
  /\bview (?:detailed information|photos|listing photos)\b/i,
  /\bsee the estimate\b|\breview home details\b/i,
  /\bsearch (?:apartments|homes|rentals) for rent\b/i,
  /\buse our detailed filters\b/i,
  /\bfind your (?:next|perfect) (?:place|home|apartment)\b/i,
  /\bthe (?:zestimate|rent zestimate)\b/i,
  /\bcheck availability\b.*\bcontact (?:the )?(?:property|manager)\b/i,
  // A detail page's own generated summary: real facts about the unit,
  // but not a word the lister wrote.
  /\blisted for rent at \$/i,
  /\bview more property details\b/i,
  /\b\d+ beds?,? [\d.]+ baths?\b.{0,20}\bunit\b/i,
  /\bapartment unit listed for rent\b/i,
  /\bsquare feet\b.{0,40}\bis an? \d+ bed/i,
];

export function looksLikeBoilerplate(text: string): boolean {
  return BOILERPLATE_MARKERS.some((re) => re.test(text));
}

/**
 * Precise strategies only — each reads a field the page declares AS the
 * description.
 *
 * There used to be a "visible-text" fallback that stripped tags off the
 * whole document. A live run proved why that cannot stay: on a 686KB
 * Zillow page it mined the navigation and the SEO footer, and three
 * listings came back tagged "Pet friendly" and "Renovated" purely
 * because the page links to "Pet friendly apartments in Jacksonville".
 * A confident wrong tag is the one outcome worse than no tag, so a page
 * whose description we cannot locate precisely reports nothing found.
 */
const STRATEGIES: [string, (doc: string) => string | null][] = [
  ["json-ld", fromJsonLd],
  ["embedded-state", fromEmbeddedState],
  ["meta-description", fromMetaTags],
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
    // Boilerplate is not this listing's words — keep looking, and if
    // nothing else turns up, report nothing found rather than "read it,
    // has no amenities".
    if (text && !looksLikeBoilerplate(text)) {
      return { text, outcome: { strategy, length: text.length } };
    }
  }
  return null;
}

/**
 * An anti-bot interstitial rather than the page we asked for.
 *
 * Entities matter: a served challenge says "Press &amp; Hold", and a
 * pattern that only knows "&" reads it as an ordinary page. A challenge
 * arrives as a real HTTP 200 full of real words, so nothing downstream
 * can tell it apart — this test is the only thing standing between a
 * block screen and a listing tagged from its markup.
 */
export function isChallenge(doc: string): boolean {
  return /press\s*(?:&(?:amp;)?|and)\s*hold|px-captcha|perimeterx|captcha-delivery|(?:are|confirm) you (?:are )?a? ?human|verify you are (?:a )?human|unusual traffic/i.test(
    doc
  );
}

/** Punctuation-blind form, for comparing an address to a URL slug. */
function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The listing detail URL on this page that belongs to OUR address.
 *
 * A search page can list a whole street. Following the first link would
 * sooner or later read a neighbour's description and tag our unit
 * "Furnished" on the strength of it — a specific, plausible, wrong
 * claim, which is worse than no claim at all. So a link is followed only
 * when its slug carries both our house number and our street name;
 * anything less returns null and the row stays honestly unknown.
 */
export function detailUrlFor(doc: string, address: string): string | null {
  const houseNumber = address.match(/\b\d+\b/)?.[0];
  const streetWord = address
    .replace(/^\s*\d+\s*/, "")
    .match(/[A-Za-z]{3,}/)?.[0];
  if (!houseNumber || !streetWord) return null;

  const wantNumber = normalizeSlug(houseNumber);
  const wantStreet = normalizeSlug(streetWord);

  const paths = [
    ...doc.matchAll(
      /(?:https?:\/\/(?:www\.)?zillow\.com)?(\/homedetails\/[^"'\s\\<>]*?\d+_zpid\/?)/gi
    ),
  ].map((m) => m[1]);

  for (const path of paths) {
    const slug = normalizeSlug(path);
    if (slug.includes(wantNumber) && slug.includes(wantStreet)) {
      return `https://www.zillow.com${path}`;
    }
  }
  return null;
}

/**
 * Structural facts about a fetched page — booleans and sizes only, no
 * content. Enough to tell "we were served a search page" from "we were
 * served a challenge" from "the detail page is right there behind a
 * link", which is what decides how to fix an extraction that misses.
 */
export interface PageSignals {
  bytes: number;
  /** A link to a listing detail page — the two-hop route to real prose. */
  hasDetailLink: boolean;
  hasNextData: boolean;
  hasApollo: boolean;
  hasJsonLd: boolean;
  /** An anti-bot interstitial rather than the page we asked for. */
  looksLikeChallenge: boolean;
  /** Text was found but was templated portal copy. */
  boilerplate: boolean;
}

export function pageSignals(doc: string): PageSignals {
  const anyText = STRATEGIES.map(([, run]) => run(doc)).find(Boolean) ?? null;
  return {
    bytes: doc.length,
    hasDetailLink: /\/homedetails\/[^"'\s]*\d+_zpid/i.test(doc),
    hasNextData: /id=["']__NEXT_DATA__["']/i.test(doc),
    hasApollo: /hdpApolloPreloadedData/i.test(doc),
    hasJsonLd: /application\/ld\+json/i.test(doc),
    looksLikeChallenge: isChallenge(doc),
    boilerplate: anyText !== null && looksLikeBoilerplate(anyText),
  };
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
  tier: ScrapeTier;
}

/** One ScraperAPI call. The document it returns is a local everywhere it
 *  is used — see the module rule. */
async function scrape(
  targetUrl: string,
  tier: ScrapeTier
): Promise<FetchOutcome> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new ScraperApiError("no-key");

  const params = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    country_code: "us",
    ...TIER_PARAMS[tier],
  });

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
    // Read their explanation before deciding what to call this.
    const detail = (await res.text().catch(() => ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    if (res.status === 401) throw new ScraperApiError("auth", 401, detail);
    if (res.status === 403) throw new ScraperApiError("forbidden", 403, detail);
    if (res.status === 429) throw new ScraperApiError("quota", 429, detail);
    // ScraperAPI answers 500 when it exhausted its own retries upstream.
    if (res.status === 500) throw new ScraperApiError("blocked", 500, detail);
    throw new ScraperApiError("http", res.status, detail);
  }

  return { doc: await res.text(), credits: creditsFrom(res), tier };
}

/**
 * Fetch a page, climbing the tier ladder until one comes back that is
 * not an anti-bot interstitial.
 *
 * A challenge page is a FAILURE, never a source. It is a real HTTP 200
 * full of real words, and mining it is how a listing ends up tagged
 * from a block screen's markup. Returns null when every tier was
 * challenged — the caller then reports the row unknown.
 *
 * EXPORTED UNDER THE MODULE RULE, NOT AROUND IT. This hands back a
 * document, so any caller takes on the same obligation the rule states
 * for this file: the document is a local, and only facts come out of
 * the function that reads it. lib/live/redfin-contact is the one such
 * caller today, and it takes a name and a telephone number.
 */
async function readPage(url: string): Promise<{
  outcome: FetchOutcome;
  spent: number;
  challenged: boolean;
}> {
  let spent = 0;
  let last: FetchOutcome | null = null;
  let refusal: ScraperApiError | null = null;

  for (const tier of tiersToTry()) {
    let attempt: FetchOutcome;
    try {
      attempt = await scrape(url, tier);
    } catch (error) {
      // A tier the account can't use is a reason to try the NEXT tier,
      // not to abandon the read. Throwing here is what made a 403 on
      // `premium` look like a dead key and stopped the ladder before
      // `ultra` was ever tried.
      if (
        error instanceof ScraperApiError &&
        (error.reason === "forbidden" || error.reason === "http")
      ) {
        refusal = error;
        continue;
      }
      throw error;
    }
    spent += attempt.credits ?? 0;
    last = attempt;
    if (!isChallenge(attempt.doc)) {
      return { outcome: attempt, spent, challenged: false };
    }
  }

  // Every tier refused outright and none returned a page to judge.
  if (!last && refusal) throw refusal;
  return { outcome: last!, spent, challenged: true };
}

/** readPage, for the one module outside this file that reads a listing
 *  page for facts of its own. Named so a grep for it lands on the rule
 *  above rather than on a generic fetcher. */
export const readListingPage = readPage;

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
  /** Which request tier finally answered — the cost driver. */
  tier: ScrapeTier;
  /** True when every tier was served an anti-bot interstitial. The row
   *  is unknown because we were refused, not because it said nothing. */
  blocked: boolean;
  /** Whether the search page led us to this listing's own page. */
  reachedDetail: boolean;
  /** Structural read of the last page fetched — how an extraction that
   *  missed gets diagnosed without ever quoting the page. */
  signals: PageSignals | null;
}

const UNKNOWN: ListingFacts = {
  features: [],
  featuresKnown: false,
  strategy: null,
  textLength: 0,
  credits: null,
  tier: "premium",
  blocked: false,
  reachedDetail: false,
  signals: null,
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
  let spent = 0;
  let reachedDetail = false;
  let tier: ScrapeTier = startTier();

  // Hop 1 — the search page. Not usually where the prose is; what it
  // reliably carries is a link to the listing's own page.
  const search = await readPage(listingSearchUrl(address, city, stateCode));
  spent += search.spent;
  tier = search.outcome.tier;
  let doc = search.outcome.doc;

  // A challenge is a dead end, not a document. Stop here rather than
  // mine a block screen or follow links out of one.
  if (search.challenged) {
    return {
      ...UNKNOWN,
      credits: spent || null,
      tier,
      blocked: true,
      signals: pageSignals(doc),
    };
  }

  let found = extractListingText(doc);

  // Hop 2 — the listing's own page, matched to our address so a
  // neighbour's copy can never be attributed to this unit.
  if (!found) {
    const detailUrl = detailUrlFor(doc, address);
    if (detailUrl) {
      const detail = await readPage(detailUrl);
      spent += detail.spent;
      tier = detail.outcome.tier;
      doc = detail.outcome.doc;
      reachedDetail = !detail.challenged;
      if (detail.challenged) {
        return {
          ...UNKNOWN,
          credits: spent || null,
          tier,
          blocked: true,
          reachedDetail: false,
          signals: pageSignals(doc),
        };
      }
      found = extractListingText(doc);
    }
  }

  const signals = pageSignals(doc);

  if (!found) {
    return {
      ...UNKNOWN,
      credits: spent || null,
      tier,
      reachedDetail,
      signals,
    };
  }

  const mined = mineFeatures([found.text]);
  return {
    features: mined ?? [],
    featuresKnown: mined !== null,
    strategy: found.outcome.strategy,
    textLength: found.outcome.length,
    credits: spent || null,
    tier,
    blocked: false,
    reachedDetail,
    signals,
  };
  // `found.text` goes out of scope here and is never persisted.
}
