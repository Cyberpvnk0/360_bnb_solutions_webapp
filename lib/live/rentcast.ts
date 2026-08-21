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
  };
}

/**
 * Active long-term rentals for one market, mapped and rent-sorted.
 * Throws on transport or auth failures — the route turns that into an
 * honest "preview data" fallback instead of empty-looking results.
 */
export async function fetchLiveRentals(
  market: Market
): Promise<RentalListing[]> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("RENTCAST_API_KEY is not configured");

  const params = new URLSearchParams({
    city: market.name,
    state: market.stateCode,
    status: "Active",
    limit: "500",
  });
  const res = await fetch(`${BASE}/listings/rental/long-term?${params}`, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
    // Per-market daily cache — the whole student base shares one request.
    next: { revalidate: LIVE_REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    throw new Error(`RentCast responded ${res.status}`);
  }
  const rows = (await res.json()) as RentCastListing[];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw) => mapRentCastListing(raw, market))
    .filter((l): l is RentalListing => l !== null)
    .sort((a, b) => a.rentMonthly - b.rentMonthly);
}
