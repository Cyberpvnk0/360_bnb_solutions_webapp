import { afterEach, describe, expect, it } from "vitest";
import { googleMapsKey, hasGoogleKey } from "./street-view";

const NAMES = [
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_SECRET",
  "GOOGLE_MAPS_KEY",
  "GOOGLE_API_KEY",
];

afterEach(() => {
  for (const n of NAMES) delete process.env[n];
});

describe("finding the Google key whatever it was called", () => {
  it("takes the documented name", () => {
    process.env.GOOGLE_MAPS_API_KEY = "a";
    expect(googleMapsKey()).toBe("a");
    expect(hasGoogleKey()).toBe(true);
  });

  it("takes the name it was actually saved under", () => {
    // Saved as GOOGLE_MAPS_SECRET in the dashboard. A resolver that
    // only knew the documented spelling would report "not configured"
    // for a key sitting right there, which is an afternoon lost to a
    // string.
    process.env.GOOGLE_MAPS_SECRET = "b";
    expect(googleMapsKey()).toBe("b");
  });

  it("prefers the documented name when both are set", () => {
    // Two names set means somebody migrated and left the old one. The
    // documented one is the deliberate one.
    process.env.GOOGLE_MAPS_API_KEY = "a";
    process.env.GOOGLE_MAPS_SECRET = "b";
    expect(googleMapsKey()).toBe("a");
  });

  it("ignores an empty value rather than treating it as configured", () => {
    // Vercel keeps a variable with a blank value after you clear it,
    // and "" is falsy but present — a key check on presence alone
    // reports configured and then every call 403s.
    process.env.GOOGLE_MAPS_API_KEY = "";
    process.env.GOOGLE_MAPS_SECRET = "b";
    expect(googleMapsKey()).toBe("b");
  });

  it("says no when nothing is set", () => {
    expect(googleMapsKey()).toBeNull();
    expect(hasGoogleKey()).toBe(false);
  });
});
