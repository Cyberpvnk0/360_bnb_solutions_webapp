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
 *
 * AN ESTIMATE IS GRADED AS POTENTIAL. A card nobody has analyzed stands
 * on the listings around it or the city's average, and its grade says
 * so: "Great Deal Potential", not "Great Deal". The analysis, once run,
 * drops the word — the same thresholds, on the property's own figures.
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

/** The word for each grade; "amazing" reads as Great on the badge. */
const WORD: Record<DealGrade, string> = {
  amazing: "Great Deal",
  good: "Good Deal",
  fair: "Fair Deal",
  bad: "Bad Deal",
};

export function gradeDeal(
  cushionPts: number,
  opts: {
    /** True when the figures are an estimate rather than the property's
     *  own analysis: the grade is what the deal could be. */
    potential?: boolean;
  } = {}
): GradedDeal {
  const pts = Math.round(cushionPts);
  const grade: DealGrade =
    pts < 0 ? "bad" : pts >= AMAZING ? "amazing" : pts >= GOOD ? "good" : "fair";
  return {
    grade,
    label: opts.potential ? `${WORD[grade]} Potential` : WORD[grade],
    why: pts < 0 ? `${Math.abs(pts)} pts short of breakeven` : `${pts} pts of cushion`,
  };
}
