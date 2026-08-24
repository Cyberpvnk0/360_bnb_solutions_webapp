/**
 * Client access to amenity enrichment.
 *
 * Live rental feeds ship no amenity data, so the flags behind the
 * Furnished filter are read from the listing's own page on demand. What
 * crosses this boundary is flags — never the prose they were mined from
 * (see the rule at the top of lib/live/scraperapi).
 */

import type { RentalListing } from "@/lib/mock/types";

export type EnrichFailureReason =
  | "no-key"
  | "auth"
  | "quota"
  | "blocked"
  | "http"
  | "network"
  | "bad-request"
  /** This app's own daily ceiling on properties read. */
  | "daily-cap";

export interface EnrichResult {
  ok: boolean;
  /** Feature flags by listing id, for merging onto rows on screen. */
  facts: Record<string, { features: string[]; featuresKnown: boolean }>;
  attempted: number;
  resolved: number;
  reason?: EnrichFailureReason;
  remaining?: number;
  cap?: number;
}

const EMPTY = { facts: {}, attempted: 0, resolved: 0 };

/** Read the listing pages for these rows and return their feature flags.
 *  Never throws: a failed lookup leaves rows unknown, which the filter
 *  already handles honestly. */
export async function enrichListings(
  listings: readonly Pick<
    RentalListing,
    "id" | "address" | "city" | "stateCode"
  >[]
): Promise<EnrichResult> {
  if (listings.length === 0) return { ok: true, ...EMPTY };
  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: listings.map((l) => ({
          id: l.id,
          address: l.address,
          city: l.city,
          stateCode: l.stateCode,
        })),
      }),
    });
    const data = (await res.json().catch(() => null)) as EnrichResult | null;
    if (res.ok && data?.ok) return { ...EMPTY, ...data };
    return {
      ok: false,
      ...EMPTY,
      reason: data?.reason ?? "network",
      remaining: data?.remaining,
      cap: data?.cap,
    };
  } catch {
    return { ok: false, ...EMPTY, reason: "network" };
  }
}

/** Plain-language explanation of an enrichment miss, for the toolbar. */
export function enrichFailureLabel(reason?: EnrichFailureReason): string {
  switch (reason) {
    case "no-key":
      return "Amenity lookup isn't configured";
    case "auth":
      return "Amenity lookup key rejected";
    case "quota":
      return "Amenity lookup quota reached";
    case "blocked":
      return "Listing pages wouldn't load";
    case "daily-cap":
      return "Daily amenity-lookup limit reached";
    default:
      return "Amenity lookup unreachable";
  }
}
