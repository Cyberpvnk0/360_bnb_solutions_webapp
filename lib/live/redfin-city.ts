/**
 * Redfin city ids.
 *
 * Redfin addresses a city by an opaque number in its URL path
 * (`/city/8907/FL/Jacksonville/rentals`) that cannot be derived from the
 * name. Without one, a market simply has no Redfin search — and the
 * failure mode to avoid is not "no results", it is confidently showing
 * Jackson, Mississippi's rentals under Jacksonville, Florida.
 *
 * So resolution is lazy and VERIFIED: ask Redfin's own location
 * autocomplete, then refuse any answer whose name and state don't match
 * the market we asked about. A market we can't resolve keeps saying so.
 *
 * Ids never change, so a resolved one is cached for a year and every
 * later search rides it for free.
 */

import type { Market } from "@/lib/mock/types";

const AUTOCOMPLETE =
  "https://www.redfin.com/stingray/do/location-autocomplete";
const SCRAPER = "https://api.scraperapi.com/";

/** A city id is permanent; only a redeploy should ever re-ask. */
export const CITY_ID_REVALIDATE_SECONDS = 31_536_000;

/**
 * Request tiers for the autocomplete call.
 *
 * The structured Redfin endpoints handle bot protection internally,
 * which is why the search and listing calls need nothing. This one goes
 * through ScraperAPI's PLAIN endpoint, and redfin.com is a protected
 * domain there: the standard tier answers with "Protected domains may
 * require adding premium=true OR ultra_premium=true".
 *
 * Trying standard first costs nothing — ScraperAPI states plainly that
 * a failed request is not charged — so the ladder starts cheap and only
 * climbs when it has to.
 */
const TIERS: { name: string; params: Record<string, string> }[] = [
  { name: "standard", params: {} },
  { name: "premium", params: { premium: "true" } },
  { name: "ultra", params: { ultra_premium: "true" } },
];

/**
 * Known ids, seeded from real URLs. A static entry costs nothing and is
 * always preferred; everything else resolves on first use.
 */
export const REDFIN_CITY_ID: Record<string, number> = {
  jacksonville: 8907,
};

/** Comparable form: case, punctuation and "saint" all vary between
 *  our market names and Redfin's. */
export function normalizeCity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bst\.?\b/g, "saint")
    .replace(/\bft\.?\b/g, "fort")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Parse JSON behind an XSSI guard.
 *
 * Redfin prefixes its internal JSON with `{}&&`. Reaching for the first
 * `{` finds the guard's OWN empty object and hands JSON.parse the string
 * `{}&&{"version":…}`, which throws — so the payload silently became
 * null and every market resolved to "no confident match". The guard has
 * to be stripped as a guard, not searched past.
 */
const XSSI_GUARDS = [
  /^\{\}&&/,
  /^\)\]\}'?,?\s*/,
  /^for\s*\(\s*;\s*;\s*\)\s*;/,
  /^while\s*\(1\)\s*;/,
];

export function parseGuardedJson(text: string): unknown {
  let body = text.trim();
  for (const guard of XSSI_GUARDS) body = body.replace(guard, "").trim();
  try {
    return JSON.parse(body);
  } catch {
    // An unrecognised guard: fall back to the first brace that yields
    // valid JSON, rather than assuming the first brace is the payload.
    for (let i = body.indexOf("{"); i >= 0; i = body.indexOf("{", i + 1)) {
      try {
        return JSON.parse(body.slice(i));
      } catch {
        continue;
      }
    }
    return null;
  }
}

interface Candidate {
  id: number;
  name: string;
  state: string;
}

/**
 * Every city-looking row in an autocomplete payload.
 *
 * Schema-tolerant by necessity — this is an internal endpoint with no
 * contract. Rows are recognised by carrying an id that looks like
 * `{type}_{number}` alongside a name, wherever they sit.
 */
