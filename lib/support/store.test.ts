import { describe, expect, it } from "vitest";
import { searchFilter } from "./store";

/**
 * The search box reaches PostgREST's filter grammar, and that grammar
 * is made of exactly the characters people put in search boxes: commas
 * close a list, dots start an operator, parentheses group. These tests
 * are about the one failure that matters — a term that stops being a
 * term and starts being syntax.
 */
describe("the search filter", () => {
  it("builds a wildcard match across the columns a person would search", () => {
    const filter = searchFilter("refund");
    expect(filter).toBe(
      "or=(subject.ilike.*refund*,ref.ilike.*refund*,user_email.ilike.*refund*,user_name.ilike.*refund*)"
    );
  });

  it("keeps the characters an address or a reference is made of", () => {
    expect(searchFilter("a.member@example.com")).toContain("*a.member@example.com*");
    expect(searchFilter("7KP4R2")).toContain("*7KP4R2*");
    expect(searchFilter("jean-luc")).toContain("*jean-luc*");
  });

  it("lets a multi-word term match across the gap", () => {
    expect(searchFilter("credits missing")).toContain("*credits*missing*");
  });

  it("strips every character that means something to the grammar", () => {
    for (const term of [
      "a,b",
      "x)or(y",
      "status.eq.open",
      "a*b",
      "'; drop--",
      "a\\b",
    ]) {
      const filter = searchFilter(term);
      if (filter === null) continue;
      // The term sits between the wildcards this function put there;
      // no other punctuation survives to be read as syntax.
      const terms = filter.match(/ilike\.([^,)]*)/g) ?? [];
      expect(terms.length).toBe(4);
      for (const t of terms) {
        expect(t.replace(/^ilike\./, "")).toMatch(/^\*[A-Za-z0-9 @._*-]*\*$/);
      }
    }
  });

  it("declines a term too short to be worth a table scan", () => {
    expect(searchFilter("a")).toBeNull();
    expect(searchFilter("   ")).toBeNull();
    expect(searchFilter("()")).toBeNull();
  });

  it("bounds the length, so one box cannot become one enormous filter", () => {
    const filter = searchFilter("x".repeat(500));
    expect(filter).not.toBeNull();
    expect(filter!.length).toBeLessThan(400);
  });
});
