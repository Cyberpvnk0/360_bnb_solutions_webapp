import { describe, expect, it } from "vitest";
import { countSummary, marketMatchesQuery, normalizeKeyword } from "./deal-filters";
import { MARKETS } from "@/lib/mock/markets";
import { marketSearchText } from "@/lib/mock/market-aliases";

const JAX = "jacksonville florida fl";

describe("marketMatchesQuery", () => {
  it("matches however people actually type a city", () => {
    expect(marketMatchesQuery(JAX, "jacksonville")).toBe(true);
    expect(marketMatchesQuery(JAX, "jacksonville florida")).toBe(true);
    expect(marketMatchesQuery(JAX, "Jacksonville, FL")).toBe(true);
    expect(marketMatchesQuery(JAX, "florida jacksonville")).toBe(true);
    expect(marketMatchesQuery(JAX, "  jacksonville ,  fl ")).toBe(true);
  });

  it("requires every token, so a state pins down shared names", () => {
    const spMo = "springfield missouri mo";
    const spIl = "springfield illinois il";
    expect(marketMatchesQuery(spMo, "springfield mo")).toBe(true);
    expect(marketMatchesQuery(spIl, "springfield mo")).toBe(false);
  });

  it("rejects tokens that appear nowhere (typos stay honest)", () => {
    expect(marketMatchesQuery(JAX, "jacksonville florda")).toBe(false);
  });

  it("treats an empty query as match-all", () => {
    expect(marketMatchesQuery(JAX, "")).toBe(true);
    expect(marketMatchesQuery(JAX, " , ")).toBe(true);
  });
});

describe("normalizeKeyword", () => {
  it("is punctuation- and case-blind on both sides", () => {
    expect(normalizeKeyword("Water Front")).toBe("waterfront");
    expect(normalizeKeyword("washer & dryer")).toBe("washerdryer");
    expect(normalizeKeyword("PET-FRIENDLY")).toBe("petfriendly");
  });
});

describe("countSummary", () => {
  it("names the sizes rather than a floor", () => {
    expect(countSummary([], "bd")).toBeUndefined();
    expect(countSummary([2], "bd")).toBe("2 bd");
    expect(countSummary([1, 2], "bd")).toBe("1, 2 bd");
    // The top tile is open-ended, and the chip says so.
    expect(countSummary([5], "ba")).toBe("5+ ba");
    // Too many to name; the chip has finite room.
    expect(countSummary([1, 2, 3, 4], "bd")).toBe("4 sizes");
  });

  it("reads the same however the tiles were clicked", () => {
    expect(countSummary([3, 1], "bd")).toBe(countSummary([1, 3], "bd"));
  });
});

describe("state codes match as whole words", () => {
  // "portland" contains an "or"; "new hampshire" contains a "ne". The
  // substring test matched both, and the Deal Finder only goes live
  // when a search resolves to exactly ONE market — so these two
  // silently never loaded live inventory.
  const hits = (q: string) =>
    MARKETS.filter((m) => marketMatchesQuery(marketSearchText(m), q)).map((m) => m.slug);

  it("pins Portland, OR to Oregon", () => {
    expect(hits("Portland, OR")).toEqual(["portland-or"]);
  });

  it("pins Lincoln, NE to Nebraska", () => {
    expect(hits("Lincoln, NE")).toEqual(["lincoln-ne"]);
  });

  it("still matches a partial city name", () => {
    expect(marketMatchesQuery(marketSearchText(MARKETS[0]), MARKETS[0].name.slice(0, 4))).toBe(true);
  });
});

describe("course-list names resolve", () => {
  // Straight off the mentorship PDF: these are markets we already
  // carry under a different name, and every one was a dead end.
  const only = (q: string) => {
    const hit = MARKETS.filter((m) => marketMatchesQuery(marketSearchText(m), q));
    return hit.length === 1 ? hit[0].slug : hit.map((m) => m.slug);
  };

  it.each([
    ["Oahu, HI", "honolulu"],
    ["Big Island, HI", "kailua-kona"],
    ["Kauai, HI", "princeville"],
    ["Ft Lauderdale, FL", "fort-lauderdale"],
    ["Monterey Bay, CA", "monterey"],
    ["Jacksonville Beach, FL", "jacksonville"],
    ["Longboat Key, FL", "sarasota"],
    ["Siesta Key, FL", "sarasota"],
  ])("%s finds %s", (query, slug) => {
    expect(only(query)).toBe(slug);
  });

  it("keeps an alias from renaming anything", () => {
    const honolulu = MARKETS.find((m) => m.slug === "honolulu");
    expect(honolulu?.name).toBe("Honolulu");
  });
});
