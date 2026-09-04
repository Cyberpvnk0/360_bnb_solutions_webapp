import { describe, expect, it } from "vitest";

import {
  indexBySite,
  joinListingFacts,
  needsListingPages,
} from "@/lib/live/listing-join";
import type { RentalListing } from "@/lib/mock/types";

const row = (address: string, extra: Partial<RentalListing> = {}) =>
  ({
    id: `x--${address}`,
    analysisId: "a",
    address,
    city: "Tampa",
    stateCode: "FL",
    marketSlug: "tampa",
    lat: 27.9,
    lon: -82.4,
    bedrooms: 2,
    bathrooms: 1,
    sqft: 900,
    propertyType: "apartment",
    rentMonthly: 1500,
    petFriendly: false,
    features: [],
    ...extra,
  }) as RentalListing;

const PAGE = "https://www.redfin.com/FL/Tampa/1204-Glencoe-St/home/1";
const AGENT = { name: "Dana Ruiz", phone: "813-555-0134", role: "Listing agent" as const };

describe("joining a feed row to its listing page", () => {
  it("carries the page and the contact across a spelling difference", () => {
    // The two sides never write an address the same way; that is the
    // entire reason lib/live/address exists.
    const index = indexBySite([
      row("1204 Glencoe St", { sourceUrl: PAGE, contact: AGENT }),
    ]);
    const [joined] = joinListingFacts(
      [row("1204 Glencoe Street, Tampa, FL 33602")],
      index
    );
    expect(joined.sourceUrl).toBe(PAGE);
    expect(joined.contact).toEqual(AGENT);
  });

  it("never hands one unit's contact to another", () => {
    // A stranger's telephone number under somebody's address reads as
    // fact and gets dialled. Unmatched is the safe answer.
    const index = indexBySite([
      row("900 Main St Unit 1", { sourceUrl: PAGE, contact: AGENT }),
    ]);
    const [joined] = joinListingFacts([row("900 Main St Unit 2")], index);
    expect(joined.sourceUrl).toBeUndefined();
    expect(joined.contact).toBeUndefined();
  });

  it("leaves a row the portal does not carry exactly as it arrived", () => {
    const before = row("77 Nowhere Ave");
    const [after] = joinListingFacts([before], indexBySite([]));
    expect(after).toBe(before);
  });

  it("never overwrites what the row already knew", () => {
    // The feed's own contact is about the unit; whoever holds the
    // listing today is a weaker claim on the same slot.
    const mine = { name: "Owner", role: "Owner" as const };
    const index = indexBySite([
      row("1204 Glencoe St", { sourceUrl: PAGE, contact: AGENT }),
    ]);
    const [joined] = joinListingFacts(
      [row("1204 Glencoe St", { contact: mine })],
      index
    );
    expect(joined.contact).toEqual(mine);
    // ...but it still gains the page it had no way to know.
    expect(joined.sourceUrl).toBe(PAGE);
  });

  it("ignores portal rows that have nothing to give", () => {
    const index = indexBySite([row("1204 Glencoe St")]);
    expect(index.size).toBe(0);
  });

  it("skips an address it cannot key rather than guessing", () => {
    const index = indexBySite([
      row("Address on file", { sourceUrl: PAGE, contact: AGENT }),
    ]);
    expect(index.size).toBe(0);
    const [joined] = joinListingFacts([row("Address on file")], index);
    expect(joined.sourceUrl).toBeUndefined();
  });

  it("keeps the first row to claim an address", () => {
    const older = "https://www.redfin.com/FL/Tampa/old/home/2";
    const index = indexBySite([
      row("1204 Glencoe St", { sourceUrl: PAGE }),
      row("1204 Glencoe St", { sourceUrl: older }),
    ]);
    expect(index.get("1204 glencoe st")?.sourceUrl).toBe(PAGE);
  });
});

describe("needsListingPages", () => {
  const bare = (n: string) => row(n);
  const paged = (n: string) =>
    row(n, { sourceUrl: `https://www.redfin.com/${n}` });

  it("is true for rows that have never been through the join", () => {
    // The store predates the join, so a market searched before it
    // shipped holds rows with no listing page at all.
    expect(needsListingPages([bare("1 A St"), bare("2 A St")])).toBe(true);
  });

  it("is false as soon as ANY row carries a page", () => {
    // Not "enough" rows — the portal never carries all of a market, so
    // a coverage threshold is a test that never passes and re-runs the
    // join on every request forever.
    expect(
      needsListingPages([bare("1 A St"), paged("2 A St"), bare("3 A St")])
    ).toBe(false);
  });

  it("is false for no rows at all", () => {
    // Nothing to join, and an empty market must not spend a search
    // finding that out again on every request.
    expect(needsListingPages([])).toBe(false);
  });
});
