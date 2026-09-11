/**
 * How a net profit range is written: "$600 to $2,800". The word, not a
 * dash — a range that starts below zero ("−$600 – $350") reads as two
 * minuses, and a card is read in a glance.
 *
 * THE FLOOR IS ZERO, AND THE TONE IS NOT.
 *
 * The range is the same calculator run at the low and high ends of the
 * comp spread — a bracket around what is not known yet, not a forecast.
 * A bracket whose pessimistic end dips fifty dollars under water was
 * printing "−$50 to $800" on a card, which reads as a loss at a glance
 * and is really an estimate with a wide mouth.
 *
 * So the printed low is clamped at zero. What is NOT clamped is the
 * colour: `rangeTone` still reads the true range, so a bracket that
 * straddles zero stays plain rather than turning gold, and one that is
 * under water throughout stays red. A reader sees "$0 to $800" in
 * neutral ink beside a grade badge — never a figure dressed up as a
 * win by the clamp that hid its downside.
 *
 * The true low is untouched everywhere it matters as data: the CSV
 * export and the assistant both carry it, because a channel somebody
 * reasons from must not round a negative away.
 */

import { fmtMoney } from "@/lib/format";
import type { NetRange } from "@/lib/calc/deal-read";

/** A whole-dollar figure with a real minus sign, not a hyphen. */
export function money(value: number): string {
  return value < 0 ? `−${fmtMoney(-value)}` : fmtMoney(value);
}

export function rangeText(range: NetRange): string {
  const low = Math.max(0, range.low);
  const high = Math.max(0, range.high);
  // Both ends under water: "$0 to $0" is a range with nothing in it.
  // One zero, in the red the tone gives it, says the same thing.
  return low === high ? fmtMoney(low) : `${fmtMoney(low)} to ${fmtMoney(high)}`;
}

/**
 * Gold when the whole range clears, red when none of it does, and plain
 * when it straddles zero — a range is not a verdict.
 *
 * Reads the TRUE range, never the clamped one. This is what keeps the
 * floor from flattering a deal: the figure says "$0 to $800" and the
 * ink says it is not a clear win.
 */
export function rangeTone(range: NetRange): "plain" | "good" | "bad" {
  if (range.low >= 0) return "good";
  if (range.high < 0) return "bad";
  return "plain";
}
