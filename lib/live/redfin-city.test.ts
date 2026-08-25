import { describe, expect, it } from "vitest";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import {
  REDFIN_CITY_ID,
  extractCandidates,
  normalizeCity,
  parseGuardedJson,
  pickCandidate,
} from "./redfin-city";

const jax = MARKET_BY_SLUG.get("jacksonville")!;
const market = (name: string, stateCode: string): Market =>
  ({ ...jax, name, stateCode }) as Market;

describe("normalizeCity", () => {
  it("sees through the spellings that actually differ between sources", () => {
    expect(normalizeCity("St. Petersburg")).toBe(normalizeCity("Saint Petersburg"));
    expect(normalizeCity("Ft. Lauderdale")).toBe(normalizeCity("Fort Lauderdale"));
    expect(normalizeCity("Winston-Salem")).toBe(normalizeCity("Winston Salem"));
  });

  it("still keeps different cities apart", () => {
    expect(normalizeCity("Jacksonville")).not.toBe(normalizeCity("Jackson"));
  });
});

describe("extractCandidates", () => {
  it("finds city rows wherever the payload nests them", () => {
    const body = {
      payload: {
        sections: [
          { rows: [{ id: "6_8907", name: "Jacksonville", market: "Jacksonville, FL" }] },
        ],
      },
    };
    expect(extractCandidates(body)).toContainEqual({
      id: 8907,
      name: "Jacksonville",
      state: "Jacksonville, FL",
    });
  });

  it("ignores rows with no usable id", () => {
    expect(extractCandidates({ rows: [{ name: "Nowhere" }] })).toEqual([]);
  });

  it("survives a payload shape it has never seen", () => {
    expect(extractCandidates(null)).toEqual([]);
    expect(extractCandidates("nope")).toEqual([]);
  });
});

describe("pickCandidate", () => {
  const rows = [
    { id: 111, name: "Jackson", state: "Jackson, MS" },
    { id: 8907, name: "Jacksonville", state: "Jacksonville, FL" },
    { id: 222, name: "Jacksonville", state: "Jacksonville, NC" },
  ];

  it("requires the city AND the state to line up", () => {
    // Jacksonville FL and Jacksonville NC are both real. Picking on name
    // alone would show a student another state's rentals under their
    // market's name — worse than showing none.
    expect(pickCandidate(rows, market("Jacksonville", "FL"))).toBe(8907);
    expect(pickCandidate(rows, market("Jacksonville", "NC"))).toBe(222);
  });

  it("never settles for a near-miss on the name", () => {
    expect(pickCandidate(rows, market("Jacksonvile", "FL"))).toBeNull();
    expect(pickCandidate([rows[0]], market("Jacksonville", "MS"))).toBeNull();
  });

  it("matches the state as a whole token", () => {
    // "MI" inside "Miami" must not count as Michigan.
    const miami = [{ id: 7, name: "Miami", state: "Miami, FL" }];
    expect(pickCandidate(miami, market("Miami", "MI"))).toBeNull();
    expect(pickCandidate(miami, market("Miami", "FL"))).toBe(7);
  });

  it("returns null on an empty list rather than guessing", () => {
    expect(pickCandidate([], market("Jacksonville", "FL"))).toBeNull();
  });
});

describe("parseGuardedJson", () => {
  it("strips Redfin's own XSSI guard", () => {
    // `{}&&` is the exact reason every market resolved to null: reaching
    // for the first brace finds the GUARD's empty object, and parsing
    // "{}&&{…}" throws.
    expect(parseGuardedJson('{}&&{"payload":{"n":1}}')).toEqual({
      payload: { n: 1 },
    });
  });

  it("handles the other common guards", () => {
    expect(parseGuardedJson(')]}\'\n{"a":1}')).toEqual({ a: 1 });
    expect(parseGuardedJson('for(;;);{"a":1}')).toEqual({ a: 1 });
  });

  it("parses ordinary JSON untouched", () => {
    expect(parseGuardedJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers from a guard it has never seen", () => {
    expect(parseGuardedJson('SOMETHING_NEW||{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(parseGuardedJson("<html>blocked</html>")).toBeNull();
    expect(parseGuardedJson("")).toBeNull();
  });
});

describe("REDFIN_CITY_ID", () => {
  it("only maps markets we actually have", () => {
    // A slug that matches nothing is a silent dead entry: it can never
    // be hit, and it hides the fact that a market is still unresolved.
    const strays = Object.keys(REDFIN_CITY_ID).filter(
      (slug) => !MARKET_BY_SLUG.has(slug)
    );
    expect(strays).toEqual([]);
  });

  it("never maps two markets to the same city", () => {
    // Two slugs sharing an id means one of them searches the other's
    // city — the exact failure this whole resolver exists to prevent.
    const ids = Object.values(REDFIN_CITY_ID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("holds the id confirmed against a real Redfin URL", () => {
    expect(REDFIN_CITY_ID.jacksonville).toBe(8907);
  });

  it("carries every id as a positive integer", () => {
    for (const [slug, id] of Object.entries(REDFIN_CITY_ID)) {
      expect(Number.isInteger(id), slug).toBe(true);
      expect(id, slug).toBeGreaterThan(0);
    }
  });
});
