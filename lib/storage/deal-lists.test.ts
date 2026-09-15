import { describe, expect, it } from "vitest";
import {
  DEAL_LISTS_KEY,
  defaultLists,
  parseLists,
  readLists,
  writeLists,
} from "./deal-lists";
import type { DealList, RentalListing } from "@/lib/mock/types";
import { NO_CALLS } from "@/lib/mock/types";

const listing: RentalListing = {
  id: "rl--jacksonville--san-marco--0",
  analysisId: "r--jacksonville--san-marco--0",
  address: "7380 Birchwood Way #12",
  city: "Jacksonville",
  stateCode: "FL",
  marketSlug: "jacksonville",
  lat: 30.31,
  lon: -81.66,
  bedrooms: 2,
  bathrooms: 1,
  sqft: 1140,
  propertyType: "apartment",
  rentMonthly: 1450,
  daysOnMarket: 6,
  petFriendly: true,
  features: ["Furnished", "Pet friendly"],
};

const list: DealList = {
  id: "list-1",
  name: "Jax A-list",
  createdAt: "2026-08-24",
  items: [{ listing, savedAt: "2026-08-24T10:00:00.000Z", call: NO_CALLS }],
};

/** Storage that behaves, plus switches for the ways real ones misbehave. */
function fakeStorage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(DEAL_LISTS_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: () => map.get(DEAL_LISTS_KEY) ?? null,
  };
}

describe("deal list storage", () => {
  it("round-trips lists through storage", () => {
    const s = fakeStorage();
    expect(writeLists(s, [list])).toBe(true);
    expect(readLists(s)).toEqual([list]);
  });

  it("returns null for an empty device so the default list is used", () => {
    expect(readLists(fakeStorage())).toBeNull();
    expect(defaultLists()).toHaveLength(1);
    expect(defaultLists()[0].items).toEqual([]);
  });

  it("survives junk instead of crashing the session", () => {
    expect(parseLists("not json")).toBeNull();
    expect(parseLists("{}")).toBeNull();
    expect(parseLists("[]")).toBeNull();
    expect(parseLists('[{"nope":1}]')).toBeNull();
  });

  it("drops malformed listings but keeps the list around them", () => {
    const parsed = parseLists(
      JSON.stringify([
        {
          id: "l1",
          name: "Mixed",
          items: [
            { listing, savedAt: "2026-08-24T10:00:00.000Z", call: NO_CALLS },
            { listing: { id: "junk" } },
            null,
          ],
        },
      ])
    );
    expect(parsed).toHaveLength(1);
    expect(parsed![0].items.map((i) => i.listing)).toEqual([listing]);
    expect(parsed![0].createdAt).toBeTruthy();
  });

  /**
   * The shape this module exists to rescue.
   *
   * Every device copy still out there was written before the call log,
   * as a bare `listings` array. Refusing to read it would silently
   * discard somebody's shortlist on the one boot that was meant to
   * move it up to their account.
   */
  it("reads a device list written before the call log, as never-called", () => {
    const parsed = parseLists(
      JSON.stringify([{ id: "l1", name: "Old build", listings: [listing] }])
    );
    expect(parsed).toHaveLength(1);
    expect(parsed![0].items).toHaveLength(1);
    expect(parsed![0].items[0].listing).toEqual(listing);
    expect(parsed![0].items[0].call).toEqual(NO_CALLS);
    expect(parsed![0].items[0].savedAt).toBeTruthy();
  });

  it("keeps a call that was logged on the device", () => {
    const parsed = parseLists(
      JSON.stringify([
        {
          id: "l1",
          name: "Worked",
          items: [
            {
              listing,
              savedAt: "2026-08-24T10:00:00.000Z",
              call: {
                outcome: "spoke",
                note: "Open to 12mo",
                lastCalledAt: "2026-08-25T15:00:00.000Z",
                attempts: 2,
              },
            },
          ],
        },
      ])
    );
    expect(parsed![0].items[0].call).toEqual({
      outcome: "spoke",
      note: "Open to 12mo",
      lastCalledAt: "2026-08-25T15:00:00.000Z",
      attempts: 2,
    });
  });

  it("refuses an outcome the queue cannot sort on", () => {
    const parsed = parseLists(
      JSON.stringify([
        {
          id: "l1",
          name: "Junk outcome",
          items: [
            {
              listing,
              savedAt: "2026-08-24T10:00:00.000Z",
              call: { outcome: "left-msg", note: "x", attempts: -3 },
            },
          ],
        },
      ])
    );
    // Unrecognised reads as never called rather than as itself: a
    // property that sorts nowhere is a property that never gets rung.
    expect(parsed![0].items[0].call.outcome).toBeNull();
    expect(parsed![0].items[0].call.attempts).toBe(0);
    expect(parsed![0].items[0].call.note).toBe("x");
  });

  it("never throws when storage is blocked or full", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readLists(blocked)).toBeNull();
    expect(writeLists(blocked, [list])).toBe(false);
  });

  it("caps what it stores so a runaway loop can't blow the quota", () => {
    const many: DealList[] = Array.from({ length: 80 }, (_, i) => ({
      ...list,
      id: `list-${i}`,
    }));
    const s = fakeStorage();
    writeLists(s, many);
    expect(readLists(s)!.length).toBe(50);
  });
});
