import { describe, expect, it } from "vitest";
import {
  EVIDENCE_RADIUS_MILES,
  EVIDENCE_ROWS,
  allSameSize,
  buildLeaseEvidence,
  medianRent,
  type LeaseComp,
} from "./lease-evidence";
import type { RentalListing } from "@/lib/mock/types";

const POINT = { lat: 30.3, lon: -81.65 };

function rental(over: Partial<RentalListing> & { id: string }): RentalListing {
  return {
    analysisId: `a-${over.id}`,
    address: "1 Main St, Jacksonville, FL 32207",
    city: "Jacksonville",
    stateCode: "FL",
    marketSlug: "jacksonville",
    lat: POINT.lat,
    lon: POINT.lon,
    bedrooms: 2,
    bathrooms: 2,
    sqft: 900,
    propertyType: "house",
    rentMonthly: 1500,
    petFriendly: false,
    ...over,
  } as RentalListing;
}

/** Roughly this many miles north of the point. */
function north(miles: number): number {
  return POINT.lat + miles / 69;
}

describe("buildLeaseEvidence", () => {
  it("gives nothing without a point to be near", () => {
    expect(
      buildLeaseEvidence({ listings: [rental({ id: "1" })], point: null, bedrooms: 2 })
    ).toEqual([]);
  });

  it("gives nothing when there are no rentals on file", () => {
    expect(buildLeaseEvidence({ listings: [], point: POINT, bedrooms: 2 })).toEqual([]);
  });

  it("prefers the property's own size over a nearer wrong size", () => {
    const rows = buildLeaseEvidence({
      listings: [
        rental({ id: "near-1bd", bedrooms: 1, lat: north(0.1) }),
        rental({ id: "far-2bd", bedrooms: 2, lat: north(4) }),
      ],
      point: POINT,
      bedrooms: 2,
    });
    expect(rows.map((r) => r.id)).toEqual(["far-2bd", "near-1bd"]);
  });

  it("breaks a size tie on distance", () => {
    const rows = buildLeaseEvidence({
      listings: [
        rental({ id: "far", lat: north(3) }),
        rental({ id: "near", lat: north(0.5) }),
      ],
      point: POINT,
      bedrooms: 2,
    });
    expect(rows.map((r) => r.id)).toEqual(["near", "far"]);
  });

  it("drops anything past the radius", () => {
    const rows = buildLeaseEvidence({
      listings: [rental({ id: "gone", lat: north(EVIDENCE_RADIUS_MILES + 2) })],
      point: POINT,
      bedrooms: 2,
    });
    expect(rows).toEqual([]);
  });

  it("leaves the property's own listing out of its own evidence", () => {
    const rows = buildLeaseEvidence({
      listings: [rental({ id: "self" }), rental({ id: "other" })],
      point: POINT,
      bedrooms: 2,
      excludeId: "self",
    });
    expect(rows.map((r) => r.id)).toEqual(["other"]);
  });

  it("skips rows with no rent and no coordinate", () => {
    const rows = buildLeaseEvidence({
      listings: [
        rental({ id: "norent", rentMonthly: 0 }),
        rental({ id: "nopoint", lat: Number.NaN }),
        rental({ id: "good" }),
      ],
      point: POINT,
      bedrooms: 2,
    });
    expect(rows.map((r) => r.id)).toEqual(["good"]);
  });

  it("caps the table", () => {
    const rows = buildLeaseEvidence({
      listings: Array.from({ length: EVIDENCE_ROWS + 5 }, (_, i) =>
        rental({ id: `r${i}`, lat: north(i * 0.1) })
      ),
      point: POINT,
      bedrooms: 2,
    });
    expect(rows).toHaveLength(EVIDENCE_ROWS);
  });

  it("carries a missing square footage as absent, never as zero", () => {
    const [row] = buildLeaseEvidence({
      listings: [rental({ id: "1", sqft: 0 })],
      point: POINT,
      bedrooms: 2,
    });
    expect(row.sqft).toBeNull();
  });

  it("keeps the days on market only when the feed stated one", () => {
    const rows = buildLeaseEvidence({
      listings: [
        rental({ id: "said", daysOnMarket: 12, lat: north(0.1) }),
        rental({ id: "quiet", lat: north(0.2) }),
      ],
      point: POINT,
      bedrooms: 2,
    });
    expect(rows[0].daysOnMarket).toBe(12);
    expect(rows[1].daysOnMarket).toBeNull();
  });

  it("reads the ZIP off the row or its address", () => {
    const [row] = buildLeaseEvidence({
      listings: [rental({ id: "1", address: "9 Oak Ave, Jacksonville, FL 32250" })],
      point: POINT,
      bedrooms: 2,
    });
    expect(row.zip).toBe("32250");
  });
});

describe("medianRent", () => {
  const comp = (rent: number): LeaseComp => ({
    id: `c${rent}`,
    address: "1 Main St",
    city: "Jacksonville",
    stateCode: "FL",
    zip: null,
    bedrooms: 2,
    bathrooms: 2,
    rent,
    sqft: null,
    distanceMiles: 1,
    daysOnMarket: null,
    sourceUrl: null,
  });

  it("is null for an empty table", () => {
    expect(medianRent([])).toBeNull();
  });

  it("takes the middle of an odd count", () => {
    expect(medianRent([comp(900), comp(1500), comp(1200)])).toBe(1200);
  });

  it("averages the middle two of an even count", () => {
    expect(medianRent([comp(1000), comp(1200), comp(1400), comp(1600)])).toBe(1300);
  });

  it("says when every row is the property's own size", () => {
    expect(allSameSize([comp(1000)], 2)).toBe(true);
    expect(allSameSize([{ ...comp(1000), bedrooms: 1 }], 2)).toBe(false);
    expect(allSameSize([], 2)).toBe(false);
  });
});
