/**
 * Domain types shared by the mock data and the UI.
 * When real APIs land, these stay — only the generators in /lib/mock and
 * the fetchers in /lib/data get replaced.
 */

import type { TierId } from "@/config/app";
import type { DealInputs } from "@/lib/calc/arbitrage";

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

export type RegulationStatus =
  | "permitted"
  | "permit-required"
  | "banned"
  | "unverified";

export interface Regulation {
  status: RegulationStatus;
  /** One-sentence plain-language summary of the local rule. */
  note: string;
  /** Where the note came from and when it was last checked. */
  sourceNote: string;
}

/** One month of market performance for the 2-bedroom benchmark unit. */
export interface MarketMonth {
  /** YYYY-MM-01 */
  month: string;
  adr: number;
  /** Fraction, 0–1. */
  occupancy: number;
}

export interface BedroomAdr {
  bedrooms: number;
  adr: number;
  listings: number;
}

/** Rough setting of the market — drives the card banner art and the
 *  type label under the market name. */
export type MarketTerrain = "metro" | "coastal" | "mountain" | "desert";

export interface Market {
  slug: string;
  name: string;
  state: string;
  stateCode: string;
  terrain: MarketTerrain;
  lat: number;
  lon: number;
  /** Trailing-12-month ADR for the 2BR benchmark. */
  adr: number;
  /** Trailing-12-month occupancy, fraction. */
  occupancy: number;
  activeListings: number;
  /** Median asking rent for a long-term 2BR lease. */
  medianRent2br: number;
  /** Average breakeven occupancy for a 2BR at typical costs (fraction).
   *  Computed by the generator via lib/calc — never hand-set. */
  avgBreakeven2br: number;
  regulation: Regulation;
  /** Trailing 12 months, oldest first. */
  monthly: MarketMonth[];
  adrByBedroom: BedroomAdr[];
  /** Month-over-month change, as fractions of the prior month. */
  deltas: {
    adr: number;
    occupancy: number; // percentage-point change as fraction (e.g. +0.02)
    listings: number;
  };
}

/**
 * A submarket: a neighborhood or district inside a market (San Marco or
 * San Pablo inside Jacksonville). Lean by design — generated lazily per
 * market, no monthly series.
 */
export interface Submarket {
  /** Globally unique: `${marketSlug}--${slug}`. */
  id: string;
  slug: string;
  name: string;
  marketSlug: string;
  marketName: string;
  stateCode: string;
  lat: number;
  lon: number;
  adr: number;
  /** Fraction, whole-point precision. */
  occupancy: number;
  /** Listing counts of a market's submarkets sum EXACTLY to the parent. */
  activeListings: number;
  medianRent2br: number;
  /** Whole-point precision, via lib/calc. */
  avgBreakeven2br: number;
}

/* ------------------------------------------------------------------ */
/* Analyses (address pulls)                                            */
/* ------------------------------------------------------------------ */

export type PropertyType = "apartment" | "house" | "condo" | "townhome";

export interface StrComp {
  id: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  adr: number;
  /** Fraction, 0–1. */
  occupancy: number;
  distanceMiles: number;
}

export interface LtrComp {
  id: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  rent: number;
  sqft: number;
  distanceMiles: number;
  /** e.g. "Active listing" or "Leased 34 days ago". */
  status: string;
}

export interface Analysis {
  id: string;
  address: string;
  city: string;
  stateCode: string;
  marketSlug: string;
  bedrooms: number;
  bathrooms: number;
  propertyType: PropertyType;
  createdAt: string;
  /** The evidence behind the revenue projection. ADR and occupancy
   *  assumptions are derived from this set via lib/calc/comps. */
  strComps: StrComp[];
  /** The evidence behind the lease estimate. */
  ltrComps: LtrComp[];
  /** Seeded calculator defaults; rent comes from the LTR comp median. */
  defaults: DealInputs;
}

/* ------------------------------------------------------------------ */
/* Rental listings (Deal Finder)                                       */
/* ------------------------------------------------------------------ */

/** Who to call about a rental — the listing agent, the management
 *  company, or the owner. Preview inventory carries reserved 555-01xx
 *  numbers and example.com addresses; live rows carry the feed's own. */
export interface ListingContact {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  /** What this contact is, in the words the panel shows. */
  role: "Listing agent" | "Property manager" | "Owner";
}

/** A named collection of saved rentals — how a hunter organizes a
 *  browsing session into candidates worth a call. */
