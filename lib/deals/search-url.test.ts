import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  clearedFilters,
  searchFromParams,
  searchToHref,
  searchToParams,
  type DealSearch,
} from "./search-url";
import { DEFAULT_DEAL_FILTERS, TYPE_OPTIONS } from "@/components/deals/deal-filters";

const EMPTY: DealSearch = {
  query: "",
  zip: null,
  filters: DEFAULT_DEAL_FILTERS,
  sort: DEFAULT_SORT,
  list: null,
  listing: null,
};

/** Read a search back out of the URL its own state produced. */
function roundTrip(search: DealSearch): DealSearch {
  const params = searchToParams(search);
  return searchFromParams((k) => params.get(k));
}

describe("searchToParams", () => {
  it("writes nothing for an untouched Deal Finder", () => {
    expect(searchToParams(EMPTY).toString()).toBe("");
    expect(searchToHref(EMPTY)).toBe("/deals");
  });

  it("carries the location", () => {
    expect(searchToParams({ ...EMPTY, query: "Las Vegas, NV" }).get("q")).toBe(
      "Las Vegas, NV"
    );
  });

  it("prefers the ZIP, which is its own search mode", () => {
    const p = searchToParams({ ...EMPTY, query: "Tampa, FL", zip: "33601" });
    expect(p.get("zip")).toBe("33601");
    expect(p.get("q")).toBeNull();
  });

  it("leaves a filter out while it sits at its default", () => {
    const p = searchToParams({
      ...EMPTY,
      filters: { ...DEFAULT_DEAL_FILTERS, rentMin: DEFAULT_DEAL_FILTERS.rentMin },
    });
    expect(p.get("rentMin")).toBeNull();
    expect(p.get("types")).toBeNull();
  });

  it("carries every filter that has been touched", () => {
    const p = searchToParams({
      ...EMPTY,
      filters: {
        ...DEFAULT_DEAL_FILTERS,
        rentMin: 900,
        rentMax: 2400,
        beds: [2, 3],
        baths: [1],
        types: ["house"],
        furnishedOnly: true,
      },
      sort: "rent",
    });
    expect(Object.fromEntries(p)).toEqual({
      rentMin: "900",
      rentMax: "2400",
      beds: "2,3",
      baths: "1",
      types: "house",
      furnished: "1",
      sort: "rent",
    });
  });
});

describe("round trip", () => {
  it("restores a fully narrowed search", () => {
    const search: DealSearch = {
      query: "Jacksonville, FL",
      zip: null,
      filters: {
        query: "Jacksonville, FL",
        rentMin: 1100,
        rentMax: 3200,
        beds: [1, 2],
        baths: [2],
        types: ["condo", "house"],
        furnishedOnly: true,
      },
      sort: "rent",
      list: "list-7",
      listing: "rl--jacksonville--12",
    };
    expect(roundTrip(search)).toEqual(search);
  });

  it("restores a ZIP search", () => {
    const search: DealSearch = { ...EMPTY, query: "", zip: "32207" };
    expect(roundTrip(search)).toEqual(search);
  });

  it("restores an untouched search as untouched", () => {
    expect(roundTrip(EMPTY)).toEqual(EMPTY);
  });
});

describe("searchFromParams", () => {
  const of = (pairs: Record<string, string>) => {
    const p = new URLSearchParams(pairs);
    return searchFromParams((k) => p.get(k));
  };

  it("falls back to a wider search on nonsense, never an error", () => {
    const s = of({
      zip: "not-a-zip",
      rentMin: "abc",
      beds: "x,9999,2",
      types: "castle,house",
      sort: "",
    });
    expect(s.zip).toBeNull();
    expect(s.filters.rentMin).toBe(DEFAULT_DEAL_FILTERS.rentMin);
    expect(s.filters.beds).toEqual([2]);
    expect(s.filters.types).toEqual(["house"]);
    expect(s.sort).toBe(DEFAULT_SORT);
  });

  it("treats an unknown type list as no type filter at all", () => {
    expect(of({ types: "castle" }).filters.types).toEqual(DEFAULT_DEAL_FILTERS.types);
  });

  it("keeps the location on the filters too, where the grid reads it", () => {
    expect(of({ q: "Boise, ID" }).filters.query).toBe("Boise, ID");
  });

  it("is the empty search when the URL is bare", () => {
    expect(of({})).toEqual(EMPTY);
  });

  it("drops an absurdly long listing id", () => {
    expect(of({ listing: "x".repeat(400) }).listing).toBeNull();
  });
});

describe("clearedFilters", () => {
  it("resets the filters and keeps the location", () => {
    const cleared = clearedFilters({
      query: "Tampa, FL",
      rentMin: 900,
      rentMax: 2400,
      beds: [2],
      baths: [1],
      types: ["house"],
      furnishedOnly: true,
    });
    expect(cleared.query).toBe("Tampa, FL");
    expect(cleared.rentMin).toBe(DEFAULT_DEAL_FILTERS.rentMin);
    expect(cleared.beds).toEqual([]);
    expect(cleared.types).toHaveLength(TYPE_OPTIONS.length);
    expect(cleared.furnishedOnly).toBe(false);
  });
});
