import { describe, expect, it } from "vitest";
import { activityOf, compFieldsSeen, wholePlace, airbnbRoomUrl, vrboListingUrl, COMPS_PATH, compsParams, extractArray, mapComp, MARKET_PATH, mapMarketAnalytics, parseJsonKeepingBigIds, rememberCompShape, toFraction } from "./airroi";

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

describe("a room link is never built from a rounded id", () => {
  const ROUNDED = "1482756537092586000";
  const EXACT = "1482756537092586123";

  it("refuses the printed form of a double and keeps a real id", () => {
    expect(airbnbRoomUrl(ROUNDED)).toBeNull();
    expect(airbnbRoomUrl(Number(EXACT))).toBeNull();
    expect(airbnbRoomUrl(EXACT)).toBe(`https://www.airbnb.com/rooms/${EXACT}`);
    expect(airbnbRoomUrl(41234567)).toBe("https://www.airbnb.com/rooms/41234567");
    expect(vrboListingUrl(ROUNDED)).toBeNull();
  });

  it("maps a comp whose id arrived rounded with no link at all", () => {
    // The card then offers the area on the platform — real inventory —
    // rather than a room page that does not exist.
    const c = mapComp(realComp({ listing_info: { listing_id: Number(EXACT), listing_name: "Loft" } }), 0);
    expect(c?.listingUrl).toBeUndefined();
  });
});

describe("a comp the feed says is no longer listed", () => {
  it("is not a comp at all", () => {
    // Its year's earnings are history, not the market someone is about
    // to enter, and its room page is the platform's error page.
    for (const gone of [{ is_active: false }, { status: "inactive" }, { unlisted: true }]) {
      expect(
        mapComp(realComp({ listing_info: { listing_id: 36549812, listing_name: "Gone", ...gone } }), 0)
      ).toBeNull();
    }
  });

  it("links as before when the feed says it is live, or says nothing", () => {
    const live = mapComp(realComp({ listing_info: { listing_id: 36549812, listing_name: "Up", status: "active" } }), 0);
    expect(live?.active).toBe(true);
    expect(live?.listingUrl).toBe("https://www.airbnb.com/rooms/36549812");
    const silent = mapComp(realComp({ listing_info: { listing_id: 36549812, listing_name: "Unknown" } }), 0);
    expect(silent?.active).toBeUndefined();
    expect(silent?.listingUrl).toBe("https://www.airbnb.com/rooms/36549812");
  });

  it("reads the signal in the shapes feeds use, and names the field", () => {
    expect(activityOf({ is_active: true }, null)).toMatchObject({ active: true, key: "is_active" });
    expect(activityOf({ unlisted: true }, null)).toMatchObject({ active: false, key: "unlisted" });
    expect(activityOf({ active: 0 }, null)).toMatchObject({ active: false, key: "active" });
    expect(activityOf({}, { status: "Inactive" })).toMatchObject({ active: false, key: "listing_info.status" });
    expect(activityOf({ status: "live" }, null)).toMatchObject({ active: true, key: "status" });
    expect(activityOf({ status: "something else" }, null)).toMatchObject({ active: null, key: null });
    expect(activityOf({}, null)).toMatchObject({ active: null, key: null });
  });
});

