/**
 * What a listing's own past asking prices say about the landlord.
 *
 * The rental feed ships a price history nobody was reading, and it
 * carries the one signal this product cannot derive from anything else:
 * a unit that has been sitting, relisted, and cut is a landlord who
 * will take a call about a two-year lease. Every other figure on a card
 * describes the property; this one describes the person.
 *
 * The vendor keys history by date rather than shipping an array, and
 * the same array-or-map shape shows up across their endpoints, so both
 * are read here rather than betting on one.
 *
 * TWO GUARDS, because the history mixes rentals with sales and a
 * $350,000 sale price silently becomes a "$348,000 rent cut":
 *
 *   1. An entry must look like a rental, when it says what it is.
 *   2. Its price must be within a plausible multiple of the current
 *      asking rent. This one needs no string matching to be right, so
 *      it holds even if the vendor renames its event types.
 */

import type { PriceTrend } from "@/lib/mock/types";

export type { PriceTrend };

/** Widest ratio to today's asking rent that is still the same product.
 *  A sale price clears this by two orders of magnitude. */
const MIN_RATIO = 0.2;
const MAX_RATIO = 5;

interface RawEntry {
  event?: unknown;
  price?: unknown;
  listedDate?: unknown;
  listingType?: unknown;
}

/** Array or date-keyed map, both flattened to a list. */
function entriesOf(history: unknown): RawEntry[] {
  if (Array.isArray(history)) return history as RawEntry[];
  if (history && typeof history === "object") {
    return Object.values(history as Record<string, RawEntry>);
  }
  return [];
}

/** Does this entry claim to be about renting, if it claims anything? */
function looksRental(e: RawEntry): boolean {
  const said = [e.event, e.listingType]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  // Silence is not disqualifying — the magnitude band still applies.
  if (!said) return true;
  if (/sale|sold|sell/.test(said)) return false;
  return /rent|lease/.test(said) || !/\w/.test(said);
}

/**
 * The trend, or null when the history says nothing worth printing:
 * no entries, none that look like rentals, or a unit that has never
 * asked for more than it asks today.
 */
export function priceTrend(
  history: unknown,
  currentRent: number
): PriceTrend | null {
  if (!Number.isFinite(currentRent) || currentRent <= 0) return null;

  const usable = entriesOf(history)
    // A feed that ships nulls or bare numbers in this array must not
    // take a page of listings down with it.
    .filter((e): e is RawEntry => !!e && typeof e === "object")
    .filter(looksRental)
    .filter((e) => typeof e.price === "number" && Number.isFinite(e.price))
    .filter((e) => {
      const ratio = (e.price as number) / currentRent;
      return ratio >= MIN_RATIO && ratio <= MAX_RATIO;
    });
  if (usable.length === 0) return null;

  const highest = Math.max(...usable.map((e) => e.price as number));
  const dates = usable
    .map((e) => e.listedDate)
    .filter((d): d is string => typeof d === "string" && d.length >= 10)
    .sort();

  const cutBy = Math.round(highest - currentRent);
  return {
    askedBefore: Math.round(highest),
    // A unit asking today what it always asked has no cut to report,
    // and rounding must not invent a dollar of one.
    cutBy: cutBy > 0 ? cutBy : 0,
    timesListed: usable.length,
    firstListedAt: dates[0] ?? null,
  };
}
