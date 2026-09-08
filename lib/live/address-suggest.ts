/**
 * Address suggestions as somebody types.
 *
 * The Census geocoder this replaces matches WHOLE addresses: "2625
 * Pintail" returned nothing until the city and state were typed too,
 * which on screen read as a search box that does not work. Suggesting
 * needs a service built for prefixes. Three are tried in order, and
 * the first that answers wins:
 *
 *  1. Mapbox Geocoding v6 with autocomplete on — one call returns up to
 *     five addresses with street, city, state, ZIP AND coordinates, so
 *     picking one costs nothing more. 100k requests a month free.
 *  2. Google Places Autocomplete — text only (no ZIP, no coordinates),
 *     so a pick is followed by one geocode to place it. Billed per
 *     request, and the Places API (New) has to be enabled on the key.
 *  3. Census — whole-address matches only, free, always there.
 *
 * Every provider is wrapped: a key that is not enabled, a network
 * error or a malformed payload moves to the next, never to a blank
 * list with no reason. A daily ceiling bounds the billed providers so
 * a runaway loop cannot buy more than a day's worth of keystrokes.
 */

import { mapboxToken } from "@/lib/live/aerial";
import { googleMapsKey } from "@/lib/live/street-view";
import { geocodeCandidates, type Point } from "@/lib/live/geocode";

export type SuggestSource = "mapbox" | "google" | "census";

export interface AddressSuggestion {
  /** One line: "2625 Pintail Dr, Columbia, SC 29229". */
  address: string;
  street: string;
  city: string;
  state: string;
  /** Empty when the provider does not publish it (Google predictions). */
  zip: string;
  /** Where it is — null when the provider is text-only and a pick has
   *  to be geocoded afterwards. */
  point: Point | null;
  source: SuggestSource;
}

export const MAX_SUGGESTIONS = 5;
/** Below this the input is a street number and nothing else. */
export const MIN_QUERY = 3;

/* ------------------------------------------------------------------ */
/* Daily ceiling on the billed providers                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_SUGGEST_DAILY_CAP = 20_000;

let dayKey = "";
let spent = 0;

function suggestCap(): number {
  const raw = Number(process.env.SUGGEST_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SUGGEST_DAILY_CAP;
}

/** One billed request against today's ceiling. False when it is spent. */
function reserveBilled(now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    spent = 0;
  }
  if (spent >= suggestCap()) return false;
  spent += 1;
  return true;
}

/** Tests only. */
export function resetSuggestLedger(): void {
  dayKey = "";
  spent = 0;
}

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "2625 Pintail Dr, Columbia, SC 29229" from its parts, skipping blanks. */
export function formatAddressLine(parts: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): string {
  const tail = [parts.state, parts.zip].filter(Boolean).join(" ");
  return [parts.street, parts.city, tail].filter(Boolean).join(", ");
}

/** "2625 PINTAIL DR" → "2625 Pintail Dr"; state codes are left alone by
 *  the caller. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    // Ordinals and directions read better the way the post office writes them.
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, n, suf) => `${n}${suf.toLowerCase()}`)
    .replace(/\b(Ne|Nw|Se|Sw)\b/g, (m) => m.toUpperCase());
}

/** A Mapbox v6 feature into a suggestion, or null when it is not an
 *  address with a usable point. */
export function fromMapboxFeature(raw: unknown): AddressSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as {
    properties?: {
      name?: unknown;
      full_address?: unknown;
      feature_type?: unknown;
      coordinates?: { latitude?: unknown; longitude?: unknown };
      context?: {
        place?: { name?: unknown };
        locality?: { name?: unknown };
        region?: { region_code?: unknown; name?: unknown };
        postcode?: { name?: unknown };
      };
    };
    geometry?: { coordinates?: unknown };
  };
  const p = f.properties;
  if (!p) return null;
  if (p.feature_type && p.feature_type !== "address") return null;

  const street = str(p.name);
  const city = str(p.context?.place?.name) || str(p.context?.locality?.name);
  const state = str(p.context?.region?.region_code) || str(p.context?.region?.name);
  const zip = str(p.context?.postcode?.name);

  let lat = p.coordinates?.latitude;
  let lon = p.coordinates?.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") {
    const c = f.geometry?.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      lon = c[0];
      lat = c[1];
    }
  }
  const point =
    typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : null;

  if (!street || !point) return null;
  return {
    address: formatAddressLine({ street, city, state, zip }),
    street,
    city,
    state,
    zip,
    point,
    source: "mapbox",
  };
}

