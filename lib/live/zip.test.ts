import { describe, expect, it } from "vitest";
import { inZip, zipFromAddress, zipOf } from "./zip";

describe("the ZIP at the end of an address line", () => {
  it("reads a five-digit tail, with or without the plus-four", () => {
    expect(zipFromAddress("1535 Van Buren St, Jacksonville, FL 32206")).toBe("32206");
    expect(zipFromAddress("1535 Van Buren St, Jacksonville, FL 32206-1234")).toBe("32206");
    expect(zipFromAddress("  9256 7th Ave Unit 4, Jacksonville, FL 32208 ")).toBe("32208");
  });

  it("finds nothing in a street line, and never mistakes a house number", () => {
    expect(zipFromAddress("1535 Van Buren St")).toBeUndefined();
    expect(zipFromAddress("10510 Plantain Ct")).toBeUndefined();
    expect(zipFromAddress(undefined)).toBeUndefined();
    expect(zipFromAddress("")).toBeUndefined();
  });
});

describe("which ZIP a listing is in", () => {
  it("trusts the feed's own field over the address tail", () => {
    expect(zipOf({ zip: "32225", address: "1 Main St, Jacksonville, FL 32206" })).toBe("32225");
    expect(zipOf({ address: "1 Main St, Jacksonville, FL 32206" })).toBe("32206");
  });

  it("keeps a ZIP search to that ZIP and leaves the unknown out", () => {
    expect(inZip({ address: "1 Main St, Jacksonville, FL 32225" }, "32225")).toBe(true);
    expect(inZip({ address: "1 Main St, Jacksonville, FL 32206" }, "32225")).toBe(false);
    // A street line alone is not known to be in the ZIP.
    expect(inZip({ address: "1 Main St" }, "32225")).toBe(false);
  });
});
