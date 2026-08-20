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
  /** Address pulls included per month. 0 for the free tier. */
  pullLimit: number;
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
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceAnnual: 0,
    pullLimit: 0,
    savedDealLimit: 3,
    pdfExport: false,
    csvExport: false,
    prioritySupport: false,
    blurb: "Browse every market and run the numbers by hand.",
    features: [
      "Unlimited market browsing",
      "Unlimited calculator",
      "3 saved deals",
      "No address pulls",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 9.97,
    priceAnnual: 99.97,
    pullLimit: 20,
    savedDealLimit: 25,
    pdfExport: false,
    csvExport: false,
    prioritySupport: false,
    blurb: "For your first market and your first few landlord calls.",
    features: [
      "20 address pulls / month",
      "Unlimited market browsing",
      "Unlimited calculator",
      "25 saved deals",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 29.97,
    priceAnnual: 299.97,
    pullLimit: 100,
    savedDealLimit: Infinity,
    pdfExport: true,
    csvExport: false,
    prioritySupport: false,
    recommended: true,
    blurb: "For operators underwriting deals every week.",
    features: [
      "100 address pulls / month",
      "Unlimited market browsing",
      "Unlimited calculator",
      "Unlimited saved deals",
      "PDF landlord packet export",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceMonthly: 79.97,
    priceAnnual: 799.97,
    pullLimit: 400,
    savedDealLimit: Infinity,
    pdfExport: true,
    csvExport: true,
    prioritySupport: true,
    blurb: "For teams running a portfolio across markets.",
    features: [
      "400 address pulls / month",
      "Unlimited market browsing",
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
 *  Rounded to the cent: $99.97/yr → $8.33, $299.97 → $25.00, $799.97 → $66.66. */
export function annualEffectiveMonthly(tier: Tier): number {
  return Math.round((tier.priceAnnual / 12) * 100) / 100;
}

/** Dollars saved per year on the annual plan vs. paying monthly. */
export function annualSavings(tier: Tier): number {
  return Math.round((tier.priceMonthly * 12 - tier.priceAnnual) * 100) / 100;
}
