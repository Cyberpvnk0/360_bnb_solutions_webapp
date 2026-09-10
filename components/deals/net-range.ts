/**
 * How a net profit range is written: "$600 to $2,800". The word, not a
 * dash — a range that starts below zero ("−$600 – $350") reads as two
 * minuses, and a card is read in a glance.
 */

import { fmtMoney } from "@/lib/format";
import type { NetRange } from "@/lib/calc/deal-read";

/** A whole-dollar figure with a real minus sign, not a hyphen. */
export function money(value: number): string {
  return value < 0 ? `−${fmtMoney(-value)}` : fmtMoney(value);
}

export function rangeText(range: NetRange): string {
  return `${money(range.low)} to ${money(range.high)}`;
}

/** Gold when the whole range clears, red when none of it does, and
 *  plain when it straddles zero — a range is not a verdict. */
export function rangeTone(range: NetRange): "plain" | "good" | "bad" {
  if (range.low >= 0) return "good";
  if (range.high < 0) return "bad";
  return "plain";
}
