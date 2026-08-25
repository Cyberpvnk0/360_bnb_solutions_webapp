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

/** Redfin guards its JSON with an XSSI prefix. */
function parseGuardedJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
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

  const target = `${AUTOCOMPLETE}?${new URLSearchParams({
    location: `${market.name}, ${market.stateCode}`,
    start: "0",
    count: "10",
    v: "2",
  })}`;

  let id: number | null = null;
  try {
    const res = await fetch(
      `${SCRAPER}?${new URLSearchParams({ api_key: key, url: target })}`,
      { next: { revalidate: CITY_ID_REVALIDATE_SECONDS } }
    );
    if (res.ok) {
      id = pickCandidate(
        extractCandidates(parseGuardedJson(await res.text())),
        market
      );
    }
  } catch {
    // An unreachable resolver is an unwired market, not an error to
    // propagate: the search above it already knows how to say so.
  }

  resolved.set(market.slug, id);
  return id;
}
