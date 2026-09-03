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

import { mineFeatures } from "@/lib/live/features";
import { MARKETS } from "@/lib/mock/markets";
import type {
  ListingContact,
  Market,
  PropertyType,
  RentalListing,
} from "@/lib/mock/types";

const BASE = "https://api.rentcast.io/v1";
/** One day — quota-frugal and plenty fresh for lease hunting. */
export const LIVE_REVALIDATE_SECONDS = 86_400;

/** The RentCast fields this app reads (their payload carries more). */
export interface RentCastListing {
  id: string;
  formattedAddress?: string;
  addressLine1?: string;
  /** The unit, on the seventy per cent of rows that have one. Dropping
   *  it renders every flat in a block as the same street address. */
  addressLine2?: string;
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
  listingAgent?: { name?: string; phone?: string; email?: string };
  listingOffice?: { name?: string; phone?: string; email?: string };
  /** Amenity/description fields, when a plan or endpoint carries them. */
  description?: string;
  remarks?: string;
  publicRemarks?: string;
  amenities?: string[] | string;
  features?: string[] | string;
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
 * (no rent, no coordinates, or a type operators don't lease). Feature
 * tags are mined from whatever descriptive text the payload carries;
 * when it carries none, `featuresKnown` is false and the UI disables
 * feature filters rather than reporting a false zero.
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
  const mined = featuresFromFeed(raw);

  return {
    // The market slug rides inside the id so a server render can
    // re-resolve this listing from the cached feed — that's what makes
    // "Run the numbers" work on a live row after a page navigation.
    id: `live--${market.slug}--${raw.id}`,
    analysisId: `r--live--${market.slug}--${raw.id}`,
    address: addressOf(raw),
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
    petFriendly: mined?.includes("Pet friendly") ?? false,
    features: mined ?? [],
    // False means the feed told us nothing about amenities — the UI
    // disables feature filters rather than reporting a false zero.
    featuresKnown: mined !== null,
    description:
      raw.description ?? raw.remarks ?? raw.publicRemarks ?? undefined,
    contact: contactFromFeed(raw),
  };
}

/**
 * The address as a person would write it, unit included.
 *
 * A complex sends one row per available flat and puts the street on
 * line one and the unit on line two. Reading only line one renders
 * eight distinct units as eight cards that all say "3500 Greystone Dr"
 * with the same beds, baths and floor area — the same floor plan
 * repeated, which is exactly what a block of flats is — and there is
 * nothing on the card to tell them apart or to tell a genuine repeat
 * from a real neighbour.
 *
 * Line two alone is never an address: "Apt 1024" without a street is
 * worse than the formatted fallback.
 */
export function addressOf(raw: RentCastListing): string {
  const line1 = raw.addressLine1?.trim();
  const line2 = raw.addressLine2?.trim();
  if (!line1) return raw.formattedAddress?.trim() || "Address on file";
  return line2 ? `${line1} ${line2}` : line1;
}

/**
 * Feature tags mined from whatever descriptive text the feed provides,
 * through the one shared miner — so "Furnished" means the same thing
 * here as it does on a scraped page. Null when the payload carried no
 * amenity or description field at all: an empty tag list would read as
 * "this rental has none of these", a different and unearned claim.
 */
export function featuresFromFeed(raw: RentCastListing): string[] | null {
  const listed = [raw.amenities, raw.features]
    .flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []))
    .filter((v): v is string => typeof v === "string");
  return mineFeatures([
    ...listed,
    raw.description,
    raw.remarks,
    raw.publicRemarks,
  ]);
}

/** The feed's own agent/office, when it carries one — never invented:
 *  a made-up phone number on a real address would be worse than none. */
function contactFromFeed(raw: RentCastListing): ListingContact | undefined {
  const agent = raw.listingAgent;
  const office = raw.listingOffice;
  const name = agent?.name ?? office?.name;
  if (!name) return undefined;
  return {
    name,
    company: agent?.name ? office?.name : undefined,
    phone: agent?.phone ?? office?.phone,
    email: agent?.email ?? office?.email,
    role: "Listing agent",
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

/**
 * What makes two rows the same property to somebody hunting.
 *
 * Not the vendor's record id: a relisted unit and the same unit
 * carried by two agents arrive as different ids and identical
 * properties. With the unit number now on the address, two rows
 * agreeing on all of this are the same flat at the same price, and a
 * second card for it is noise on a page somebody is scanning.
 */
function identity(l: RentalListing): string {
  return [
    l.address.toLowerCase(),
    l.bedrooms,
    l.bathrooms,
    l.sqft,
    l.rentMonthly,
  ].join("|");
}

function toSortedListings(
  rows: RentCastListing[],
  market: Market
): RentalListing[] {
  const seen = new Set<string>();
  return rows
    .map((raw) => mapRentCastListing(raw, market))
    .filter((l): l is RentalListing => l !== null)
    .filter((l) => {
      const key = identity(l);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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

/**
 * The vendor's rows exactly as they arrive — for the setup diagnostic
 * only, never for rendering. Shares a Data-Cache entry with
 * fetchLiveRentals (identical URL and revalidate), so probing a market
 * already searched today costs no extra vendor request.
 */
export async function fetchRawRentals(
  market: Market
): Promise<RentCastListing[]> {
  return rcListings({
    latitude: String(market.lat),
    longitude: String(market.lon),
    radius: String(MARKET_RADIUS_MILES),
  });
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
