import { describe, expect, it } from "vitest";
import { MARKETS, MARKET_BY_SLUG } from "@/lib/mock/markets";
import { queryNamesMarket, resolveMarketQuery } from "./market-resolve";

describe("resolveMarketQuery", () => {
  /**
   * THE GUARANTEE. Every market in the catalogue is reachable by the
   * string the product itself writes for it — which is what a link
   * from a market page, a saved deal or an analysis all carry, and
   * what the search box fills in when somebody picks a suggestion.
   *
   * A market added later whose name sits inside a neighbour's fails
   * here rather than being silently unsearchable, which is how four of
   * them went unnoticed: nothing errored, the grid just stayed empty.
   */
  it("resolves every market from its own name and state code", () => {
    const unreachable: string[] = [];
    for (const m of MARKETS) {
      const got = resolveMarketQuery(MARKETS, `${m.name}, ${m.stateCode}`);
      if (got?.slug !== m.slug) {
        unreachable.push(`${m.name}, ${m.stateCode} -> ${got?.slug ?? "null"}`);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it("resolves every market from its name and full state name", () => {
    const unreachable: string[] = [];
    for (const m of MARKETS) {
      const got = resolveMarketQuery(MARKETS, `${m.name}, ${m.state}`);
      if (got?.slug !== m.slug) unreachable.push(`${m.name}, ${m.state}`);
    }
    expect(unreachable).toEqual([]);
  });

  /** The four that were unreachable, named so a regression is obvious
   *  rather than a count going up by one. */
  it.each([
    ["Las Vegas, NV", "las-vegas"],
    ["Colorado Springs, CO", "colorado-springs"],
    ["Jersey City, NJ", "jersey-city"],
    ["New York, NY", "new-york"],
  ])("resolves %s, which a longer neighbour used to swallow", (query, slug) => {
    expect(MARKET_BY_SLUG.has(slug)).toBe(true);
    expect(resolveMarketQuery(MARKETS, query)?.slug).toBe(slug);
  });

  it("still resolves a market from a partial name nobody else shares", () => {
    expect(resolveMarketQuery(MARKETS, "jacksonville")?.slug).toBe("jacksonville");
  });

  it("stays ambiguous when the query names nothing in particular", () => {
    // Several markets, none of them named outright: guessing would
    // send the search to the wrong state.
    expect(resolveMarketQuery(MARKETS, "springs")).toBeNull();
  });

  it("is null for nothing and for nonsense", () => {
    expect(resolveMarketQuery(MARKETS, "")).toBeNull();
    expect(resolveMarketQuery(MARKETS, "   ")).toBeNull();
    expect(resolveMarketQuery(MARKETS, "qqzzxx")).toBeNull();
  });

  it("does not care about case, commas or extra spaces", () => {
    for (const q of ["las vegas nv", "LAS VEGAS, NV", "Las  Vegas ,NV"]) {
      expect(resolveMarketQuery(MARKETS, q)?.slug).toBe("las-vegas");
    }
  });
});

describe("queryNamesMarket", () => {
  const vegas = MARKET_BY_SLUG.get("las-vegas")!;

  it("is true for the market's own name, with or without the state", () => {
    expect(queryNamesMarket(vegas, "Las Vegas")).toBe(true);
    expect(queryNamesMarket(vegas, "Las Vegas, NV")).toBe(true);
    expect(queryNamesMarket(vegas, "Las Vegas, Nevada")).toBe(true);
  });

  it("is false for a name that merely contains it", () => {
    const north = MARKETS.find((m) => m.name === "North Las Vegas");
    expect(north).toBeDefined();
    expect(queryNamesMarket(vegas, "North Las Vegas, NV")).toBe(false);
    expect(queryNamesMarket(north!, "Las Vegas, NV")).toBe(false);
  });
});