describe("still listed, read off the last ninety days' calendar", () => {
  const withCalendar = (metrics: Record<string, number>) =>
    realComp({ performance_metrics: { ttm_avg_rate: 214.6, ttm_occupancy: 0.63, ...metrics } });

  it("leaves out a comp with no days at all in the last ninety", () => {
    expect(mapComp(withCalendar({ l90d_total_days: 0 }), 0)).toBeNull();
    expect(
      mapComp(withCalendar({ l90d_available_days: 0, l90d_days_reserved: 0, l90d_blocked_days: 0 }), 0)
    ).toBeNull();
  });

  it("keeps a listing with a calendar, however quiet", () => {
    // Blocked or unbooked is still on the platform.
    expect(mapComp(withCalendar({ l90d_total_days: 90, l90d_days_reserved: 0 }), 0)?.active).toBe(true);
    expect(
      mapComp(withCalendar({ l90d_available_days: 0, l90d_days_reserved: 0, l90d_blocked_days: 90 }), 0)?.active
    ).toBe(true);
  });

  /**
   * The link, decided separately and more strictly than membership.
   *
   * A comp set is trailing-twelve-month evidence, so it carries
   * listings that earned in the year and have since come down — and
   * the room page of one of those is the platform's "something went
   * wrong" screen, which is what two people in five were landing on.
   * The one thing in the payload that speaks to it is the last ninety
   * days: a listing nobody could have stayed in for a whole quarter is
   * as likely to be gone as to be somebody's own house for the season,
   * and the payload cannot tell those apart. So the year's figures
   * stay and the promise does not.
   */
  describe("the room link", () => {
    it("is withheld when no night of the window was open or booked", () => {
      const c = mapComp(
        withCalendar({ l90d_available_days: 0, l90d_days_reserved: 0, l90d_blocked_days: 90 }),
        0
      );
      expect(c?.linkWithheld).toBe("calendar-closed");
      expect(c?.listingUrl).toBeUndefined();
      // And the comp is still a comp: every figure the projection
      // stands on is untouched.
      expect(c?.adr).toBe(215);
      expect(c?.occupancy).toBeCloseTo(0.63);
      expect(c?.id).toBe("sc-live-41234567");
    });

    it("survives a single bookable night, open or taken", () => {
      for (const metrics of [
        { l90d_available_days: 1, l90d_days_reserved: 0, l90d_blocked_days: 89 },
        { l90d_available_days: 0, l90d_days_reserved: 12, l90d_blocked_days: 78 },
      ]) {
        const c = mapComp(withCalendar(metrics), 0);
        expect(c?.linkWithheld).toBeUndefined();
        expect(c?.listingUrl).toBe("https://www.airbnb.com/rooms/41234567");
      }
    });

    it("is kept when the feed states neither count — nothing inferred from silence", () => {
      // A payload with only a window length, or no calendar at all,
      // says nothing about whether anybody could have stayed.
      const unjudgeable: Record<string, number>[] = [
        { l90d_total_days: 90 },
        { l90d_blocked_days: 90 },
      ];
      for (const metrics of unjudgeable) {
        expect(mapComp(withCalendar(metrics), 0)?.listingUrl).toBe(
          "https://www.airbnb.com/rooms/41234567"
        );
      }
      expect(mapComp(realComp(), 0)?.listingUrl).toBe("https://www.airbnb.com/rooms/41234567");
    });

    it("reads the two counts that mean somebody could have stayed", () => {
      const bookable = (m: Record<string, number>) => activityOf(m, null).bookable;
      expect(bookable({ l90d_available_days: 0, l90d_days_reserved: 0 })).toBe(false);
      expect(bookable({ l90d_available_days: 3 })).toBe(true);
      expect(bookable({ l90d_days_reserved: 3 })).toBe(true);
      expect(bookable({ l90d_blocked_days: 90 })).toBeNull();
      expect(bookable({})).toBeNull();
    });
  });

  it("keeps a comp whose payload carries no calendar, and says so", () => {
    expect(mapComp(realComp(), 0)?.active).toBeUndefined();
    expect(activityOf(realComp(), null)).toEqual({ active: null, key: null, bookable: null });
    expect(activityOf(withCalendar({ l90d_total_days: 12 }), null)).toEqual({
      active: true,
      key: "performance_metrics.l90d_total_days",
      bookable: null,
    });
  });

  it("lets an explicit flag speak first", () => {
    expect(
      mapComp(
        realComp({
          listing_info: { listing_id: 1, listing_name: "x", is_active: false },
          performance_metrics: { ttm_avg_rate: 200, ttm_occupancy: 0.5, l90d_total_days: 90 },
        }),
        0
      )
    ).toBeNull();
  });
});

describe("whole places only", () => {
  it("leaves out a room in somebody's home", () => {
    for (const type of ["Private room", "Shared room", "Hotel room", "private_room"]) {
      expect(
        mapComp(realComp({ listing_info: { listing_id: 1, listing_name: "Room", room_type: type } }), 0)
      ).toBeNull();
    }
  });

  it("keeps a whole place, and a comp that does not say", () => {
    expect(
      mapComp(realComp({ listing_info: { listing_id: 1, listing_name: "Home", room_type: "Entire home/apt" } }), 0)
    ).not.toBeNull();
    expect(
      mapComp(realComp({ listing_info: { listing_id: 1, listing_name: "Home", listing_type: "Entire place" } }), 0)
    ).not.toBeNull();
    expect(mapComp(realComp(), 0)).not.toBeNull();
    expect(wholePlace({}, null)).toBe(true);
    expect(wholePlace({}, { room_type: "Private room" })).toBe(false);
  });
});

/**
 * The staff diagnostic, which exists because this file has twice been
 * given a rule about which comps are still listed, written from one
 * row of one payload, and twice the links went on failing. A sample of
 * one cannot say whether a rule fires — a JSON feed omits null fields
 * per row, so the first comp does not know what the twentieth carries.
 * So it counts, across the whole set, and the counts are the thing
 * that settles an argument about the vendor's schema.
 */
