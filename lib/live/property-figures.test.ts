import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_MIN_VERSION, propertyFigures, type StoredSet } from "./property-figures";
import { ESTIMATE_VERSION } from "./str-comps";
import { readEstimates } from "@/lib/db/market-store";

vi.mock("@/lib/db/market-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/market-store")>()),
  readEstimates: vi.fn(),
}));

const comp = (adr: number, occupancy: number, active?: boolean) => ({
  id: `c${adr}`,
  name: "x",
  bedrooms: 3,
  bathrooms: 1,
  adr,
  occupancy,
  distanceMiles: 1,
  ...(active === undefined ? {} : { active }),
});
const FIVE = [comp(150, 0.3), comp(170, 0.32), comp(190, 0.28), comp(160, 0.35), comp(180, 0.3)];
const SPEC = { lat: 39.9979, lon: -82.9731, bedrooms: 3, bathrooms: 1, address: "1804 E Sitka St", stateCode: "FL" };
const BY_POINT = "estimate:39.998,-82.973:3:1:6";
const BY_ADDRESS = "estimate:addr:v1:fl:1804 sitka st e:3:1";
const read = vi.mocked(readEstimates);
const blank = { monthlyRevenue: null, revenue: null, adr: null, occupancy: null };
const set = (comps: unknown[], at: string, v = ESTIMATE_VERSION): StoredSet => ({
  estimate: { v, comps, ...blank },
  at,
});
const onFile = (entries: [string, StoredSet][]) => read.mockResolvedValue(new Map(entries));

describe("a property's own figures", () => {
  // A block, not an expression: the mock a resolved-value call returns
  // would be taken for a cleanup function and called with no arguments.
  beforeEach(() => {
    onFile([]);
  });
  afterEach(() => vi.clearAllMocks());

  it("reads the analyzer's set back by point and by address, and derives what the analyzer does", async () => {
    onFile([[BY_POINT, set(FIVE, "2026-09-01T00:00:00Z")]]);
    const f = await propertyFigures(SPEC);
    // Five comps a mile out: too few for the one-mile grain, so the
    // two-mile ceiling.
    expect(f).toMatchObject({ adr: 170, occupancy: 0.31, comps: 5, radiusMiles: 2, at: "2026-09-01T00:00:00Z" });
    // Keyed the way the analyzer keys it: this point, this size, two
    // guests to a bedroom — and the address, for a set bought at a
    // geocoded point a few doors off.
    expect(read.mock.calls[0][0]).toEqual([BY_POINT, BY_ADDRESS]);
  });

  it("asks by point alone when the address cannot be keyed", async () => {
    await propertyFigures({ ...SPEC, address: null, stateCode: null });
    expect(read.mock.calls[0][0]).toEqual([BY_POINT]);
  });

  it("stands on the newest set on file, whichever key it sits under, at any age", async () => {
    const older = set(FIVE, "2025-11-01T00:00:00Z");
    const newer = set([comp(200, 0.4), comp(210, 0.4), comp(220, 0.4), comp(230, 0.4)], "2026-03-01T00:00:00Z");
    onFile([[BY_POINT, older], [BY_ADDRESS, newer]]);
    expect(await propertyFigures(SPEC)).toMatchObject({ adr: 215, occupancy: 0.4, comps: 4, at: "2026-03-01T00:00:00Z" });
    onFile([[BY_POINT, newer], [BY_ADDRESS, older]]);
    expect(await propertyFigures(SPEC)).toMatchObject({ adr: 215, at: "2026-03-01T00:00:00Z" });
    // A set months old still beats no analysis at all.
    onFile([[BY_POINT, older]]);
    expect(await propertyFigures(SPEC)).toMatchObject({ adr: 170, at: "2025-11-01T00:00:00Z" });
  });

  it("has nothing for a property nobody analyzed, a set in too old a format, or a thin one", async () => {
    expect(await propertyFigures(SPEC)).toBeNull();
    onFile([[BY_POINT, set(FIVE, "2026-09-01T00:00:00Z", CARD_MIN_VERSION - 1)]]);
    expect(await propertyFigures(SPEC)).toBeNull();
    onFile([[BY_POINT, set(FIVE, "2026-09-01T00:00:00Z", CARD_MIN_VERSION)]]);
    expect(await propertyFigures(SPEC)).not.toBeNull();
    onFile([[BY_POINT, set(FIVE.slice(0, 3), "2026-09-01T00:00:00Z")]]);
    expect(await propertyFigures(SPEC)).toBeNull();
  });

  it("leaves out a comp the feed marked as gone", async () => {
    onFile([[BY_POINT, set([...FIVE, comp(900, 0.9, false)], "2026-09-01T00:00:00Z")]]);
    expect((await propertyFigures(SPEC))?.comps).toBe(5);
  });
});
