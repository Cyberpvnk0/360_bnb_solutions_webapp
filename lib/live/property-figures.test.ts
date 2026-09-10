import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { propertyFigures } from "./property-figures";
import { ESTIMATE_VERSION } from "./str-comps";
import { readEstimate } from "@/lib/db/market-store";

vi.mock("@/lib/db/market-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/market-store")>()),
  readEstimate: vi.fn(),
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
const SPEC = { lat: 39.9979, lon: -82.9731, bedrooms: 3, bathrooms: 1 };
const read = vi.mocked(readEstimate);

describe("a property's own figures", () => {
  beforeEach(() => read.mockResolvedValue(null));
  afterEach(() => vi.clearAllMocks());

  it("reads the analyzer's comp set back at this size and derives what the analyzer does", async () => {
    read.mockResolvedValue({
      estimate: { v: ESTIMATE_VERSION, comps: FIVE, monthlyRevenue: null, revenue: null, adr: null, occupancy: null },
      at: new Date().toISOString(),
    });
    const f = await propertyFigures(SPEC);
    expect(f).toMatchObject({ adr: 170, occupancy: 0.31, comps: 5 });
    // Keyed the way the analyzer keys it: this point, this size, two guests to a bedroom.
    expect(String(read.mock.calls[0][0])).toBe("estimate:39.998,-82.973:3:1:6");
  });

  it("has nothing for a property nobody analyzed, a stale or older set, or a thin one", async () => {
    expect(await propertyFigures(SPEC)).toBeNull();
    read.mockResolvedValue({
      estimate: { v: ESTIMATE_VERSION - 1, comps: FIVE, monthlyRevenue: null, revenue: null, adr: null, occupancy: null },
      at: new Date().toISOString(),
    });
    expect(await propertyFigures(SPEC)).toBeNull();
    read.mockResolvedValue({
      estimate: { v: ESTIMATE_VERSION, comps: FIVE, monthlyRevenue: null, revenue: null, adr: null, occupancy: null },
      at: "2020-01-01T00:00:00Z",
    });
    expect(await propertyFigures(SPEC)).toBeNull();
    read.mockResolvedValue({
      estimate: { v: ESTIMATE_VERSION, comps: FIVE.slice(0, 3), monthlyRevenue: null, revenue: null, adr: null, occupancy: null },
      at: new Date().toISOString(),
    });
    expect(await propertyFigures(SPEC)).toBeNull();
  });

  it("leaves out a comp the feed marked as gone", async () => {
    read.mockResolvedValue({
      estimate: {
        v: ESTIMATE_VERSION,
        comps: [...FIVE, comp(900, 0.9, false)],
        monthlyRevenue: null,
        revenue: null,
        adr: null,
        occupancy: null,
      },
      at: new Date().toISOString(),
    });
    expect((await propertyFigures(SPEC))?.comps).toBe(5);
  });
});
