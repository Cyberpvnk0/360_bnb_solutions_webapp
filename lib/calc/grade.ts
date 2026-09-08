/**
 * One word for a deal, from the one figure that decides it.
 *
 * The margin of safety is the market's observed occupancy minus the
 * occupancy this lease needs just to cover its costs. It is the hero
 * metric everywhere else in the product (the gauge, the Deal Finder
 * cards' cushion, the dashboard), so the grade is a reading of it and
 * nothing else — never a second opinion computed some other way.
 *
 * Three grades, three colours. GREAT is the Deal Finder's own "good"
 * line, eight points of cushion, where the card already turns positive.
 * GOOD is anything that clears costs but with less room than that: the
 * deal works, and a soft month is felt. BAD is a market that runs short
 * of breakeven, including a lease no occupancy could carry.
 */

export type DealGrade = "great" | "good" | "bad";

/** Points of cushion (occupancy points) at which a deal reads as great. */
export const GREAT_CUSHION_PTS = 8;

export function dealGrade(marginOfSafety: number): DealGrade {
  if (!Number.isFinite(marginOfSafety) || marginOfSafety < 0) return "bad";
  return Math.round(marginOfSafety * 100) >= GREAT_CUSHION_PTS ? "great" : "good";
}

/** Tailwind text colour for a grade — tokens in globals.css. */
export const GRADE_TEXT: Record<DealGrade, string> = {
  great: "text-pos",
  good: "text-warn",
  bad: "text-neg",
};
