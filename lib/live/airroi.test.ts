import { describe, expect, it } from "vitest";
import { airbnbRoomUrl, vrboListingUrl, COMPS_PATH, compsParams, extractArray, mapComp, MARKET_PATH, mapMarketAnalytics, parseJsonKeepingBigIds, toFraction } from "./airroi";

describe("endpoint paths", () => {
  // An earlier draft invented a /v1/ prefix that does not exist, so the
  // first live call would have 404'd before any mapping ran.
  it("carries no version prefix", () => {
    expect(COMPS_PATH).toBe("/listings/comparables");
    expect(MARKET_PATH).toBe("/markets/lookup");
    expect(COMPS_PATH.startsWith("/v1")).toBe(false);
    expect(MARKET_PATH.startsWith("/v1")).toBe(false);
  });
});

describe("occupancy normalisation", () => {
  it("accepts either scale and stores fractions", () => {
    expect(toFraction(62)).toBeCloseTo(0.62);
    expect(toFraction(0.62)).toBeCloseTo(0.62);
    expect(toFraction(140)).toBeNull();
  });
});

describe("comp coordinates", () => {
  it("keeps a real position when the feed gives one", () => {
    const c = mapComp(
      { id: "1", adr: 210, occupancy: 0.64, bedrooms: 2, latitude: 30.33, longitude: -81.66 },
      0
    );
    expect(c?.lat).toBeCloseTo(30.33);
    expect(c?.lon).toBeCloseTo(-81.66);
  });

  it("accepts lng as well as longitude", () => {
    const c = mapComp({ id: "2", adr: 180, occupancy: 55, lat: 27.95, lng: -82.46 }, 0);
    expect(c?.lat).toBeCloseTo(27.95);
    expect(c?.lon).toBeCloseTo(-82.46);
  });

  it("refuses half a coordinate rather than pinning the meridian", () => {
    const c = mapComp({ id: "3", adr: 180, occupancy: 0.5, latitude: 27.95 }, 0);
    expect(c?.lat).toBeUndefined();
    expect(c?.lon).toBeUndefined();
  });

  it("refuses an out-of-range pair", () => {
    const c = mapComp({ id: "4", adr: 180, occupancy: 0.5, latitude: 991, longitude: -82 }, 0);
    expect(c?.lat).toBeUndefined();
  });

  it("drops a comp with no rate — a fabricated one poisons the projection", () => {
    expect(mapComp({ id: "5", occupancy: 0.6 }, 0)).toBeNull();
  });
});

describe("market analytics", () => {
  it("reads the vendor's documented field names", () => {
    const m = mapMarketAnalytics({
      avg_daily_rate: 212.4,
      avg_occupancy: 61,
      active_listings: 3910,
    });
    expect(m?.adr).toBe(212);
    expect(m?.occupancy).toBeCloseTo(0.61);
    expect(m?.activeListings).toBe(3910);
  });
});


/**
 * A comp exactly as the service sends one — the eight nested groups,
 * with only the fields the mapper reads filled in. Written from an
 * observed response, not from a guess at one.
 */
function realComp(over: Record<string, unknown> = {}) {
  return {
    listing_info: { listing_id: 41234567, listing_name: "Riverside 2BR", description: "PROSE THAT MUST NOT ESCAPE" },
    location_info: { latitude: 30.3255, longitude: -81.6612, exact_location: true },
    property_details: { guests: 4, bedrooms: 2, beds: 3, baths: 2 },
    performance_metrics: {
      ttm_avg_rate: 214.6,
      ttm_occupancy: 0.63,
      ttm_adjusted_occupancy: 0.81,
      ttm_revenue: 49_340,
    },
    ...over,
  };
}

