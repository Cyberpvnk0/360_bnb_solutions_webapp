/**
 * Working a saved list as a call list.
 *
 * The job this serves, in the hunter's own words: search the Deal
 * Finder, add the properties that look good to a list, then go to the
 * saved list and go through each one and call them, leaving a note on
 * whether they answered and how it went, and move on to the next.
 *
 * Everything that decides ORDER and STATE lives here, as pure
 * functions over the stored shape, because the queue is the part that
 * has to be obviously right. A person part-way down a list of twenty
 * landlords is holding nothing in their head; if the app shows them a
 * property they already rang, or skips one they never did, the list
 * stops being trustworthy and they go back to a notebook.
 *
 * THREE BANDS, IN THIS ORDER. Never rung, rung and worth another try,
 * and finished. That is the whole ranking, and it is deliberately not
 * a score: a hunter should be able to predict the next card before it
 * appears.
 */

import type { CallLog, CallOutcome, DealListItem } from "@/lib/mock/types";
import { NO_CALLS } from "@/lib/mock/types";

/** How long a note may be. Long enough for what a landlord said,
 *  short enough that a paste accident cannot fill the row. */
export const MAX_NOTE = 2_000;

/**
 * The four outcomes as the buttons present them.
 *
 * Ordered by how a call actually fails, commonest first, so the thumb
 * lands on the likely answer: most calls to a landlord are not picked
 * up. "Spoke" sits third rather than first for the same reason —
 * putting the rarest outcome under the thumb is how a list fills up
 * with calls that never happened.
 */
export const OUTCOMES: {
  id: CallOutcome;
  label: string;
  /** What logging it means for this property, in the queue's terms. */
  band: QueueBand;
}[] = [
  { id: "no-answer", label: "No answer", band: "retry" },
  { id: "voicemail", label: "Left voicemail", band: "retry" },
  { id: "spoke", label: "Spoke", band: "done" },
  { id: "wrong-number", label: "Wrong number", band: "done" },
];

const OUTCOME_BY_ID = new Map(OUTCOMES.map((o) => [o.id, o]));

/** The short form a row wears — "Left voicemail" is too wide for a
 *  chip beside an address. */
const CHIP: Record<CallOutcome, string> = {
  "no-answer": "No answer",
  voicemail: "Voicemail",
  spoke: "Spoke",
  "wrong-number": "Wrong number",
};

export function outcomeLabel(outcome: CallOutcome | null): string {
  return outcome ? CHIP[outcome] : "Not called";
}

/**
 * Which band a property sits in.
 *
 * `todo`  — never rung. The work.
 * `retry` — rung, nobody reached. Worth another go.
 * `done`  — reached, or there is nobody to reach.
 *
 * Wrong number is `done` rather than `retry` on purpose: a dead number
 * is not a landlord who was busy, and leaving it in the retry band
 * means every pass down the list dials it again.
 */
export type QueueBand = "todo" | "retry" | "done";

export function band(call: CallLog | undefined | null): QueueBand {
  const outcome = call?.outcome ?? null;
  if (!outcome) return "todo";
  return OUTCOME_BY_ID.get(outcome)?.band ?? "todo";
}

const BAND_RANK: Record<QueueBand, number> = { todo: 0, retry: 1, done: 2 };

/**
 * The list in the order it should be worked.
 *
 * Never-rung first in the order they were saved, so the queue matches
 * the list on screen and nothing appears to jump. Then the retries,
 * LONGEST-WAITING FIRST — the one tried three days ago is more due
 * than the one tried an hour ago, and sorting them by the same saved
 * order would send a hunter round the same three numbers all morning.
 * Finished last, so they are still reachable without being in the way.
 *
 * Stable within a band: two items that compare equal keep their input
 * order, so re-rendering never shuffles the queue under somebody.
 */
export function callQueue(items: DealListItem[]): DealListItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const byBand = BAND_RANK[band(a.item.call)] - BAND_RANK[band(b.item.call)];
      if (byBand !== 0) return byBand;
      if (band(a.item.call) === "retry") {
        // Never-stamped sorts as longest-waiting: an attempt we cannot
        // date is at least as old as one we can.
        const at = a.item.call.lastCalledAt ?? "";
        const bt = b.item.call.lastCalledAt ?? "";
        if (at !== bt) return at < bt ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/** How far through a list somebody is. `left` counts everything not
 *  finished — the retries are still work. */
export function queueStats(items: DealListItem[]): {
  total: number;
  todo: number;
  retry: number;
  done: number;
  left: number;
} {
  let todo = 0;
  let retry = 0;
  let done = 0;
  for (const item of items) {
    const b = band(item.call);
    if (b === "todo") todo += 1;
    else if (b === "retry") retry += 1;
    else done += 1;
  }
  return { total: items.length, todo, retry, done, left: todo + retry };
}

/**
 * The call just logged, folded into what was there.
 *
 * Attempts only ever go UP, and every logged call counts as one —
 * including a second "spoke", because ringing somebody back is a
 * second call whatever came of it. The note REPLACES rather than
 * appends: a hunter editing what they wrote a moment ago expects to
 * see their edit, not two copies of it. What they typed is trimmed and
 * bounded; a blank note is a blank note, not the previous one.
 */
export function applyCall(
  prev: CallLog | undefined | null,
  outcome: CallOutcome,
  note: string,
  at: string
): CallLog {
  return {
    outcome,
    note: note.trim().slice(0, MAX_NOTE),
    lastCalledAt: at,
    attempts: Math.max(0, prev?.attempts ?? 0) + 1,
  };
}

/** Words changed, no call made. Deliberately does NOT touch attempts
 *  or the stamp: fixing a typo is not dialling a landlord. */
export function editNote(prev: CallLog | undefined | null, note: string): CallLog {
  return { ...(prev ?? NO_CALLS), note: note.trim().slice(0, MAX_NOTE) };
}

/** Back to never-called — for a call logged against the wrong row,
 *  which is the one mistake a one-tap logger makes easy to make. */
export function clearCall(): CallLog {
  return NO_CALLS;
}

/**
 * The number to dial, as a link.
 *
 * Digits and a leading + only: a href carrying "(904) 555-0142" is
 * handed to the dialer verbatim by some handsets and fails. Null when
 * there is nothing to ring, so a caller cannot render a dead button.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /\d{7,}/.test(cleaned) ? `tel:${cleaned}` : null;
}

/** Is there anybody to ring about this property? */
export function hasNumber(item: DealListItem): boolean {
  return telHref(item.listing.contact?.phone) !== null;
}