/** A Google Places (New) prediction into a suggestion. Text only: the
 *  point is resolved when it is picked. */
export function fromGooglePrediction(raw: unknown): AddressSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const pp = (raw as { placePrediction?: Record<string, unknown> }).placePrediction;
  if (!pp) return null;
  const sf = pp.structuredFormat as
    | { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } }
    | undefined;
  const street = str(sf?.mainText?.text);
  // "Columbia, SC, USA" — city, state, country. The country is ours to
  // drop; the ZIP is not in a prediction at all.
  const secondary = str(sf?.secondaryText?.text)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^(usa|united states)$/i.test(s));
  const city = secondary[0] ?? "";
  const state = secondary[1] ?? "";
  if (!street) return null;
  return {
    address: formatAddressLine({ street, city, state, zip: "" }),
    street,
    city,
    state,
    zip: "",
    point: null,
    source: "google",
  };
}

/** A Census normalised address ("2625 PINTAIL DR, COLUMBIA, SC, 29229")
 *  and its point into a suggestion. */
export function fromCensusCandidate(candidate: {
  address: string;
  point: Point;
}): AddressSuggestion {
  const parts = candidate.address.split(",").map((s) => s.trim());
  const [rawStreet = "", rawCity = "", rawState = "", rawZip = ""] = parts;
  const street = titleCase(rawStreet);
  const city = titleCase(rawCity);
  const state = rawState.toUpperCase();
  const zip = rawZip.replace(/\D/g, "").slice(0, 5);
  return {
    address: formatAddressLine({ street, city, state, zip }),
    street,
    city,
    state,
    zip,
    point: candidate.point,
    source: "census",
  };
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

const MAPBOX = "https://api.mapbox.com/search/geocode/v6/forward";
const PLACES = "https://places.googleapis.com/v1/places:autocomplete";
/** Keystrokes repeat across people; a day of sharing costs nothing. */
const REVALIDATE = 86_400;

async function viaMapbox(q: string, limit: number): Promise<AddressSuggestion[] | null> {
  const token = mapboxToken();
  if (!token) return null;
  if (!reserveBilled()) return null;
  const params = new URLSearchParams({
    q,
    autocomplete: "true",
    country: "us",
    types: "address",
    limit: String(limit),
    language: "en",
    access_token: token,
  });
  const res = await fetch(`${MAPBOX}?${params}`, {
    next: { revalidate: REVALIDATE },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`mapbox ${res.status}`);
  const body = (await res.json()) as { features?: unknown[] };
  return (body.features ?? [])
    .map(fromMapboxFeature)
    .filter((s): s is AddressSuggestion => s !== null)
    .slice(0, limit);
}

async function viaGooglePlaces(q: string, limit: number): Promise<AddressSuggestion[] | null> {
  const key = googleMapsKey();
  if (!key) return null;
  if (!reserveBilled()) return null;
  const res = await fetch(PLACES, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
    },
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ["us"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      languageCode: "en",
    }),
    next: { revalidate: REVALIDATE },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`places ${res.status}`);
  const body = (await res.json()) as { suggestions?: unknown[] };
  return (body.suggestions ?? [])
    .map(fromGooglePrediction)
    .filter((s): s is AddressSuggestion => s !== null)
    .slice(0, limit);
}

async function viaCensus(q: string, limit: number): Promise<AddressSuggestion[]> {
  const candidates = await geocodeCandidates(q, limit);
  return candidates.map(fromCensusCandidate);
}

/**
 * Up to `limit` addresses that start like `q`. Never throws.
 *
 * Providers are tried in order; one that is unconfigured, over budget,
 * erroring or empty hands to the next. Census is last and always runs,
 * so a complete address still resolves with every key missing.
 */
export async function suggestAddresses(
  q: string,
  limit = MAX_SUGGESTIONS
): Promise<AddressSuggestion[]> {
  const query = q.trim();
  if (query.length < MIN_QUERY) return [];
  const n = Math.max(1, Math.min(MAX_SUGGESTIONS, limit));

  for (const provider of [viaMapbox, viaGooglePlaces]) {
    try {
      const got = await provider(query, n);
      if (got && got.length > 0) return got;
    } catch (error) {
      // Named in the log so "suggestions stopped" has a cause; the
      // next provider still answers the person typing.
      console.warn(`[aircore] address suggestions: ${provider.name} failed:`, error);
    }
  }
  try {
    return await viaCensus(query, n);
  } catch {
    return [];
  }
}
