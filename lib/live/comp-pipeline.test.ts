/**
 * From the vendor's payload to the panels, in one pass.
 *
 * Each step of this chain has its own tests. This one is about the
 * JOINTS, which is where the last two bugs lived: the amenity reader
 * looked in the wrong object and would have found nothing forever, and
 * nothing would have said so — a market with no data and a reader in
 * the wrong drawer render identically.
 *
 * So the fixture is a raw comp shaped exactly as the vendor's real
 * comparables response is (property_details.amenities, ratings.
 * num_reviews, host_info.superhost and .professional_management,
 * figures under performance_metrics, position under location_info),
 * and it is pushed the whole way: mapComp, into the pool, THROUGH A
 * JSON ROUND TRIP standing in for the store, back out past the type
 * guard, and into the three readers the market page hands its panels.
 */

import { describe, expect, it } from "vitest";
import { mapComp } from "./airroi";
import { isPoolComp, toPoolComps, type PoolComp } from "./comp-pool";
import { compSetStrength } from "@/lib/calc/comps";
import { readAmenities } from "@/lib/markets/amenities";
import { readCompetition, fieldOf } from "@/lib/markets/competition";
import type { StrComp } from "@/lib/mock/types";

const SUBJECT = { lat: 33.5, lon: -112.05 };

/** A comp in the shape the vendor actually sends one. */
function rawComp(i: number, over: Record<string, unknown> = {}) {
  const hotTub = i % 3 === 0;
  return {
    listing_info: {
      listing_id: `12345678901234567${String(i).padStart(2, "0")}`,
      listing_name: `Place ${i}`,
      room_type: "Entire home/apt",
    },
    property_details: {
      bedrooms: 2,
      baths: 1,
      beds: 2,
      guests: 4,
      amenities: hotTub
        ? ["Wifi", "Hot tub", "Free parking", "Kitchen"]
        : ["Wifi", "Free parking", "Kitchen"],
    },
    location_info: {
      latitude: SUBJECT.lat + i * 0.001,
      longitude: SUBJECT.lon,
      exact_location: false,
    },
    performance_metrics: {
      // Hot tubs earn more here, which is the association the panel
      // should surface — and it must survive the whole chain to do it.
      ttm_avg_rate: hotTub ? 320 : 230,
      ttm_occupancy: 0.6,
      ttm_total_days: 365,
      l90d_total_days: 90,
      l90d_days_reserved: 40,
      l90d_available_days: 50,
    },
    ratings: { num_reviews: 40 + i, rating_overall: 4.8 },
    host_info: {
      host_id: 900 + i,
      host_name: "Host",
      superhost: i % 4 === 0,
      professional_management: i % 5 !== 0,
    },
    ...over,
  };
}

/** The whole chain, exactly as the product runs it. */
function pipeline(rows: Record<string, unknown>[]): {
  comps: StrComp[];
  pool: PoolComp[];
} {
  const comps = rows
    .map((r, i) => mapComp(r, i))
    .filter((c): c is StrComp => c !== null);
  // Into the pool, out through the store, back past the guard.
  const written = toPoolComps(comps, SUBJECT);
  const roundTripped = JSON.parse(JSON.stringify({ comps: written })) as {
    comps: unknown[];
  };
  return { comps, pool: roundTripped.comps.filter(isPoolComp) };
}

describe("a real comp payload reaches every panel", () => {
  const rows = Array.from({ length: 20 }, (_, i) => rawComp(i));

  it("maps every comp, keeping the four fields the panels need", () => {
    const { comps } = pipeline(rows);
    expect(comps).toHaveLength(20);
    for (const c of comps) {
      expect(c.amenities).toContain("wifi");
      expect(typeof c.reviews).toBe("number");
      expect(typeof c.superhost).toBe("boolean");
      expect(typeof c.professionallyManaged).toBe("boolean");
    }
  });

  it("carries them through the store round trip and past the guard", () => {
    const { pool } = pipeline(rows);
    expect(pool).toHaveLength(20);
    // Nothing lost to serialisation or dropped by isPoolComp.
    expect(pool.every((c) => Array.isArray(c.am) && c.am.length > 0)).toBe(true);
    expect(pool.every((c) => typeof c.rv === "number")).toBe(true);
    expect(pool.every((c) => typeof c.sh === "boolean")).toBe(true);
    expect(pool.every((c) => typeof c.pm === "boolean")).toBe(true);
  });

  it("fills the amenity panel, with the association intact", () => {
    const reading = readAmenities(pipeline(rows).pool)!;
    expect(reading).not.toBeNull();
    expect(reading.bedrooms).toBe(2);
    const hot = reading.rows.find((r) => r.amenity === "hot tub");
    expect(hot).toBeDefined();
    expect(hot!.lift).toBeGreaterThan(0.3);
    // Wifi is on every listing, so it is not a decision and not a row.
    expect(reading.rows.map((r) => r.amenity)).not.toContain("wifi");
  });

  it("fills the competition panel and reads the field", () => {
    const reading = readCompetition(pipeline(rows).pool)!;
    expect(reading).not.toBeNull();
    expect(reading.managedOf).toBe(20);
    expect(reading.managed).toBeGreaterThan(0.5);
    expect(reading.badgedOf).toBe(20);
    expect(fieldOf(reading)).toBe("professional");
  });

  it("lets the review counts lift the confidence score", () => {
    const { comps } = pipeline(rows);
    expect(compSetStrength(comps).label).toBe("High");
    // The same listings with nobody ever having stayed rate lower.
    const unreviewed = pipeline(
      rows.map((r) => ({ ...r, ratings: { num_reviews: 0 } }))
    ).comps;
    expect(compSetStrength(unreviewed).score).toBeLessThan(
      compSetStrength(comps).score
    );
  });

  it("says nothing at all when the feed sends none of it", () => {
    // The payload as it was before any of these fields were read: the
    // panels must be absent, not empty or wrong.
    const bare = rows.map((r) => {
      const { ratings, host_info, ...rest } = r as Record<string, unknown>;
      void ratings;
      void host_info;
      const pd = { ...(rest.property_details as Record<string, unknown>) };
      delete pd.amenities;
      return { ...rest, property_details: pd };
    });
    const { comps, pool } = pipeline(bare);
    expect(pool).toHaveLength(20);
    expect(readAmenities(pool)).toBeNull();
    expect(readCompetition(pool)).toBeNull();

    /**
     * SILENCE IS NOT A ZERO, and this is the assertion that says so.
     *
     * A set carrying no review counts — which is every comp pulled
     * before today — is judged on count and agreement alone, exactly as
     * it was. The same set where guests demonstrably never stayed
     * scores LOWER, and the same set they demonstrably did scores
     * higher. Three different answers, which is the whole point.
     */
    const silent = compSetStrength(comps).score;
    const zeroed = pipeline(
      rows.map((r) => ({ ...r, ratings: { num_reviews: 0 } }))
    ).comps;
    const reviewed = pipeline(rows).comps;
    expect(compSetStrength(zeroed).score).toBeLessThan(silent);
    expect(compSetStrength(reviewed).score).toBeGreaterThan(silent);
  });
});
