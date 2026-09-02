import { describe, expect, it } from "vitest";

import { localityLine } from "@/lib/format";

/**
 * Feed addresses arrive fully postal, so the line under the address is
 * only worth printing when it says something the address did not.
 */
describe("localityLine", () => {
  it("prints nothing when the address already names the city", () => {
    expect(
      localityLine("506 Lexington Pkwy N Unit 1, St Paul, MN 55104", "St. Paul", "MN")
    ).toBeNull();
  });

  it("sees through punctuation the two feeds disagree on", () => {
    // "St Paul" in the address against "St. Paul" as the city name is
    // the same city, and an exact-text check printed it twice.
    expect(localityLine("1 Main St, St Paul, MN", "St. Paul", "MN")).toBeNull();
    expect(localityLine("1 Main St, Ft. Myers, FL", "Fort Myers", "FL")).toBe(
      "Fort Myers, FL"
    );
  });

  it("prints the city when the address is street-only", () => {
    expect(localityLine("1204 Glencoe St", "Tampa", "FL")).toBe("Tampa, FL");
  });

  it("keeps a neighbourhood, which the address never carries", () => {
    expect(
      localityLine("506 Lexington Pkwy N, St Paul, MN", "St. Paul", "MN", "Frogtown")
    ).toBe("Frogtown");
    expect(localityLine("1204 Glencoe St", "Tampa", "FL", "Seminole Heights")).toBe(
      "Seminole Heights · Tampa, FL"
    );
  });

  it("does not match a city whose name is empty", () => {
    // Every string contains "", so an unguarded check would suppress
    // the line on every listing with no city.
    expect(localityLine("1204 Glencoe St", "", "FL")).toBe(", FL");
  });

  it("does not find a city hiding inside a longer word", () => {
    // A substring test on the stripped letters finds "ada" inside
    // "nevada" and drops a line that should have printed.
    expect(localityLine("1 Nevada Ave", "Ada", "OK")).toBe("Ada, OK");
    expect(localityLine("22 Reno Dr", "Ren", "NV")).toBe("Ren, NV");
  });
});
