/**
 * Product configuration.
 *
 * The app name is a placeholder. To rebrand, change APP_NAME (and, if
 * desired, APP_TAGLINE / APP_DOMAIN) here — nothing else in the codebase
 * hardcodes the product name.
 */

export const APP_NAME = "AirCore";
export const APP_TAGLINE = "Know your breakeven before you sign the lease.";
export const APP_DOMAIN = "aircore.example.com";

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
   * Credits included per month — the one thing the plan meters.
   *
   * A credit is spent on the FIRST of something: the first analysis of
   * a property at a size, the first search of a market or a ZIP.
   * Repeats in the same month are free, and the count resets on the
   * 1st. Analyses and market searches used to have separate
   * allowances; one pool is simpler to understand and to sell, so the
   * plans carry a little more than the two added up to.
   */
  creditLimit: number;
  /** Max saved deals in the pipeline. Infinity = unlimited. */
  savedDealLimit: number;
  /** Feature flags. */
  pdfExport: boolean;
  csvExport: boolean;
  prioritySupport: boolean;
  /** The research assistant on the analysis and the Deal Finder,
   *  priced per message in credits (ASSISTANT_MESSAGE_CREDITS). */
  assistant: boolean;
  /**
   * The market analyzer: every US market with its local rule, the map,
   * the areas inside a market and the size table.
   *
   * The top plan only. It is the one surface that answers "where"
   * rather than "which property", it is what an operator running more
   * than one market needs, and the measuring it fronts is the most
   * expensive thing a click can buy in the product.
   */
  marketAnalyzer: boolean;
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
   * vendor purchase at $0.18 plus its contacts and images, every market
   * bought once for this account alone — with a gross margin above
   * forty percent: Starter 54%, Pro 52%, Scale 45%. Realistic margins,
   * with half the cap used and the cache shared, run above eighty.
   *
   * The ladder is a volume discount by design: sixty-eight cents an
   * analysis on Starter, sixty-three on Pro, fifty-five on Scale.
   *
   * FREE TOUCHES NOTHING THAT COSTS MONEY. It walks the whole product —
   * the map, the cards, the calculator, the pipeline — on preview
   * inventory, which is seeded and free to serve. The moment it reaches
   * for live data, a market search or an analysis, the plan says no and
   * the upgrade prompt opens. A small free allowance was tried and is
   * the wrong shape: accounts are free to create, so any nonzero cap
   * multiplied by however many accounts somebody cares to make is an
   * unbounded bill with no revenue against it.
   */
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceAnnual: 0,
    creditLimit: 0,
    savedDealLimit: 3,
    pdfExport: false,
    csvExport: false,
    prioritySupport: false,
    assistant: false,
    marketAnalyzer: false,
    blurb: "Walk the product on preview inventory before you pay.",
    features: [
      "Preview inventory in every market",
      "Unlimited calculator",
      "3 saved deals",
      "Upgrade for credits: live listings, analyses, alerts and the AI Assistant",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 17,
    priceAnnual: 170,
    creditLimit: 45,
    savedDealLimit: 25,
    pdfExport: false,
    csvExport: false,
    prioritySupport: false,
    assistant: false,
    marketAnalyzer: false,
    blurb: "For your first market and your first few landlord calls.",
    features: [
      "45 credits / month",
      "Credits cover market searches, property analyses and owner lookups",
      "New-listing alerts by email or push",
      "Unlimited calculator",
      "25 saved deals",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 47,
    priceAnnual: 470,
    creditLimit: 125,
    savedDealLimit: Infinity,
    pdfExport: true,
    csvExport: false,
    prioritySupport: false,
    assistant: true,
    marketAnalyzer: false,
    recommended: true,
    blurb: "For operators underwriting deals every week.",
    features: [
      "125 credits / month",
      "Credits cover market searches, property analyses and owner lookups",
      "AI Assistant: finds listings, owners and local rules",
      "New-listing alerts by email or push",
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
    creditLimit: 300,
    savedDealLimit: Infinity,
    pdfExport: true,
    csvExport: true,
    prioritySupport: true,
    assistant: true,
    marketAnalyzer: true,
    blurb: "For teams running a portfolio across markets.",
    features: [
      "300 credits / month",
      "Credits cover market searches, property analyses and owner lookups",
      "AI Assistant: finds listings, owners and local rules",
      "New-listing alerts by email or push",
      "Unlimited calculator",
      "Unlimited saved deals",
      "PDF landlord packet export",
      "Market analyzer: every US market, its areas and its local rules",
      "CSV export",
      "Priority support",
    ],
  },
};

export const TIER_ORDER: TierId[] = ["free", "starter", "pro", "scale"];

/**
 * The plan an account is on until something changes it.
 *
 * SCALE, FOR THE BETA. Every account that registers and confirms its
 * email gets the whole product — every feature, the largest caps — and
 * the caps still meter: Scale is a real plan with real limits, not an
 * off switch. This is also what the database gives a new profile
 * (`profiles.tier default 'scale'`, in supabase/auth-schema.sql) and
 * what the server assumes when a profile cannot be read. Change both
 * together when the beta ends and Free becomes the door again.
 */
export const DEFAULT_TIER: TierId = "scale";

/* ------------------------------------------------------------------ */
/* Top-up packs                                                        */
/* ------------------------------------------------------------------ */

export type PackId = "p5" | "p10" | "p25" | "p50" | "p100";

export interface CreditPack {
  id: PackId;
  /** One-time price, dollars. */
  price: number;
  /** Credits the pack adds to the account's balance. Never expire. */
  credits: number;
  /** Shown on the pick list. */
  label: string;
  /** Marks the pack the pick list leads with. */
  recommended?: boolean;
}

/**
 * Extra analyses, bought outright, for the month a plan runs dry.
 *
 * PRICED ABOVE THE PLAN, ON PURPOSE. Every pack's per-analysis price
 * sits above the plan rate at its size — a dollar on the smallest pack
 * against sixty-eight cents on Starter, fifty-nine on the largest
 * against fifty-five on Scale — so a subscriber who keeps buying packs
 * is always better off one tier up, and the packs sell the upgrade
 * rather than replacing it. Within the ladder there is a volume
 * discount, so a bigger pack is never a worse deal than two smaller
 * ones.
 *
 * The worst case for one analysis is about twenty-five cents (a fresh
 * comp purchase plus contacts and images), so the thinnest pack keeps
 * three-quarters and the thickest keeps well over half.
 *
 * Pack analyses do not expire and are spent only once the month's plan
 * allowance is gone — the plan is the cheaper credit, so it goes first.
 * They do not cover markets; a market cap is a browsing limit, not a
 * cost, and a pack is for the thing that costs money.
 */
export const CREDIT_PACKS: Record<PackId, CreditPack> = {
  p5:   { id: "p5",   price: 5,   credits: 5,   label: "5 credits" },
  p10:  { id: "p10",  price: 10,  credits: 12,  label: "12 credits" },
  p25:  { id: "p25",  price: 25,  credits: 35,  label: "35 credits", recommended: true },
  p50:  { id: "p50",  price: 50,  credits: 75,  label: "75 credits" },
  p100: { id: "p100", price: 100, credits: 170, label: "170 credits" },
};

export const PACK_ORDER: PackId[] = ["p5", "p10", "p25", "p50", "p100"];

/**
 * What a deep phone lookup spends: a public-records search for the
 * owner's number, offered when no listing page gave one. Charged when
 * the owner comes back — a name, a number, an email, whatever the
 * record holds, which is what the vendor bills for — and a search that
 * finds nothing costs the account nothing.
 *
 * ONE CREDIT, AND WHY. The records vendors that bill strictly per hit
 * with no monthly fee charge four to seven cents a match (a fifth of
 * a dollar at the dearest self-serve one), and a miss is free. The
 * cheapest credit the product sells is Scale billed annually — $970 a
 * year for 300 a month, about 27 cents — and the dearest is the small
 * pack, a dollar. So one credit clears the vendor's cost on every plan
 * and every pack, by twenty cents at the least; the smallest unit is
 * already the profitable one, and a match the store already holds is
 * charged again at no cost at all. Two credits would be a
 * markup, not a margin.
 */
export const PHONE_LOOKUP_CREDITS = 1;

/**
 * What one message to the research assistant spends. A message is a
 * few web searches and reads and a short answer: a cent a search, the
 * pages' tokens, the model's — five to twenty-five cents at the most
 * searched. A credit is worth twenty-seven cents on the cheapest plan
 * and a dollar on the smallest pack, so two clear the cost with room
 * on every plan; a message that gets no answer is not charged at all.
 */
export const ASSISTANT_MESSAGE_CREDITS: number = 2;

/**
 * What measuring one area on a market page spends.
 *
 * A ZIP costs two billed calls: one to turn its point into the data
 * provider's own district, one for that district's figures. At the
 * measured price of $0.18 a call that is $0.36 of somebody else's money
 * every time a student presses the button.
 *
 * A credit is worth twenty-seven cents on the cheapest plan — Scale
 * billed annually — and a dollar on the smallest pack. One credit would
 * therefore lose eighteen cents on every measure made by the very
 * accounts most likely to make a lot of them; two clear the cost on
 * every plan and every pack. The same arithmetic the assistant's price
 * is set by.
 *
 * A ZIP already on file is served from the store and charged nothing,
 * and the row it writes is shared with every account after, so the
 * second person to want that neighbourhood pays nothing at all.
 */
export const AREA_MEASURE_CREDITS: number = 2;

/**
 * What measuring one market spends.
 *
 * One billed call at $0.18 — the market addressed by its own name,
 * which needs no coordinate lookup — against a credit worth
 * twenty-seven cents at the very least, so one clears it on every plan
 * and every pack. Half what an area costs, because an area needs the
 * lookup and a market does not. Bought once and read free by everybody
 * after.
 */
export const MARKET_MEASURE_CREDITS: number = 1;

/** Dollars per credit, for the "you'd save" line on the pick list. */
export function packUnitPrice(pack: CreditPack): number {
  return Math.round((pack.price / pack.credits) * 100) / 100;
}

/** Effective monthly price when billed annually (two months free).
 *  Rounded to the cent: $170/yr → $14.17, $470 → $39.17, $970 → $80.83. */
export function annualEffectiveMonthly(tier: Tier): number {
  return Math.round((tier.priceAnnual / 12) * 100) / 100;
}

/** Dollars saved per year on the annual plan vs. paying monthly. */
export function annualSavings(tier: Tier): number {
  return Math.round((tier.priceMonthly * 12 - tier.priceAnnual) * 100) / 100;
}