describe("the real nested payload", () => {
  it("reads rate, occupancy and size out of their groups", () => {
    const c = mapComp(realComp(), 0);
    expect(c?.adr).toBe(215);
    expect(c?.occupancy).toBeCloseTo(0.63);
    expect(c?.bedrooms).toBe(2);
    expect(c?.bathrooms).toBe(2);
  });

  it("takes bedrooms, not beds — a studio with two beds is not a 2BR", () => {
    const c = mapComp(realComp({ property_details: { bedrooms: 0, beds: 2, baths: 1 } }), 0);
    expect(c?.bedrooms).toBe(0);
  });

  it("uses unadjusted occupancy, the conservative one", () => {
    // Adjusted (0.81) excludes nights the host blocked. Someone holding
    // a lease has all 365 to fill, so the lower figure is the honest one.
    expect(mapComp(realComp(), 0)?.occupancy).toBeCloseTo(0.63);
  });

  it("keeps the measured annual revenue rather than recomputing it", () => {
    expect(mapComp(realComp(), 0)?.annualRevenue).toBe(49_340);
  });

  it("carries no prose anywhere in the result", () => {
    const c = mapComp(realComp(), 0);
    expect(JSON.stringify(c)).not.toContain("PROSE");
  });

  it("pins an exact location", () => {
    const c = mapComp(realComp(), 0);
    expect(c?.lat).toBeCloseTo(30.3255);
    expect(c?.lon).toBeCloseTo(-81.6612);
  });

  it("keeps a blurred location and labels it", () => {
    // Airbnb blurs a listing until it is booked — all twelve comps in
    // the first live pull were blurred. Discarding them sent the map to
    // a hashed random bearing, which is further from the truth than the
    // blur is.
    const c = mapComp(
      realComp({ location_info: { latitude: 30.3, longitude: -81.6, exact_location: false } }),
      0
    );
    expect(c?.lat).toBeCloseTo(30.3);
    expect(c?.exactLocation).toBe(false);
  });

  it("marks an exact location as exact", () => {
    expect(mapComp(realComp(), 0)?.exactLocation).toBe(true);
  });

  it("still reads a flat payload, so a reshape degrades instead of vanishing", () => {
    const c = mapComp({ id: "x", adr: 180, occupancy: 0.55, bedrooms: 1 }, 0);
    expect(c?.adr).toBe(180);
  });

  it("finds the row array under their `listings` key", () => {
    expect(extractArray({ listings: [realComp(), realComp()] })).toHaveLength(2);
  });
});

describe("the comps query", () => {
  it("always sends every parameter the service requires", () => {
    // "query param baths must not be null" — they are required, so an
    // omitted one is a guaranteed 400 rather than a looser search. This
    // exact omission shipped three times from three copies of the list.
    const p = compsParams(30.33, -81.66, {});
    for (const k of ["latitude", "longitude", "bedrooms", "baths", "guests", "currency"]) {
      expect(p[k], k).toBeTruthy();
    }
  });

  it("uses what the caller knows when the caller knows it", () => {
    const p = compsParams(30.33, -81.66, { bedrooms: 3, baths: 2.5, guests: 7 });
    expect(p.bedrooms).toBe("3");
    expect(p.baths).toBe("2.5");
    expect(p.guests).toBe("7");
  });

  it("defaults a studio to something the service will accept", () => {
    const p = compsParams(30.33, -81.66, { bedrooms: 0 });
    expect(Number(p.baths)).toBeGreaterThan(0);
    expect(Number(p.guests)).toBeGreaterThan(0);
  });
});

describe("a comp's own page and picture", () => {
  it("names the listing's page from its id, and only from a real id", () => {
    expect(airbnbRoomUrl(41234567)).toBe("https://www.airbnb.com/rooms/41234567");
    expect(airbnbRoomUrl("41234567")).toBe("https://www.airbnb.com/rooms/41234567");
    expect(airbnbRoomUrl("abc")).toBeNull();
    expect(airbnbRoomUrl(null)).toBeNull();
  });

  it("carries the feed's link and cover photo when they are https, never prose", () => {
    const comp = mapComp(
      realComp({
        listing_info: {
          listing_id: 41234567,
          listing_name: "Riverside 2BR",
          listing_url: "https://www.airbnb.com/rooms/41234567?src=feed",
          picture_url: "https://a0.muscache.com/im/pictures/abc.jpg",
          description: "PROSE THAT MUST NOT ESCAPE",
        },
      }),
      0
    );
    expect(comp?.listingUrl).toBe("https://www.airbnb.com/rooms/41234567?src=feed");
    expect(comp?.photoUrl).toBe("https://a0.muscache.com/im/pictures/abc.jpg");
    expect(JSON.stringify(comp)).not.toContain("PROSE");
  });

  it("falls back to the page the id names, and to no photo at all", () => {
    const comp = mapComp(realComp({}), 0);
    expect(comp?.listingUrl).toBe("https://www.airbnb.com/rooms/41234567");
    expect(comp?.photoUrl).toBeUndefined();
  });
});

