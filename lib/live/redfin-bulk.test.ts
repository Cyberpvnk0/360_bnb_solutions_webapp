import { describe, expect, it } from "vitest";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import {
  extractCityLinks,
  matchMarkets,
  statesInPlay,
  stateIndexUrl,
} from "./redfin-bulk";

describe("stateIndexUrl", () => {
  it("hyphenates multi-word states", () => {
    expect(stateIndexUrl("New York")).toBe("https://www.redfin.com/state/New-York");
    expect(stateIndexUrl("Florida")).toBe("https://www.redfin.com/state/Florida");
  });
});

describe("statesInPlay", () => {
  it("covers every state our markets sit in, in a stable order", () => {
    const states = statesInPlay();
    expect(states.length).toBeGreaterThan(40);
    // Stable, or batch N means something different between runs.
    expect(states).toEqual([...states].sort());
    expect(new Set(states).size).toBe(states.length);
  });
});

describe("extractCityLinks", () => {
  const html = `
    <a href="/city/8907/FL/Jacksonville">Jacksonville</a>
    <a href="https://www.redfin.com/city/11458/FL/Tampa/apartments-for-rent">Tampa</a>
    <a href="/city/17151/FL/St.-Petersburg">St. Petersburg</a>
    <a href="/city/8907/FL/Jacksonville/rentals">Jacksonville again</a>
    <a href="/zipcode/33602/rentals">not a city</a>`;

  it("pulls every distinct city and its id out of the links", () => {
    const links = extractCityLinks(html);
    expect(links).toContainEqual({ id: 8907, stateCode: "FL", name: "Jacksonville" });
    expect(links).toContainEqual({ id: 11458, stateCode: "FL", name: "Tampa" });
    // The same city linked twice is one city.
    expect(links.filter((l) => l.id === 8907)).toHaveLength(1);
  });

  it("ignores links that aren't cities", () => {
    expect(extractCityLinks(html).some((l) => l.name.includes("zipcode"))).toBe(
      false
    );
  });

  it("returns nothing for a page with no city links", () => {
    expect(extractCityLinks("<html>Press &amp; Hold</html>")).toEqual([]);
  });
});

describe("matchMarkets", () => {
  const jax = MARKET_BY_SLUG.get("jacksonville")!;
  const market = (slug: string, name: string, stateCode: string): Market =>
    ({ ...jax, slug, name, stateCode }) as Market;

  it("matches on city AND state, never on name alone", () => {
    // Hard-coding the wrong city into source is far worse than leaving a
    // market unresolved: it would ship, and it would look right.
    const links = [
      { id: 8907, stateCode: "FL", name: "Jacksonville" },
      { id: 999, stateCode: "NC", name: "Jacksonville" },
    ];
    expect(
      matchMarkets(links, [market("jacksonville", "Jacksonville", "FL")])
    ).toEqual({ jacksonville: 8907 });
    expect(
      matchMarkets(links, [market("jacksonville-nc", "Jacksonville", "NC")])
    ).toEqual({ "jacksonville-nc": 999 });
  });

  it("sees through the punctuation that differs between sources", () => {
    const links = [{ id: 17151, stateCode: "FL", name: "St. Petersburg" }];
    expect(
      matchMarkets(links, [market("st-petersburg", "Saint Petersburg", "FL")])
    ).toEqual({ "st-petersburg": 17151 });
  });

  it("leaves a market out rather than guessing at a near match", () => {
    const links = [{ id: 111, stateCode: "MS", name: "Jackson" }];
    expect(
      matchMarkets(links, [market("jacksonville", "Jacksonville", "FL")])
    ).toEqual({});
  });
});