describe("what the whole comp payload looks like", () => {
  const comp = (over: Record<string, unknown> = {}) => realComp(over);
  /** A nineteen-digit id, and the printed form of the double nearest
   *  it — the pair the id tally has to tell apart. */
  const EXACT_ID = "1482756537092586123";
  const ROUNDED_ID = "1482756537092586000";
  const closed = {
    performance_metrics: {
      ttm_avg_rate: 200,
      ttm_occupancy: 0.4,
      l90d_total_days: 90,
      l90d_available_days: 0,
      l90d_days_reserved: 0,
      l90d_blocked_days: 90,
    },
  };
  const open = {
    performance_metrics: {
      ttm_avg_rate: 300,
      ttm_occupancy: 0.6,
      l90d_total_days: 90,
      l90d_available_days: 40,
      l90d_days_reserved: 30,
      l90d_blocked_days: 20,
    },
  };

  it("counts how many comps each rule removes or unlinks", () => {
    rememberCompShape([comp(closed), comp(open), comp()], ["revenue", "comparable_listings"]);
    const shape = compFieldsSeen()!;
    expect((shape.$withheld as string[])[0]).toContain("1 of 3 with no open or booked night");
    // The comp with no calendar at all is the one no rule can judge.
    expect((shape.$withheld as string[])[1]).toContain("1 of 3 the calendar cannot judge");
    expect((shape.$inactive as string[])[0]).toContain("0 of 3");
  });

  it("says on how many comps the feed states each calendar count", () => {
    rememberCompShape([comp(closed), comp(open), comp()]);
    const calendar = compFieldsSeen()!.$calendar as Record<string, string>;
    expect(calendar.l90d_total_days).toBe("stated on 2 of 3");
    expect(calendar.l90d_available_days).toBe("stated on 2 of 3");
    expect(calendar.l90d_days_reserved).toBe("stated on 2 of 3");
  });

  it("tallies every id in the set, not only the first", () => {
    // One rounded id among twenty-five is a broken link invisible in a
    // sample of one. ROUNDED is the printed form of a double.
    rememberCompShape([
      comp({ listing_info: { listing_id: 41234567, listing_name: "a" } }),
      comp({ listing_info: { listing_id: EXACT_ID, listing_name: "b" } }),
      comp({ listing_info: { listing_id: ROUNDED_ID, listing_name: "c" } }),
    ]);
    const ids = compFieldsSeen()!.$ids as Record<string, string>;
    expect(ids.byLength).toBe("1x 8 digits, 2x 19 digits");
    expect(ids.exact).toBe("2");
    expect(ids.rounded).toBe("1");
  });

  it("unions the field names across every comp, with how many carry each", () => {
    // The field that exists on one listing in fifty is exactly the one
    // a first-row glance reports as absent.
    rememberCompShape([
      comp(),
      comp({ listing_info: { listing_id: 2, listing_name: "b", status: "active" } }),
    ]);
    const fields = compFieldsSeen()!.$fields as Record<string, { present: number }>;
    expect(fields["listing_info.status"].present).toBe(1);
    expect(fields["performance_metrics.ttm_avg_rate"].present).toBe(2);
  });

  it("spreads the day counts, which is what says whether they mean anything", () => {
    // The only fields in the payload that could separate a listing
    // that is still up from one that came down — if they count days
    // observed rather than the length of the window.
    const days = (l90: number, ttm: number) =>
      comp({
        performance_metrics: {
          ttm_avg_rate: 200,
          ttm_occupancy: 0.5,
          l90d_total_days: l90,
          ttm_total_days: ttm,
        },
      });
    rememberCompShape([days(90, 365), days(90, 365), days(44, 365), days(20, 40)]);
    const span = compFieldsSeen()!.$span as Record<string, string>;
    expect(span.l90d_total_days).toBe("2 of 4 at 90, 1 at 30-59, 1 at 1-29");
    expect(span.ttm_total_days).toBe("3 of 4 at 365, 1 at 1-89");
  });

  it("says so when the feed states no day counts at all", () => {
    rememberCompShape([comp()]);
    const span = compFieldsSeen()!.$span as Record<string, string>;
    expect(span.l90d_total_days).toBe("not stated");
    expect(span.ttm_total_days).toBe("not stated");
  });

  it("records the response's own keys, where a data-as-of stamp would be", () => {
    rememberCompShape([comp()], ["occupancy", "revenue", "as_of"]);
    expect(compFieldsSeen()!.$response).toEqual(["as_of", "occupancy", "revenue"]);
  });

  it("carries names and counts, never a value", () => {
    rememberCompShape([comp(), comp(closed)], ["revenue"]);
    const text = JSON.stringify(compFieldsSeen());
    expect(text).not.toContain("PROSE");
    expect(text).not.toContain("Riverside");
    expect(text).not.toContain("41234567");
    expect(text).not.toContain("30.3255");
  });
});
