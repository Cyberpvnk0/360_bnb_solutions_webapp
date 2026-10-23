import { describe, expect, it } from "vitest";
import { SERVICES, SERVICE_BY_ID, serviceForUrl, supabaseProjectUrl } from "./services";

/**
 * The catalogue is data, but data the health panel and the fetch
 * observer both trust blindly — so its shape is held here.
 */

describe("service catalogue", () => {
  it("has one entry per id", () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(SERVICE_BY_ID[id].id).toBe(id);
  });

  it("gives every host to exactly one service", () => {
    const hosts = SERVICES.flatMap((s) => s.hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const h of hosts) expect(h).toBe(h.toLowerCase());
  });

  it("links only to https dashboards", () => {
    for (const s of SERVICES) {
      for (const d of s.dashboards) expect(d.url).toMatch(/^https:\/\//);
    }
  });

  it("only passive services rely on hosts for their verdict", () => {
    for (const s of SERVICES.filter((x) => x.probe === "passive")) {
      expect(s.hosts.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe("serviceForUrl", () => {
  it("attributes vendor hosts", () => {
    expect(serviceForUrl("https://api.rentcast.io/v1/listings/rental/long-term?city=x")).toBe("rentcast");
    expect(serviceForUrl("https://api.scraperapi.com/?api_key=k&url=u")).toBe("scraperapi");
    expect(serviceForUrl("https://maps.googleapis.com/maps/api/streetview/metadata?key=k")).toBe("google-maps");
    expect(serviceForUrl("https://places.googleapis.com/v1/places:autocomplete")).toBe("google-maps");
    expect(serviceForUrl("https://API.AIRROI.COM/listings/comparables")).toBe("airroi");
  });

  it("ignores our own store, our own routes and anything unknown", () => {
    expect(serviceForUrl("https://abcdefghijklmnopqrst.supabase.co/rest/v1/listing_cache")).toBeNull();
    expect(serviceForUrl("/api/rentals")).toBeNull();
    expect(serviceForUrl("https://example.com/")).toBeNull();
    expect(serviceForUrl("https://evil.example/api.rentcast.io")).toBeNull();
    expect(serviceForUrl("not a url")).toBeNull();
  });
});

describe("supabaseProjectUrl", () => {
  it("builds the project page from the API URL", () => {
    expect(supabaseProjectUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe(
      "https://supabase.com/dashboard/project/abcdefghijklmnopqrst"
    );
  });

  it("does not guess for anything else", () => {
    expect(supabaseProjectUrl(undefined)).toBeNull();
    expect(supabaseProjectUrl("https://db.example.com")).toBeNull();
    expect(supabaseProjectUrl("http://localhost:54321")).toBeNull();
    expect(supabaseProjectUrl("nonsense")).toBeNull();
  });
});
