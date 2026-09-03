/**
 * One word for whether a lease is worth a phone call.
 *
 * Every figure on a card is a number somebody has to interpret. This is
 * the interpretation, stated once, from the only measure that already
 * accounts for both sides of the trade: cushion — the market's actual
 * occupancy minus the occupancy this rent needs to break even. A deal
 * with twenty points of cushion survives a bad quarter; one with two
 * does not.
 *
 * The word never travels alone. A grade shown as a colour is unreadable
 * to a colourblind operator and meaningless in a screenshot, so callers
 * render the label and the reason, and use colour only to repeat what
 * the words already say.
 */

export type DealGrade = "amazing" | "good" | "fair" | "bad";

export interface GradedDeal {
  grade: DealGrade;
  /** The word on the badge. */
  label: string;
  /** The number behind the word, for the line underneath it. */
  why: string;
}

/**
 * Thresholds, and why they sit where they do.
 *
 * Zero is not the boundary between good and bad — it is the boundary
 * between a business and a hobby, and a lease that clears breakeven by
 * a single point is one soft month from costing money. Eight points is
 * roughly a bad season absorbed; twenty is a bad year absorbed.
 */
const AMAZING = 20;
const GOOD = 8;

export function gradeDeal(cushionPts: number): GradedDeal {
  const pts = Math.round(cushionPts);
  if (pts < 0) {
    return {
      grade: "bad",
      label: "Bad deal",
      why: `${Math.abs(pts)} pts short of breakeven`,
    };
  }
  if (pts >= AMAZING) {
    return { grade: "amazing", label: "Amazing deal", why: `${pts} pts of cushion` };
  }
  if (pts >= GOOD) {
    return { grade: "good", label: "Good deal", why: `${pts} pts of cushion` };
  }
  return { grade: "fair", label: "Fair deal", why: `${pts} pts of cushion` };
}
