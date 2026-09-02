import { describe, expect, it } from "vitest";
import { aerialUrl } from "./aerial";

describe("the aerial URL", () => {
  it("puts longitude before latitude, their way round", () => {
    // Their order is the opposite of every other point in this
    // codebase. Backwards puts Tampa in the Indian Ocean and returns a
    // photograph of open water, which looks like a working integration
    // right up until somebody looks at a card.
    const url = aerialUrl(27.9506, -82.4572, "tok");
    expect(url).toContain("/-82.4572,27.9506,");
    expect(url).not.toContain("/27.9506,-82.4572,");
  });

  it("frames a lot rather than cropping into the roof", () => {
    expect(aerialUrl(27.9506, -82.4572, "tok")).toContain(",18,0/");
  });

  it("escapes the token rather than pasting it raw", () => {
    expect(aerialUrl(1, 2, "a b+c")).toContain("access_token=a%20b%2Bc");
  });
});
