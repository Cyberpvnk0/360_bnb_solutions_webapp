import { describe, expect, it } from "vitest";
import type { CallLog, DealListItem, RentalListing } from "@/lib/mock/types";
import { NO_CALLS } from "@/lib/mock/types";
import {
  applyCall,
  band,
  callQueue,
  clearCall,
  editNote,
  hasNumber,
  MAX_NOTE,
  OUTCOMES,
  outcomeLabel,
  queueStats,
  telHref,
} from "./call-queue";

/**
 * The queue a person works down while holding a phone.
 *
 * What these defend is the property that makes the list trustworthy:
 * a call that was made stays made, in the right band, and the order
 * never shuffles under somebody part-way through. Get that wrong and a
 * hunter rings the same landlord twice and misses another entirely —
 * at which point they go back to a notebook and the feature is worse
 * than nothing.
 */

const listing = (id: string, phone?: string): RentalListing =>
  ({
    id,
    analysisId: `r--${id}`,
    address: `${id} Main St`,
    city: "Jacksonville",
    stateCode: "FL",
    marketSlug: "jacksonville-fl",
    lat: 30.3,
    lon: -81.6,
    bedrooms: 2,
    bathrooms: 1,
    sqft: 900,
    propertyType: "house",
    rentMonthly: 1800,
    features: [],
    petFriendly: false,
    ...(phone ? { contact: { phone, role: "Listing agent" as const } } : {}),
  }) as RentalListing;

const item = (id: string, call: Partial<CallLog> = {}): DealListItem => ({
  listing: listing(id),
  savedAt: "2026-09-01T00:00:00.000Z",
  call: { ...NO_CALLS, ...call },
});

const ids = (items: DealListItem[]) => items.map((i) => i.listing.id);

describe("which band a property sits in", () => {
  it("never called is work to do", () => {
    expect(band(NO_CALLS)).toBe("todo");
    expect(band(null)).toBe("todo");
    expect(band(undefined)).toBe("todo");
  });

  it("nobody reached is worth another go", () => {
    expect(band({ ...NO_CALLS, outcome: "no-answer" })).toBe("retry");
    expect(band({ ...NO_CALLS, outcome: "voicemail" })).toBe("retry");
  });

  it("reached, or nobody there to reach, is finished", () => {
    expect(band({ ...NO_CALLS, outcome: "spoke" })).toBe("done");
    // A dead number is not a landlord who was busy. Left in the retry
    // band, every pass down the list dials it again.
    expect(band({ ...NO_CALLS, outcome: "wrong-number" })).toBe("done");
  });

  it("every outcome the buttons offer has a band", () => {
    for (const o of OUTCOMES) {
      expect(band({ ...NO_CALLS, outcome: o.id })).toBe(o.band);
    }
  });
});

