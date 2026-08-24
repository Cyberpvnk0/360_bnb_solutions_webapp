/**
 * RentCast — the live rental-listings feed behind Deal Finder.
 *
 * Server-side ONLY: the key lives in RENTCAST_API_KEY (.env.local /
 * deploy env) and every call goes through app/api/rentals, never the
 * browser. The free tier allows 50 requests a month, so responses cache
 * for a full day per market — one active market costs at most one
 * request a day no matter how many students browse it.
 *
 * Docs: https://developers.rentcast.io — GET /v1/listings/rental/long-term
 */

import { MARKETS } from "@/lib/mock/markets";
import type { Market, PropertyType, RentalListing } from "@/lib/mock/types";

const BASE = "https://api.rentcast.io/v1";
/** One day — quota-frugal and plenty fresh for lease hunting. */
export const LIVE_REVALIDATE_SECONDS = 86_400;

/** The RentCast fields this app reads (their payload carries more). */
export interface RentCastListing {
  id: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  price?: number;
  status?: string;
  daysOnMarket?: number;
  listedDate?: string;
  /** Some plans/feeds carry imagery; take it when it's there. */
  photos?: string[];
}

/** RentCast types → ours. Anything unmapped (Land, Manufactured, …) is
 *  skipped — those aren't arbitrage units. */
const PROPERTY_TYPE_MAP: Record<string, PropertyType> = {
  "Single Family": "house",
  Condo: "condo",
  Townhouse: "townhome",
  Apartment: "apartment",
  "Multi-Family": "apartment",
};

/**
 * One RentCast row → our RentalListing, or null when it can't be used
 * (no rent, no coordinates, or a type operators don't lease). Live rows
 * carry no feature tags yet — RentCast doesn't ship descriptions on this
 * endpoint — so keyword search matches address, market, and home type.
 */
export function mapRentCastListing(
  raw: RentCastListing,
  market: Market
): RentalListing | null {
  const propertyType = raw.propertyType
    ? PROPERTY_TYPE_MAP[raw.propertyType]
    : undefined;
  if (!propertyType) return null;
  if (!raw.price || raw.price <= 0) return null;
  if (typeof raw.latitude !== "number" || typeof raw.longitude !== "number") {
    return null;
  }
  // No bedroom data → skip rather than invent; studios count as 1 bd.
  if (raw.bedrooms === undefined || raw.bedrooms === null) return null;
  const bedrooms = Math.min(5, Math.max(1, Math.round(raw.bedrooms)));

  return {
    id: `live--${raw.id}`,
    analysisId: `r--live--${raw.id}`,
    address: raw.addressLine1 ?? raw.formattedAddress ?? "Address on file",
    city: raw.city ?? market.name,
    stateCode: raw.state ?? market.stateCode,
    marketSlug: market.slug,
    lat: raw.latitude,
    lon: raw.longitude,
    bedrooms,
    bathrooms: raw.bathrooms && raw.bathrooms > 0 ? raw.bathrooms : 1,
    sqft: raw.squareFootage && raw.squareFootage > 0 ? raw.squareFootage : 0,
    propertyType,
    rentMonthly: Math.round(raw.price),
    daysOnMarket: Math.max(0, Math.round(raw.daysOnMarket ?? 0)),
    petFriendly: false,
    features: [],
    photoUrl: raw.photos?.[0],
  };
}

/** Why a live fetch failed, in words the UI can show a student. */
export class RentCastError extends Error {
  constructor(
    readonly reason: "no-key" | "auth" | "quota" | "http" | "network",
    readonly status?: number
  ) {
    super(`RentCast ${reason}${status ? ` (${status})` : ""}`);
    this.name = "RentCastError";
  }
}

/** Raw RentCast call — daily-cached per unique query so the whole
 *  student base shares one request. Throws RentCastError so the route
 *  can tell "bad key" from "out of quota" from "network". */
async function rcListings(
  query: Record<string, string>
): Promise<RentCastListing[]> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new RentCastError("no-key");
  const params = new URLSearchParams({
    ...query,
    status: "Active",
    limit: "500",
  });

  let res: Response;
  try {
    res = await fetch(`${BASE}/listings/rental/long-term?${params}`, {
      headers: { "X-Api-Key": key, Accept: "application/json" },
      next: { revalidate: LIVE_REVALIDATE_SECONDS },
    });
  } catch {
    throw new RentCastError("network");
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new RentCastError("auth", res.status);
    }
    if (res.status === 429) throw new RentCastError("quota", res.status);
    throw new RentCastError("http", res.status);
  }

  const body: unknown = await res.json().catch(() => null);
  // RentCast returns a bare array; an object here means an error payload.
  return Array.isArray(body) ? (body as RentCastListing[]) : [];
}

function toSortedListings(
  rows: RentCastListing[],
  market: Market
): RentalListing[] {
  return rows
    .map((raw) => mapRentCastListing(raw, market))
    .filter((l): l is RentalListing => l !== null)
    .sort((a, b) => a.rentMonthly - b.rentMonthly);
}

/** A metro is bigger than its postal city name — Jacksonville includes
 *  the beaches and Orange Park. Radius search covers the whole market. */
const MARKET_RADIUS_MILES = 30;

/**
 * Active long-term rentals across one market's whole metro area
 * (center + radius, so suburbs and beach towns with their own postal
 * names are included), mapped and rent-sorted. Throws on transport or
 * auth failures — the route turns that into an honest "preview data"
 * fallback instead of empty-looking results.
 */
export async function fetchLiveRentals(
  market: Market
): Promise<RentalListing[]> {
  const rows = await rcListings({
    latitude: String(market.lat),
    longitude: String(market.lon),
    radius: String(MARKET_RADIUS_MILES),
  });
  return toSortedListings(rows, market);
}

/** Closest covered market to a point — equirectangular approximation is
 *  plenty at metro scale. Anchors a ZIP search's cushion math and its
 *  analyzer handoff to the market the ZIP actually sits in. */
export function nearestMarket(lat: number, lon: number): Market {
  let best = MARKETS[0];
  let bestD = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const m of MARKETS) {
    const dLat = m.lat - lat;
    const dLon = (m.lon - lon) * cosLat;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/**
 * Active rentals for one ZIP code — RentCast queries ZIPs natively, so
 * this covers areas between our named markets too. The nearest covered
 * market supplies the ADR/occupancy context for cushion figures.
 */
export async function fetchLiveRentalsByZip(zip: string): Promise<{
  market: Market | null;
  /** Mean position of the ZIP's listings — the map's camera target. */
  center: { lat: number; lon: number } | null;
  listings: RentalListing[];
}> {
  const rows = await rcListings({ zipCode: zip });
  const located = rows.filter(
    (r) => typeof r.latitude === "number" && typeof r.longitude === "number"
  );
  if (located.length === 0) return { market: null, center: null, listings: [] };
  const center = {
    lat: located.reduce((s, r) => s + r.latitude!, 0) / located.length,
    lon: located.reduce((s, r) => s + r.longitude!, 0) / located.length,
  };
  const market = nearestMarket(center.lat, center.lon);
  return { market, center, listings: toSortedListings(rows, market) };
}
