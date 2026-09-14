/**
 * The markets map, coloured by what a market is actually worth.
 *
 * It used to be coloured by regulation, which is a fact about a market
 * but not the one somebody scanning a map of the country is asking. The
 * question is where the money is; the rule is what you check once a
 * market is on the shortlist, and it still rides in the hover card and
 * on every row of the table.
 *
 * SPREAD, NOT REVENUE. A year of measured letting revenue less a year
 * of rent. Revenue alone would paint the expensive cities darkest
 * — they earn the most and cost the most, and an arbitrage operator
 * keeps the difference. Spread is the difference.
 *
 * DIVERGING, BECAUSE ZERO MEANS SOMETHING. A market where the letting
 * covers the lease exactly is not "low profit", it is the line between
 * a deal and a loss, so the ramp is two hues around a neutral middle
 * rather than one hue light to dark. The arms are symmetric: the same
 * dollars either side of the line get the same step.
 *
 * A market nobody has measured has NO band. It is not a zero and not a
 * loss — it is a question, and it stays a hollow ring on the map.
 */

/** Within this of the line, either way, a market reads as level. */
export const LEVEL = 2_000;
/** Beyond this, either way, the market is decisively one thing. */
export const DECISIVE = 20_000;

export type SpreadBand =
  | "well-behind"
  | "behind"
  | "level"
  | "ahead"
  | "well-ahead";

/** Which band a spread falls in, or null when there is no spread to
 *  place — an unmeasured market is a question, not a zero. */
export function spreadBand(spread: number | null | undefined): SpreadBand | null {
  if (typeof spread !== "number" || !Number.isFinite(spread)) return null;
  if (spread <= -DECISIVE) return "well-behind";
  if (spread < -LEVEL) return "behind";
  if (spread <= LEVEL) return "level";
  if (spread < DECISIVE) return "ahead";
  return "well-ahead";
}

/** Darkest to darkest through the middle — the order a legend reads. */
export const SPREAD_BANDS: SpreadBand[] = [
  "well-behind",
  "behind",
  "level",
  "ahead",
  "well-ahead",
];

/**
 * What each band is called.
 *
 * RENT, NOT LEASE. "Over lease" was the first wording and it made a
 * reader stop and ask what the baseline was — which is a label that has
 * failed, whatever it technically means. A lease is the agreement; the
 * rent is the money, and the money is what the dot is measured against.
 *
 * AND NOT "PROFIT", which would be the obvious word and the wrong one.
 * This is revenue less rent and nothing else: no cleaning, no platform
 * fees, no management, no furnishing, no utilities. A market well over
 * the rent is one worth underwriting, not one whose spread anybody
 * pockets, and a legend that said "profit" would promise the second.
 */
export const BAND_LABEL: Record<SpreadBand, string> = {
  "well-behind": "Well under rent",
  behind: "Under rent",
  level: "About level",
  ahead: "Over rent",
  "well-ahead": "Well over rent",
};

/**
 * The ramp, as design tokens rather than hex.
 *
 * A marker is an inline style, and a CSS custom property resolves in
 * one exactly as it does in a class — so the map gets the theme's own
 * light and dark steps instead of one set of hex that was picked
 * against a light basemap and then sat on a dark one.
 */
export const BAND_COLOR: Record<SpreadBand, string> = {
  "well-behind": "var(--spread-well-behind)",
  behind: "var(--spread-behind)",
  level: "var(--spread-level)",
  ahead: "var(--spread-ahead)",
  "well-ahead": "var(--spread-well-ahead)",
};

/** The colour an unmeasured market's ring takes. */
export const UNMEASURED_COLOR = "var(--spread-unmeasured)";