describe("the order a list is worked in", () => {
  it("puts the never-called first, in the order they were saved", () => {
    const q = callQueue([
      item("c", { outcome: "spoke" }),
      item("a"),
      item("b", { outcome: "no-answer", lastCalledAt: "2026-09-02T00:00:00.000Z" }),
      item("d"),
    ]);
    expect(ids(q)).toEqual(["a", "d", "b", "c"]);
  });

  it("sorts the retries longest-waiting first", () => {
    const q = callQueue([
      item("recent", { outcome: "no-answer", lastCalledAt: "2026-09-09T12:00:00.000Z" }),
      item("stale", { outcome: "voicemail", lastCalledAt: "2026-09-02T09:00:00.000Z" }),
      item("middle", { outcome: "no-answer", lastCalledAt: "2026-09-05T09:00:00.000Z" }),
    ]);
    expect(ids(q)).toEqual(["stale", "middle", "recent"]);
  });

  it("treats an undated attempt as at least as old as a dated one", () => {
    const q = callQueue([
      item("dated", { outcome: "no-answer", lastCalledAt: "2026-09-02T09:00:00.000Z" }),
      item("undated", { outcome: "no-answer" }),
    ]);
    expect(ids(q)).toEqual(["undated", "dated"]);
  });

  it("is stable within a band, so nothing shuffles under somebody", () => {
    const input = [item("a"), item("b"), item("c"), item("d")];
    expect(ids(callQueue(input))).toEqual(["a", "b", "c", "d"]);
    expect(ids(callQueue(callQueue(input)))).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [item("z", { outcome: "spoke" }), item("a")];
    callQueue(input);
    expect(ids(input)).toEqual(["z", "a"]);
  });

  it("never loses or duplicates a property", () => {
    const input = [
      item("a", { outcome: "spoke" }),
      item("b"),
      item("c", { outcome: "voicemail", lastCalledAt: "2026-09-01T00:00:00.000Z" }),
      item("d", { outcome: "wrong-number" }),
      item("e"),
    ];
    expect(ids(callQueue(input)).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("how far through a list somebody is", () => {
  it("counts the retries as work still left", () => {
    const s = queueStats([
      item("a"),
      item("b", { outcome: "no-answer" }),
      item("c", { outcome: "spoke" }),
      item("d", { outcome: "wrong-number" }),
    ]);
    expect(s).toEqual({ total: 4, todo: 1, retry: 1, done: 2, left: 2 });
  });

  it("an empty list is finished, not broken", () => {
    expect(queueStats([])).toEqual({ total: 0, todo: 0, retry: 0, done: 0, left: 0 });
  });
});

describe("logging a call", () => {
  const AT = "2026-09-10T16:30:00.000Z";

  it("counts every dial, including a second one that also connected", () => {
    let call = applyCall(NO_CALLS, "no-answer", "", AT);
    expect(call.attempts).toBe(1);
    call = applyCall(call, "spoke", "Picked up", AT);
    expect(call.attempts).toBe(2);
    call = applyCall(call, "spoke", "Rang back", AT);
    expect(call.attempts).toBe(3);
  });

  it("stamps when it happened and what was said", () => {
    const call = applyCall(NO_CALLS, "voicemail", "  Left a message  ", AT);
    expect(call).toEqual({
      outcome: "voicemail",
      note: "Left a message",
      lastCalledAt: AT,
      attempts: 1,
    });
  });

  it("replaces the note rather than appending to it", () => {
    const first = applyCall(NO_CALLS, "no-answer", "Rang twice", AT);
    const second = applyCall(first, "spoke", "Answered at last", AT);
    expect(second.note).toBe("Answered at last");
  });

  it("lets a note be cleared", () => {
    const first = applyCall(NO_CALLS, "no-answer", "Rang twice", AT);
    expect(applyCall(first, "no-answer", "   ", AT).note).toBe("");
  });

  it("bounds what can be pasted into the note", () => {
    const call = applyCall(NO_CALLS, "spoke", "x".repeat(MAX_NOTE + 500), AT);
    expect(call.note).toHaveLength(MAX_NOTE);
  });

  it("does not trust a negative attempt count it was handed", () => {
    expect(applyCall({ ...NO_CALLS, attempts: -7 }, "spoke", "", AT).attempts).toBe(1);
  });

  it("moves a property out of the queue's way once somebody is reached", () => {
    expect(band(applyCall(NO_CALLS, "spoke", "", AT))).toBe("done");
    expect(band(applyCall(NO_CALLS, "no-answer", "", AT))).toBe("retry");
  });
});

describe("editing the words without claiming a call", () => {
  it("leaves the attempts and the stamp alone", () => {
    const called = applyCall(NO_CALLS, "no-answer", "Rang", "2026-09-10T16:30:00.000Z");
    const edited = editNote(called, "Rang, no machine");
    expect(edited.attempts).toBe(called.attempts);
    expect(edited.lastCalledAt).toBe(called.lastCalledAt);
    expect(edited.outcome).toBe("no-answer");
    expect(edited.note).toBe("Rang, no machine");
  });

  it("works on a property that was never called", () => {
    const edited = editNote(null, "Ask about the garage");
    expect(edited.attempts).toBe(0);
    expect(edited.outcome).toBeNull();
  });

  it("bounds the note too — the field is the same field", () => {
    expect(editNote(NO_CALLS, "y".repeat(MAX_NOTE + 1)).note).toHaveLength(MAX_NOTE);
  });
});

describe("undoing a call logged against the wrong row", () => {
  it("puts the property back at the front of the queue", () => {
    expect(clearCall()).toEqual(NO_CALLS);
    expect(band(clearCall())).toBe("todo");
  });
});

describe("the number to dial", () => {
  it("strips a number down to what a dialer accepts", () => {
    expect(telHref("(904) 555-0142")).toBe("tel:9045550142");
    expect(telHref("+1 904-555-0142")).toBe("tel:+19045550142");
    expect(telHref("904.555.0142 ext 12")).toBe("tel:904555014212");
  });

  it("keeps only a LEADING plus", () => {
    expect(telHref("+1 904 555 0142 +2")).toBe("tel:+190455501422");
  });

  it("refuses anything that is not a number, so no dead button renders", () => {
    expect(telHref(undefined)).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("call the office")).toBeNull();
    expect(telHref("ext 4")).toBeNull();
  });

  it("says whether there is anybody to ring about a property", () => {
    expect(hasNumber(item("a"))).toBe(false);
    expect(
      hasNumber({ ...item("b"), listing: listing("b", "(904) 555-0142") })
    ).toBe(true);
  });
});

describe("what a row says about the last call", () => {
  it("never called reads as never called, not as blank", () => {
    expect(outcomeLabel(null)).toBe("Not called");
  });

  it("gives every outcome a label short enough for a chip", () => {
    for (const o of OUTCOMES) {
      const label = outcomeLabel(o.id);
      expect(label).toBeTruthy();
      expect(label.length).toBeLessThanOrEqual(13);
    }
  });

  it("keeps no-answer and voicemail distinguishable — the split is the point", () => {
    expect(outcomeLabel("no-answer")).not.toBe(outcomeLabel("voicemail"));
  });
});