export function extractCandidates(
  value: unknown,
  depth = 0,
  out: Candidate[] = []
): Candidate[] {
  if (depth > 8 || out.length > 60) return out;
  if (Array.isArray(value)) {
    for (const v of value) extractCandidates(v, depth + 1, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;

  const row = value as Record<string, unknown>;
  const rawId = row.id ?? row.rowId;
  const name =
    typeof row.name === "string"
      ? row.name
      : typeof row.city === "string"
        ? row.city
        : undefined;

  if (typeof rawId === "string" && name) {
    // "6_8907" — the trailing number is the city id.
    const id = Number(rawId.split("_").pop());
    if (Number.isFinite(id) && id > 0) {
      const state =
        typeof row.market === "string"
          ? row.market
          : typeof row.state === "string"
            ? row.state
            : typeof row.stateCode === "string"
              ? row.stateCode
              : "";
      out.push({ id, name, state });
    }
  }

  for (const v of Object.values(row)) extractCandidates(v, depth + 1, out);
  return out;
}

/**
 * The candidate that is unambiguously OUR city.
 *
 * A name match alone is not enough: Springfield exists in dozens of
 * states, and Jacksonville, FL and Jackson, MS are one fuzzy match
 * apart. Both the city and its state must line up, and the name is
 * compared whole rather than by prefix.
 */
export function pickCandidate(
  candidates: readonly Candidate[],
  market: Market
): number | null {
  const wantCity = normalizeCity(market.name);
  const wantState = market.stateCode.toLowerCase();

  for (const c of candidates) {
    if (normalizeCity(c.name) !== wantCity) continue;
    const haystack = `${c.name} ${c.state}`.toLowerCase();
    // The state has to appear as its own token, or "MI" matches "Miami".
    if (new RegExp(`\\b${wantState}\\b`).test(haystack)) return c.id;
  }
  return null;
}

/** Everything a failed resolution needs to explain itself. */
export interface CityIdProbe {
  cityId: number | null;
  autocompleteUrl: string;
  status: number | null;
  /** Which tier finally answered, and which were attempted. */
  tier?: string;
  tiersTried?: string[];
  parsed: boolean;
  bytes: number;
  /** First characters of the response, so an unrecognised XSSI guard or
   *  a block page is visible rather than guessed at. */
  head: string;
  candidates: Candidate[];
}

/**
 * Resolve, and report every step. Used by the setup probe so a null
 * answer distinguishes "blocked", "shape changed" and "matched nothing".
 */
export async function probeCityId(market: Market): Promise<CityIdProbe> {
  const autocompleteUrl = autocompleteFor(market);
  const empty: CityIdProbe = {
    cityId: null,
    autocompleteUrl,
    status: null,
    parsed: false,
    bytes: 0,
    head: "",
    candidates: [],
  };
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return empty;

  try {
    const { attempt, body, tried } = await fetchAutocomplete(
      autocompleteUrl,
      key
    );
    const candidates = extractCandidates(body);
    return {
      cityId: pickCandidate(candidates, market),
      autocompleteUrl,
      status: attempt.status,
      tier: attempt.tier,
      tiersTried: tried,
      parsed: body !== null,
      bytes: attempt.text.length,
      head: attempt.text.slice(0, 220),
      candidates: candidates.slice(0, 12),
    };
  } catch {
    return empty;
  }
}

interface Attempt {
  tier: string;
  status: number;
  text: string;
}

/** Climb the tiers until one returns something that parses. Returns the
 *  last attempt when none do, so the caller can report what happened. */
async function fetchAutocomplete(
  target: string,
  key: string
): Promise<{ attempt: Attempt; body: unknown; tried: string[] }> {
  const tried: string[] = [];
  let last: Attempt = { tier: "none", status: 0, text: "" };

  for (const tier of TIERS) {
    tried.push(tier.name);
    const params = new URLSearchParams({
      api_key: key,
      url: target,
      ...tier.params,
    });
    const res = await fetch(`${SCRAPER}?${params}`, {
      next: { revalidate: CITY_ID_REVALIDATE_SECONDS },
    });
    const text = await res.text();
    last = { tier: tier.name, status: res.status, text };
    if (!res.ok) continue;
    const body = parseGuardedJson(text);
    if (body !== null) return { attempt: last, body, tried };
  }
  return { attempt: last, body: null, tried };
}

function autocompleteFor(market: Market): string {
  return `${AUTOCOMPLETE}?${new URLSearchParams({
    location: `${market.name}, ${market.stateCode}`,
    start: "0",
    count: "10",
    v: "2",
  })}`;
}

/** Resolved this run, so one market never resolves twice per instance. */
const resolved = new Map<string, number | null>();

/** Tests only. */
export function resetCityIdCache(): void {
  resolved.clear();
}

/**
 * This market's Redfin city id, or null if we can't be sure of one.
 *
 * Null is a real answer: the caller reports that the market isn't wired
 * up rather than searching a city we merely hope is right.
 */
export async function cityIdFor(market: Market): Promise<number | null> {
  const seeded = REDFIN_CITY_ID[market.slug];
  if (seeded !== undefined) return seeded;
  const cached = resolved.get(market.slug);
  if (cached !== undefined) return cached;

  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return null;

  const target = autocompleteFor(market);

  let id: number | null = null;
  try {
    const { body } = await fetchAutocomplete(target, key);
    id = pickCandidate(extractCandidates(body), market);
  } catch {
    // An unreachable resolver is an unwired market, not an error to
    // propagate: the search above it already knows how to say so.
  }

  resolved.set(market.slug, id);
  return id;
}
