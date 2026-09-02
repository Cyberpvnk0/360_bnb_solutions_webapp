import { describe, expect, it } from "vitest";

import { scrubStoredListings } from "@/lib/db/market-store";

describe("scrubStoredListings", () => {
  it("strips a photo a row was written with before the rule", () => {
    // A cached row from an older mapper still carries photoUrl; the
    // type cannot, so the read must not hand it on.
    const out = scrubStoredListings([
      { id: "live--1", address: "1 Main St", photoUrl: "https://x/1.jpg" },
      { id: "live--2", address: "2 Main St", photos: ["https://x/a.jpg"] },
    ])!;
    expect(out).toHaveLength(2);
    for (const row of out) {
      expect("photoUrl" in row).toBe(false);
      expect("photos" in row).toBe(false);
    }
    expect(out[0].id).toBe("live--1");
    expect(out[1].address).toBe("2 Main St");
  });

  it("returns a clean row as-is, not a copy", () => {
    const row = { id: "live--3", address: "3 Main St" };
    const out = scrubStoredListings([row])!;
    expect(out[0]).toBe(row);
  });

  it("answers null for anything that is not an array", () => {
    expect(scrubStoredListings(null)).toBeNull();
    expect(scrubStoredListings(undefined)).toBeNull();
    expect(scrubStoredListings({ listings: [] })).toBeNull();
    expect(scrubStoredListings("[]")).toBeNull();
  });

  it("leaves non-object elements alone rather than throwing", () => {
    const out = scrubStoredListings([null, 4, "x"])!;
    expect(out).toEqual([null, 4, "x"]);
  });
});
