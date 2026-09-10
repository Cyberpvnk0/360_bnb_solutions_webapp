/**
 * The whole short-let read for one listing, in one pass — and on the
 * analyzer's own footing.
 *
 * A card used to run the calculator on a two-bedroom benchmark's
 * costs and print the result as cash flow, while the page it opened
 * ran the same calculator on the analyzer's default inputs for that
 * property. Two derivations of one figure are two chances to disagree,
 * and they did. This builds the exact inputs the analyzer starts from
 * — the same seed, the same utilities, the asking rent — so a card's
 * net profit is the page's net profit, given the same market figures.
 *
 * The figures are the other half, and a read says which grain it has:
 * the property's own comps, the real listings around it, its city's
 * measured figures, or the catalogue's modelled ones.
 */

import { projectDeal, type DealInputs } from "./arbitrage";
import { addressAnalysisId } from "@/lib/live/address-analysis";
import { buildDefaultsFor, buildLtrCompsFor } from "@/lib/mock/analyses";
import { adrFactorFor } from "@/lib/mock/markets";
import type { Market, PropertyType, RentalListing } from "@/lib/mock/types";

/**
 * What a read stands on, finest grain first.
 *
 *   comps     the property's own comp set — an analysis has been run,
 *             by anyone, and these are the analyzer's exact figures,
 *             kept until a newer analysis replaces them.
 *   nearby    real listings within two miles of the property, from
 *             the market's comp pool: the set the analyzer would buy
 *             for it, mimicked (lib/live/comp-pool).
 *   zip       the feed's measured figures for the property's ZIP.
 *   city      the feed's measured figures for the whole city, corrected
 *             by what the city's analyses stood on.
 *   pending   measured figures are being fetched; a card shows nothing
 *             rather than a number about to change.
 *   modelled  the seeded catalogue's figures: plausible and invented.
 *             Only when the feed has nothing for the area.
 */
export type DealBasisKind = "comps" | "nearby" | "zip" | "city" | "pending" | "modelled";

export interface DealBasis {
  kind: DealBasisKind;
  /** The area the figures cover — a ZIP, a city — or null for comps. */
  area: string | null;
  /** The occupancy the read assumed, as a fraction. */
  occupancy: number;
  /** When the figures were measured, ISO; null for modelled. */
  at: string | null;
  /** How many listings the figures stand on, where they are listings. */
  comps?: number;
  /** How far those listings reach, in miles; null when unbounded. */
  radiusMiles?: number | null;
}

/** Measured figures for a read. `adr` is this size's own nightly rate
 *  on the comps and nearby grains, and on an area grain marked `sized`;
 *  the area's average across sizes otherwise. */
export interface DealFigures {
  adr: number;
  occupancy: number;
  kind: Exclude<DealBasisKind, "pending" | "modelled">;
  area: string | null;
  at: string | null;
  comps?: number;
  radiusMiles?: number | null;
  /** True when an area's `adr` is already this size's rate — measured
   *  or scaled on the server — and is not to be scaled again here. */
  sized?: boolean;
}

export interface DealRead {
  /** Whole points: the market's occupancy minus this rent's breakeven. */
  cushionPts: number;
  /** Dollars a month after every cost the analyzer starts with, at
   *  the figures' occupancy: the net profit projection. */
  netCashFlow: number;
  /** What a night goes for here, at this unit's bedroom count. */
  nightlyRate: number;
  /** The share of nights that only pays the bills, as a fraction. */
  breakeven: number;
  /** What the figures above stand on. */
  basis: DealBasis;
}

/**
 * The analyzer's own starting inputs for this listing — the same id,
 * the same seed, the same asking rent — so a card's net is the page's.
 */
export function defaultsForListing(listing: RentalListing, market: Market): DealInputs {
  // The type travels to the analyzer only when the listing stated it;
  // a filtering stand-in arrives there as a house.
  const propertyType: PropertyType =
    listing.propertyTypeKnown === false ? "house" : listing.propertyType;
  const id = addressAnalysisId({
    address: listing.address,
    lat: listing.lat,
    lon: listing.lon,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    propertyType,
  });
  const ltrComps = buildLtrCompsFor(market, listing.bedrooms, id);
  return buildDefaultsFor(ltrComps, listing.bedrooms, id, listing.rentMonthly);
}

/**
 * The read for one listing, from measured figures when there are any.
 *
 * The property's own comps and the listings around it are already
 * this size's rate, and so is an area's rate marked `sized` — the
 * market's rate for this size, worked out on the server. An area's
 * plain average is across every size and is scaled to this one the
 * way the catalogue's benchmark always was. Without figures the
 * catalogue's modelled ones stand in, and the read says so.
 */
export function estimateDeal(
  listing: RentalListing,
  market: Market,
  figures: DealFigures | null = null,
  opts: { pending?: boolean } = {}
): DealRead {
  const ownRate =
    figures?.kind === "comps" || figures?.kind === "nearby" || figures?.sized === true;
  const nightlyRate = figures
    ? ownRate
      ? Math.round(figures.adr)
      : Math.round(figures.adr * adrFactorFor(listing.bedrooms))
    : Math.round(market.adr * adrFactorFor(listing.bedrooms));
  const occupancy = figures ? figures.occupancy : market.occupancy;
  const projection = projectDeal(defaultsForListing(listing, market), {
    adr: nightlyRate,
    marketOccupancy: occupancy,
  });
  const basis: DealBasis = figures
    ? {
        kind: figures.kind,
        area: figures.area,
        occupancy,
        at: figures.at,
        ...(figures.comps !== undefined ? { comps: figures.comps } : {}),
        ...(figures.radiusMiles !== undefined ? { radiusMiles: figures.radiusMiles } : {}),
      }
    : { kind: opts.pending ? "pending" : "modelled", area: market.name, occupancy, at: null };
  return {
    cushionPts: Math.round(projection.marginOfSafety * 100),
    netCashFlow: Math.round(projection.netCashFlow),
    nightlyRate,
    breakeven: projection.breakevenOccupancy,
    basis,
  };
}

/** One line saying what a read stands on, for a title or a caption. */
export function basisLabel(basis: DealBasis): string {
  const occ = `${Math.round(basis.occupancy * 100)}% occupancy`;
  const reach = basis.radiusMiles ? ` within ${basis.radiusMiles} mi` : "";
  switch (basis.kind) {
    case "comps":
      return `Analyzed${basis.comps ? ` (${basis.comps} listings${reach})` : ""} · ${occ}`;
    case "nearby":
      return `Nearby listings${basis.comps ? ` (${basis.comps}${reach})` : ""} · ${occ}`;
    case "zip":
      return `Measured for ZIP ${basis.area ?? ""} · ${occ}`;
    case "city":
      return `Measured for ${basis.area ?? "the market"} · ${occ}`;
    case "pending":
      return "Measuring this area…";
    default:
      return `Modelled for ${basis.area ?? "the market"} · ${occ} · no measured figures yet`;
  }
}
