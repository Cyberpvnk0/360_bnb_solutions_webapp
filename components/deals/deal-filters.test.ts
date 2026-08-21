import { describe, expect, it } from "vitest";
import { marketMatchesQuery, normalizeKeyword } from "./deal-filters";

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
