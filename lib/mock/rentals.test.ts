import { describe, expect, it } from "vitest";
import { estimateRentFromComps } from "@/lib/calc/comps";
import { ANALYSES, analysisForListing } from "./analyses";
import { adrFactorFor, BR_MULT, MARKET_BY_SLUG, MARKETS } from "./markets";
import { submarketsFor } from "./submarkets";
import {
  allRentals,
  BASE_FEATURES,
  BEDROOM_RENT_FACTOR,
  estimateCushionPts,
  RENTAL_BY_ANALYSIS_ID,
  rentalCountFor,
  rentalsFor,
  TERRAIN_FEATURES,
  totalRentalCount,
} from "./rentals";

describe("rentals", () => {
  it("every market's listings span its neighborhoods, matching the count", () => {
    for (const m of MARKETS) {
      const listings = rentalsFor(m);
      expect(listings.length).toBe(rentalCountFor(m));
      // 15–19 submarkets × 1–3 listings each.
      expect(listings.length).toBeGreaterThanOrEqual(15);
      expect(listings.length).toBeLessThanOrEqual(57);
      // Every neighborhood is represented — no downtown-only blobs.
      const subs = submarketsFor(m);
      const named = new Set(listings.map((l) => l.submarketName));
      expect(named.size).toBe(subs.length);
    }
  });

  it("listings spread across the metro, not one tight cluster", () => {
    // Jacksonville's neighborhoods span roughly a quarter degree; a
    // downtown-only blob would collapse this spread toward zero.
    const jax = MARKETS.find((m) => m.slug === "jacksonville")!;
    const listings = rentalsFor(jax);
    const lats = listings.map((l) => l.lat);
    const lons = listings.map((l) => l.lon);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0.1);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(0.1);
  });

  it("the analytic total matches the materialized total", () => {
    expect(totalRentalCount()).toBe(allRentals().length);
  });

  it("is deterministic across calls (memoized, same reference)", () => {
    const m = MARKETS[0];
    expect(rentalsFor(m)).toBe(rentalsFor(m));
    expect(allRentals()).toBe(allRentals());
  });

  it("asking rents track the neighborhood's own 2 bd median", () => {
    for (const listing of allRentals()) {
      const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
      const sub = submarketsFor(market).find(
        (x) => x.name === listing.submarketName
      )!;
      const base = sub.medianRent2br * BEDROOM_RENT_FACTOR[listing.bedrooms];
      // $25 rounding can nudge a boundary draw just past the raw band.
      expect(listing.rentMonthly).toBeGreaterThanOrEqual(base * 0.9 - 13);
      expect(listing.rentMonthly).toBeLessThanOrEqual(base * 1.1 + 13);
      expect(listing.rentMonthly % 25).toBe(0);
    }
  });

  it("ids and analysis ids are globally unique", () => {
    const all = allRentals();
    expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
    expect(new Set(all.map((l) => l.analysisId)).size).toBe(all.length);
  });

  it("listings sit near their parent market with the specified shapes", () => {
    for (const listing of allRentals()) {
      const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
      // Neighborhood offset (≤0.12) plus in-neighborhood jitter (≤0.012).
      expect(Math.abs(listing.lat - market.lat)).toBeLessThanOrEqual(0.14);
      expect(Math.abs(listing.lon - market.lon)).toBeLessThanOrEqual(0.14);
      expect(listing.city).toBe(market.name);
      expect(listing.stateCode).toBe(market.stateCode);
      expect(Number.isInteger(listing.bedrooms)).toBe(true);
      expect(listing.bedrooms).toBeGreaterThanOrEqual(1);
      expect(listing.bedrooms).toBeLessThanOrEqual(5);
      expect(listing.bathrooms * 2).toBeCloseTo(
        Math.round(listing.bathrooms * 2),
        8
      );
      expect(listing.sqft % 10).toBe(0);
      expect(Number.isInteger(listing.daysOnMarket)).toBe(true);
      expect(listing.daysOnMarket).toBeGreaterThanOrEqual(0);
      expect(listing.daysOnMarket).toBeLessThanOrEqual(45);
    }
  });

  it("cushion is whole points and pure", () => {
    const listing = allRentals()[0];
    const market = MARKET_BY_SLUG.get(listing.marketSlug)!;
    const pts = estimateCushionPts(listing, market);
    expect(Number.isInteger(pts)).toBe(true);
    expect(estimateCushionPts(listing, market)).toBe(pts);
    // Sanity: every bedroom count has a factor, INCLUDING the ones off
    // the ends of the table. Bare indexing returned undefined there,
    // and undefined times a dollar figure is NaN all the way down.
    for (const br of [0, 1, 2, 3, 4, 5, 6, 12]) {
      expect(adrFactorFor(br)).toBeGreaterThan(0);
      expect(BEDROOM_RENT_FACTOR[Math.min(5, Math.max(1, br))]).toBeGreaterThan(0);
    }
  });

  it("prices a studio off the one-bed floor and holds past five", () => {
    // The analyzer's size picker offers Studio and 6, so both ends are
    // one click away. Holding at the table's edge says "this is as far
    // as the data goes"; extrapolating would invent a premium and print
    // it as confidently as a measured one.
    expect(adrFactorFor(0)).toBe(adrFactorFor(1));
    expect(adrFactorFor(6)).toBe(adrFactorFor(5));
    expect(adrFactorFor(99)).toBe(adrFactorFor(5));
    expect(adrFactorFor(Number.NaN)).toBe(adrFactorFor(2));
  });

  it("uses the same ADR table the analyzer's comps are built from", () => {
    // Two tables disagreeing by size was worth up to five cushion
    // points between a card and the analyzer it opens. One table is the
    // only way they cannot drift apart again.
    for (const br of [1, 2, 3, 4, 5]) {
      expect(adrFactorFor(br)).toBe(BR_MULT[br]);
    }
  });

  it("indexes every listing by analysis id once materialized", () => {
    const all = allRentals();
    expect(RENTAL_BY_ANALYSIS_ID.size).toBe(all.length);
    expect(RENTAL_BY_ANALYSIS_ID.get(all[10].analysisId)).toBe(all[10]);
  });

  it("analysisForListing mirrors the listing, rent included", () => {
    for (const listing of allRentals().slice(0, 60)) {
      const a = analysisForListing(listing);
      expect(a.id).toBe(listing.analysisId);
      expect(a.address).toBe(listing.address);
      expect(a.city).toBe(listing.city);
      expect(a.stateCode).toBe(listing.stateCode);
      expect(a.marketSlug).toBe(listing.marketSlug);
      expect(a.bedrooms).toBe(listing.bedrooms);
      expect(a.bathrooms).toBe(listing.bathrooms);
      expect(a.propertyType).toBe(listing.propertyType);
      // THE ASKING RENT, not the median of the comps beside it.
      //
      // This assertion used to say the opposite, and the opposite was
      // the bug: a listing knows what it costs, and starting its
      // calculator from an estimate of what places like it cost made
      // the analyzer disagree with the card that opened it — by two
      // hundred dollars a month on the first row this test walks, which
      // moves the cushion, the cash flow and the verdict with it.
      //
      // The comp median still governs a TYPED address, which has no
      // listing behind it. That rule is pinned in the seeded-analysis
      // check below, where it still belongs.
      expect(a.defaults.monthlyRent).toBe(listing.rentMonthly);
    }
  });

  it("still starts a seeded pull from its own comp median", () => {
    // The fallback has to keep working: it is the honest answer for
    // every property nobody has an asking rent for.
    for (const a of ANALYSES.slice(0, 20)) {
      expect(a.defaults.monthlyRent).toBe(estimateRentFromComps(a.ltrComps));
    }
  });

  it("analysisForListing is memoized (same reference twice)", () => {
    const listing = allRentals()[3];
    expect(analysisForListing(listing)).toBe(analysisForListing(listing));
  });

  it("every listing carries 2–6 distinct feature tags", () => {
    for (const l of allRentals()) {
      expect(l.features.length).toBeGreaterThanOrEqual(2);
      expect(l.features.length).toBeLessThanOrEqual(6);
      expect(new Set(l.features).size).toBe(l.features.length);
    }
  });

  it("'Pet friendly' appears in features exactly when petFriendly is set", () => {
    for (const l of allRentals()) {
      expect(l.features.includes("Pet friendly")).toBe(l.petFriendly);
    }
  });

  it("every preview listing carries a reachable-looking, clearly fake contact", () => {
    for (const l of allRentals()) {
      const c = l.contact!;
      expect(c).toBeDefined();
      expect(c.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z']+$/);
      // 555-01xx and example.com are reserved for fiction — a demo must
      // never ring a real person or mail a real inbox.
      expect(c.phone).toMatch(/^\(\d{3}\) 555-01\d{2}$/);
      expect(c.email!.endsWith("example.com")).toBe(true);
      expect(["Property manager", "Owner"]).toContain(c.role);
      if (c.role === "Property manager") expect(c.company).toBeTruthy();
    }
  });

  it("every listing carries description text that agrees with its tags", () => {
    for (const l of allRentals().slice(0, 400)) {
      expect(l.description).toBeTruthy();
      // The prose and the chips come from one source, so a furnished
      // listing always says so in words — which is what keyword search
      // reads, exactly like searching a real listing description.
      const saysFurnished = /furnished/i.test(l.description!);
      expect(saysFurnished).toBe(l.features.includes("Furnished"));
      expect(l.description).toContain(l.submarketName!);
    }
  });

  it("feature tags respect the market's terrain — no waterfront in the desert", () => {
    for (const m of MARKETS) {
      const allowed = new Set<string>([
        "Furnished",
        "Pet friendly",
        ...BASE_FEATURES,
        ...TERRAIN_FEATURES[m.terrain],
      ]);
      for (const l of rentalsFor(m)) {
        for (const f of l.features) {
          expect(allowed.has(f), `${f} on ${l.id} (${m.terrain})`).toBe(true);
        }
      }
    }
  });
});