describe("which platform a comp's link points at", () => {
  it("sends a Vrbo listing to Vrbo, and an unknown platform nowhere", () => {
    const vrbo = mapComp(
      realComp({ listing_info: { listing_id: 987654, listing_name: "Lake house", platform: "vrbo" } }),
      0
    );
    expect(vrbo?.listingUrl).toBe("https://www.vrbo.com/987654");
    const other = mapComp(
      realComp({ listing_info: { listing_id: 987654, listing_name: "Lake house", platform: "booking.com" } }),
      0
    );
    expect(other?.listingUrl).toBeUndefined();
    expect(vrboListingUrl("abc")).toBeNull();
  });

  it("prefers a platform-named id over the generic one", () => {
    const comp = mapComp(
      realComp({ listing_info: { listing_id: 1, listing_name: "x", airbnb_id: 41234567 } }),
      0
    );
    expect(comp?.listingUrl).toBe("https://www.airbnb.com/rooms/41234567");
  });
});

describe("ids past 2^53 survive the parse", () => {
  const BIG = "1482756537092586123";

  it("quotes an integer a JavaScript number cannot hold exactly", () => {
    // JSON.parse alone reads this as …586000 and the room URL built
    // from it opens Airbnb's "something went wrong" page.
    const parsed = parseJsonKeepingBigIds(`{"listing_id":${BIG},"adr":181.5}`) as Record<string, unknown>;
    expect(parsed.listing_id).toBe(BIG);
    expect(parsed.adr).toBe(181.5);
  });

  it("leaves every number a JavaScript number can hold alone", () => {
    const parsed = parseJsonKeepingBigIds(
      `{"a":41234567,"b":-12,"c":0.42,"d":1e5,"e":9007199254740991,"f":[1,2,3]}`
    ) as Record<string, unknown>;
    expect(parsed).toEqual({ a: 41234567, b: -12, c: 0.42, d: 1e5, e: 9007199254740991, f: [1, 2, 3] });
  });

  it("does not touch digits inside a string, prose included", () => {
    const text = `{"description":"call ${BIG}, or 1234567890123456789, today","q":"a \\"quoted\\" ${BIG}","id":${BIG}}`;
    const parsed = parseJsonKeepingBigIds(text) as Record<string, unknown>;
    expect(parsed.description).toBe(`call ${BIG}, or 1234567890123456789, today`);
    expect(parsed.q).toBe(`a "quoted" ${BIG}`);
    expect(parsed.id).toBe(BIG);
  });

  it("handles ids nested inside the groups the feed actually uses", () => {
    const parsed = parseJsonKeepingBigIds(
      `{"data":[{"listing_info":{"listing_id":${BIG},"platform":"airbnb"},"performance_metrics":{"ttm_avg_rate":120}}]}`
    ) as { data: Array<{ listing_info: { listing_id: unknown } }> };
    expect(parsed.data[0].listing_info.listing_id).toBe(BIG);
  });

  it("builds the room link from the exact id once it arrives as a string", () => {
    const c = mapComp(realComp({ listing_info: { listing_id: BIG, listing_name: "Loft" } }), 0);
    expect(c?.listingUrl).toBe(`https://www.airbnb.com/rooms/${BIG}`);
    expect(c?.id).toBe(`sc-live-${BIG}`);
  });

  it("still throws on a body that is not JSON, so the caller sees null", () => {
    expect(() => parseJsonKeepingBigIds("<html>nope</html>")).toThrow();
  });
});
