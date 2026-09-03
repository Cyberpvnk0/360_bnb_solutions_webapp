import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { geocode, primaryGeocoder } from "@/lib/live/geocode";

/**
 * The order of the two geocoders is a money-for-accuracy trade, so it
 * is a setting rather than a decision baked into the code — and a
 * setting nobody can verify is a setting nobody should trust.
 */

const CENSUS_POINT = { lat: 30.1, lon: -81.1 };
const GOOGLE_POINT = { lat: 30.2, lon: -81.2 };

type Seen = { census: number; google: number };

function stubGeocoders({
  censusHit = true,
  googleHit = true,
}: { censusHit?: boolean; googleHit?: boolean } = {}) {
  const seen: Seen = { census: 0, google: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("geocoding.geo.census.gov")) {
        seen.census++;
        return Response.json({
          result: {
            addressMatches: censusHit
              ? [{ coordinates: { x: CENSUS_POINT.lon, y: CENSUS_POINT.lat } }]
              : [],
          },
        });
      }
      seen.google++;
      return Response.json({
        results: googleHit
          ? [{ geometry: { location: { lat: GOOGLE_POINT.lat, lng: GOOGLE_POINT.lon } } }]
          : [],
      });
    })
  );
  return seen;
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-google");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("which geocoder answers first", () => {
  it("asks Google by default, and never troubles Census when it answers", async () => {
    // Census interpolates along a street segment; that is the ten-to-
    // fifty metre error that frames the neighbour's house.
    const seen = stubGeocoders();
    const out = await geocode("1204 Glencoe St, Jacksonville, FL");
    expect(out.source).toBe("google");
    expect(out.point).toEqual(GOOGLE_POINT);
    expect(seen.census).toBe(0);
  });

  it("falls back to Census when Google has no match", async () => {
    const seen = stubGeocoders({ googleHit: false });
    const out = await geocode("1204 Glencoe St, Jacksonville, FL");
    expect(out.source).toBe("census");
    expect(out.point).toEqual(CENSUS_POINT);
    expect(seen.google).toBe(1);
  });

  it("puts the free one back in front on GEOCODER_PRIMARY=census", async () => {
    vi.stubEnv("GEOCODER_PRIMARY", "census");
    const seen = stubGeocoders();
    const out = await geocode("1204 Glencoe St, Jacksonville, FL");
    expect(out.source).toBe("census");
    expect(seen.google).toBe(0);
  });

  it("reads the setting case- and space-insensitively", () => {
    vi.stubEnv("GEOCODER_PRIMARY", "  Census ");
    expect(primaryGeocoder()).toBe("census");
    vi.stubEnv("GEOCODER_PRIMARY", "");
    expect(primaryGeocoder()).toBe("google");
    vi.stubEnv("GEOCODER_PRIMARY", "nonsense");
    expect(primaryGeocoder()).toBe("google");
  });

  it("still places a listing with no Google key at all", async () => {
    // Google first must not mean Google only: an unconfigured key
    // answers null, which is a miss and not a failure.
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const seen = stubGeocoders();
    const out = await geocode("1204 Glencoe St, Jacksonville, FL");
    expect(out.source).toBe("census");
    expect(seen.google).toBe(0);
  });

  it("says no-match, not network, when both answer and neither knows", async () => {
    stubGeocoders({ censusHit: false, googleHit: false });
    const out = await geocode("9999 Nowhere Ave");
    expect(out.point).toBeNull();
    expect(out.failure).toBe("no-match");
  });

  it("says network when neither can be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const out = await geocode("1204 Glencoe St");
    expect(out.point).toBeNull();
    expect(out.failure).toBe("network");
  });
});
