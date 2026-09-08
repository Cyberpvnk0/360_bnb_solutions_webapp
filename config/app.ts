/**
 * Product configuration.
 *
 * The app name is a placeholder. To rebrand, change APP_NAME (and, if
 * desired, APP_TAGLINE / APP_DOMAIN) here — nothing else in the codebase
 * hardcodes the product name.
 */

export const APP_NAME = "ArbiCore";
export const APP_TAGLINE = "Know your breakeven before you sign the lease.";
export const APP_DOMAIN = "arbicore.example.com";

/** Company line used in the footer and legal boilerplate. */
export const APP_COMPANY = `${APP_NAME}, Inc.`;

/* ------------------------------------------------------------------ */
/* Pricing tiers                                                       */
/* ------------------------------------------------------------------ */

export type TierId = "free" | "starter" | "pro" | "scale";

export interface Tier {
  id: TierId;
  name: string;
  /** Price per month when billed monthly, in dollars. */
  priceMonthly: number;
  /** Price per year when billed annually, in dollars. */
  priceAnnual: number;
  /**
   * Property analyses included per month — clicks on "Run the numbers",
   * counted as DISTINCT properties, so a reload is not a second one.
   * This is the only thing in the product that costs the vendor money
   * per user, so it is the thing the plan meters.
   */
  pullLimit: number;
  /**
   * Distinct markets an account may open per month.
   *
   * Browsing a market is shared and cached, so across a class of
   * students it costs almost nothing — but a lone account in a market
   * nobody else looks at re-buys that market's feed daily. The cap
   * bounds that exposure; for a real user on a paid plan it never
   * binds.
   */
  marketLimit: number;
  /** Max saved deals in the pipeline. Infinity = unlimited. */
  savedDealLimit: number;
  /** Feature flags. */
  pdfExport: boolean;
  csvExport: boolean;
  prioritySupport: boolean;
  /** One-line positioning used on pricing cards. */
  blurb: string;
  /** Bullet list for pricing cards, in display order. */
  features: string[];
  /** Marks the visually recommended tier. */
  recommended?: boolean;
}

export const TIERS: Record<TierId, Tier> = {
  /**
   * THE CAPS ARE UNIT ECONOMICS, NOT ROUND NUMBERS. Each paid tier
   * clears its own cost in the worst case — every analysis a fresh
   * vendor purchase at $0.18, every market a lone re-buy — with a
   * gross margin above fifty percent: Starter 61%, Pro 59%, Scale 51%.
   * The free tier is bounded so that an account paying nothing cannot
   * become a cost centre, which unlimited browsing quietly allowed.
   */
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceAnnual: 0,
    pullLimit: 0,
    marketLimit: 3,
    savedDealLimit: 3,
    pdfExport: false,
    csvExport: false,
    prioritySupport: false,
    blurb: "Browse a few markets and run the numbers by hand.",
    features: [
      "3 markets / month",
      "Unlimited calculator",
      "3 saved deals",
      "No property analyses",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 9,
    priceAnnual: 90,
    pullLimit: 10,
    marketLimit: 10,
    savedDealLimit: 25,
    pdfExport: false,
    csvExport: false,
    prioritySupport: false,
    blurb: "For your first market and your first few landlord calls.",
    features: [
      "10 property analyses / month",
      "10 markets / month",
      "Unlimited calculator",
      "25 saved deals",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 47,
    priceAnnual: 470,
    pullLimit: 60,
    marketLimit: 40,
    savedDealLimit: Infinity,
    pdfExport: true,
    csvExport: false,
    prioritySupport: false,
    recommended: true,
    blurb: "For operators underwriting deals every week.",
    features: [
      "60 property analyses / month",
      "40 markets / month",
      "Unlimited calculator",
      "Unlimited saved deals",
      "PDF landlord packet export",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceMonthly: 97,
    priceAnnual: 970,
    pullLimit: 150,
    marketLimit: 100,
    savedDealLimit: Infinity,
    pdfExport: true,
    csvExport: true,
    prioritySupport: true,
    blurb: "For teams running a portfolio across markets.",
    features: [
      "150 property analyses / month",
      "100 markets / month",
      "Unlimited calculator",
      "Unlimited saved deals",
      "PDF landlord packet export",
      "CSV export",
      "Priority support",
    ],
  },
};

export const TIER_ORDER: TierId[] = ["free", "starter", "pro", "scale"];

/** Effective monthly price when billed annually (two months free).
 *  Rounded to the cent: $90/yr → $7.50, $470 → $39.17, $970 → $80.83. */
export function annualEffectiveMonthly(tier: Tier): number {
  return Math.round((tier.priceAnnual / 12) * 100) / 100;
}

/** Dollars saved per year on the annual plan vs. paying monthly. */
export function annualSavings(tier: Tier): number {
  return Math.round((tier.priceMonthly * 12 - tier.priceAnnual) * 100) / 100;
}
