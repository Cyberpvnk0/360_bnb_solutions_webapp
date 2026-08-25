/**
 * Client access to Redfin's furnished rentals.
 *
 * The Furnished filter is answered here rather than by reading listing
 * prose: Redfin applies its own furnished filter server-side, so every
 * row that comes back is furnished because they say so. One request per
 * market, cached a day and shared by every user.
 */

import type { RentalListing } from "@/lib/mock/types";

export type RedfinFailureReason =
  | "no-key"
  /** This market has no Redfin city id yet — not an error, a gap. */
  | "no-city"
  | "auth"
  | "forbidden"
  | "quota"
  | "http"
  | "network"
  | "unknown-market"
  | "daily-cap";

export interface RedfinResult {
  live: boolean;
  asOf?: string;
  reason?: RedfinFailureReason;
  listings: RentalListing[];
  remaining?: number;
  cap?: number;
}

const EMPTY: RentalListing[] = [];

/** Furnished rentals for one market. Never throws: a miss leaves the
 *  caller to say why, not to show the wrong inventory. */
export async function getRedfinFurnished(
  marketSlug: string
): Promise<RedfinResult> {
  try {
    const res = await fetch(
      `/api/redfin?market=${encodeURIComponent(marketSlug)}&furnished=1`
    );
    const data = (await res.json().catch(() => null)) as
      | (RedfinResult & { listings?: RentalListing[] })
      | null;
    if (res.ok && data?.live && Array.isArray(data.listings)) {
      return { ...data, listings: data.listings };
    }
    return {
      live: false,
      reason: data?.reason ?? "network",
      listings: EMPTY,
      remaining: data?.remaining,
      cap: data?.cap,
    };
  } catch {
    return { live: false, reason: "network", listings: EMPTY };
  }
}

/** Plain-language explanation of a Redfin miss, for the toolbar. */
export function redfinFailureLabel(reason?: RedfinFailureReason): string {
  switch (reason) {
    case "no-city":
      return "Couldn't identify this city on Redfin";
    case "no-key":
      return "Furnished search isn't configured";
    case "auth":
    case "forbidden":
      return "Furnished search key rejected";
    case "quota":
      return "Furnished search quota reached";
    case "daily-cap":
      return "Daily furnished-search limit reached";
    default:
      return "Furnished search unreachable";
  }
}