export interface DealList {
  id: string;
  name: string;
  createdAt: string;
  listings: RentalListing[];
}

/**
 * One long-term rental listing in the Deal Finder browser — rentals only,
 * never for-sale. Lean by design: generated lazily per market. Handing a
 * listing to the analyzer resolves `analysisId` into a full Analysis with
 * the same comp-backed consistency as a seeded pull.
 */
export interface RentalListing {
  /** Globally unique: `rl--${marketSlug}--${i}`. */
  id: string;
  /** The analysis this listing becomes on "Run the numbers":
   *  `r--${marketSlug}--${i}` — resolved lazily by lib/mock/analyses. */
  analysisId: string;
  address: string;
  /** The parent market's name. */
  city: string;
  stateCode: string;
  marketSlug: string;
  /** Neighborhood this sits in — preview inventory only; live rows
   *  carry the feed's own address instead. */
  submarketName?: string;
  lat: number;
  lon: number;
  bedrooms: number;
  /** 1–3 in half steps, like analyses. */
  bathrooms: number;
  sqft: number;
  propertyType: PropertyType;
  /** Asking rent, dollars per month. */
  rentMonthly: number;
  /** Days since the listing went up (0 = today). Absent when the source
   *  doesn't carry it — Redfin's search rows don't, and defaulting to 0
   *  would badge every one of them "New, listed today". */
  daysOnMarket?: number;
  petFriendly: boolean;
  /** Who to contact about this unit. */
  contact?: ListingContact;
  /** A real listing photo when the feed carries one. Absent for preview
   *  inventory and for feeds (like RentCast) that ship no imagery. */
  photoUrl?: string;
  /** Zillow-style keyword tags ("Furnished", "Waterfront", …). Terrain-aware,
   *  seeded per listing; "Pet friendly" appears here iff petFriendly. */
  features: string[];
  /** False when the source carries no amenity data at all, so an empty
   *  `features` means "unknown" rather than "has none". */
  featuresKnown?: boolean;
  /** The listing's own words. Keyword search reads this the way Zillow
   *  searches descriptions; feature tags are derived from it. */
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export type PipelineStage =
  | "prospecting"
  | "loi-sent"
  | "landlord-approved"
  | "leased"
  | "live";

export const PIPELINE_STAGES: { id: PipelineStage; label: string }[] = [
  { id: "prospecting", label: "Prospecting" },
  { id: "loi-sent", label: "LOI Sent" },
  { id: "landlord-approved", label: "Landlord Approved" },
  { id: "leased", label: "Leased" },
  { id: "live", label: "Live" },
];

export interface Deal {
  id: string;
  analysisId: string;
  address: string;
  city: string;
  stateCode: string;
  marketSlug: string;
  bedrooms: number;
  stage: PipelineStage;
  /** Fraction. Computed from the linked analysis via lib/calc. */
  breakevenOccupancy: number;
  /** Dollars/month. Computed from the linked analysis via lib/calc. */
  netCashFlow: number;
  landlordIds: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Landlords (private per user)                                        */
/* ------------------------------------------------------------------ */

export type StrPolicy = "yes" | "no" | "negotiable";

export interface Landlord {
  id: string;
  name: string;
  company?: string;
  phone: string;
  email: string;
  unitsControlled: number;
  allowsStr: StrPolicy;
  lastContacted?: string;
  notes: string;
  dealIds: string[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Session, billing, activity                                          */
/* ------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  tier: TierId;
  pullsUsed: number;
  /** ISO date the current billing period resets. */
  periodEnd: string;
  joinedAt: string;
  watchedMarketSlugs: string[];
  billingCycle: "monthly" | "annual";
}

export interface Invoice {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: "paid" | "open";
}

export type ActivityType =
  | "pull"
  | "deal-saved"
  | "deal-stage"
  | "landlord-added"
  | "market-watched"
  | "export";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  message: string;
  /** ISO datetime. */
  at: string;
  href?: string;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  tier: TierId;
  pullsUsed: number;
  joinedAt: string;
}

export interface AdminMetrics {
  mrr: number;
  activeSubscriptions: number;
  freeAccounts: number;
  tierCounts: { tier: TierId; count: number }[];
  /** Trailing 12 months of address-pull volume. */
  pullVolume: { month: string; pulls: number }[];
  /** Modeled variable data cost per paying user per month. */
  dataCostPerUser: number;
  /** Fraction of MRR shared with the coaching program. */
  revShareRate: number;
  users: AdminUserRow[];
}
