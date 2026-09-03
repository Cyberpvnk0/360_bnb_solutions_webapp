import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { resetStreetViewProbeMemo } from "@/lib/live/street-view";
import { resetImageryLedger } from "@/lib/live/quota";

/**
 * The card labels its picture from the stage it asked for, which is
 * only honest if this route never quietly serves the next source down
 * when a specific one is requested. These pin that contract, and the
 * money rule underneath it: the billed Street View image is fetched
 * only after the free metadata probe says OK.
 */

const LAT = 30.3322;
const LON = -81.6557;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;

type Seen = {
  metadata: number;
  streetImage: number;
  aerial: number;
  imageUrl?: string;
};

/** Stub the two upstreams by host and count what was asked of them. */
function stubUpstreams(metadata: string | Record<string, unknown>) {
  // A bare status means the ordinary case: Google's own car, parked at
  // the address. Pass an object to describe a panorama that is not.
  const body =
    typeof metadata === "string"
      ? {
          status: metadata,
          copyright: "© 2023 Google",
          pano_id: "PANO-GOOGLE",
          location: { lat: LAT, lng: LON },
        }
      : metadata;
  const seen: Seen = { metadata: 0, streetImage: 0, aerial: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("maps.googleapis.com") && url.includes("/metadata?")) {
        seen.metadata++;
        return Response.json(body);
      }
      if (url.includes("maps.googleapis.com/maps/api/streetview?")) {
        seen.streetImage++;
        seen.imageUrl = url;
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      }
      if (url.includes("api.mapbox.com")) {
        seen.aerial++;
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return seen;
}

const ask = (query: string) =>
  GET(new Request(`http://app.test/api/property-image?${query}`));

beforeEach(() => {
  // Coverage answers are memoised for six hours in module memory, and
  // every case here probes the same coordinate.
  resetStreetViewProbeMemo();
  // Billed addresses are counted per day in module memory too.
  resetImageryLedger();
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-google");
  vi.stubEnv("MAPBOX_TOKEN", "test-mapbox");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("source=street serves the kerb or nothing", () => {
  it("serves Street View when the free probe says there is one", async () => {
    const seen = stubUpstreams("OK");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Image-Source")).toBe("street");
    expect(seen.metadata).toBe(1);
    expect(seen.streetImage).toBe(1);
    expect(seen.aerial).toBe(0);
  });

  it("404s — never an aerial in disguise — when Google has no kerb shot here", async () => {
    // This is the case that put "Street View" under a roof: the card
    // must be told, so it can ask for the aerial and label it as one.
    const seen = stubUpstreams("ZERO_RESULTS");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(res.status).toBe(404);
    expect(seen.aerial).toBe(0);
    // And nothing was bought: the billed image call needs an OK first.
    expect(seen.streetImage).toBe(0);
  });

  it("404s without a Google key rather than substituting", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const seen = stubUpstreams("OK");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(res.status).toBe(404);
    expect(seen).toEqual({ metadata: 0, streetImage: 0, aerial: 0 });
  });
});

describe("source=aerial serves the roof and never asks Google", () => {
  it("skips Street View entirely, even with a working key", async () => {
    const seen = stubUpstreams("OK");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=aerial`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Image-Source")).toBe("aerial");
    expect(seen).toEqual({ metadata: 0, streetImage: 0, aerial: 1 });
  });

  it("404s without a token", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    stubUpstreams("OK");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=aerial`);
    expect(res.status).toBe(404);
  });
});

describe("without a source, the route walks the chain itself", () => {
  it("falls from a missing kerb shot to the aerial", async () => {
    const seen = stubUpstreams("ZERO_RESULTS");
    const res = await ask(`lat=${LAT}&lon=${LON}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Image-Source")).toBe("aerial");
    expect(seen).toEqual({ metadata: 1, streetImage: 0, aerial: 1 });
  });

  it("ignores a source it does not know and walks the chain", async () => {
    const seen = stubUpstreams("OK");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=listing-photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Image-Source")).toBe("street");
    expect(seen.streetImage).toBe(1);
  });
});

describe("only a picture OF this building counts", () => {
  it("turns down a shop's own interior tour", async () => {
    // Two Minneapolis rentals came back showing a deli counter and a
    // clothing rail. Both were real panoramas at the right coordinate,
    // contributed by the businesses — `source=outdoor` is supposed to
    // exclude indoor collections and demonstrably does not catch
    // these. Who held the camera is the check that holds.
    const seen = stubUpstreams({
      status: "OK",
      copyright: "© 2019 Lyndale Vintage",
      pano_id: "PANO-SHOP",
      location: { lat: LAT, lng: LON },
    });
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(404);
    // And nothing was bought to find that out.
    expect(seen.streetImage).toBe(0);
  });

  it("turns down the neighbour's kerb half a block away", async () => {
    const seen = stubUpstreams({
      status: "OK",
      copyright: "© 2023 Google",
      pano_id: "PANO-FAR",
      // A fifth of a degree-thousandth over 200 metres north.
      location: { lat: LAT + 0.002, lng: LON },
    });
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(404);
    expect(seen.streetImage).toBe(0);
  });

  it("looks past a photo sphere to find the car that drove the street", async () => {
    // Google returns the CLOSEST panorama and offers no way to ask for
    // its own. A photo sphere shot on the pavement therefore outranks
    // the car — at Times Square, of all places. Rejecting on that alone
    // would throw away real coverage, so a short hop in each direction
    // goes looking for the road.
    let calls = 0;
    const seen: { imageUrl?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/metadata?")) {
          calls++;
          return Response.json(
            calls === 1
              ? {
                  status: "OK",
                  copyright: "© Charles Li",
                  pano_id: "PANO-SPHERE",
                  location: { lat: LAT, lng: LON },
                }
              : {
                  status: "OK",
                  copyright: "© 2023 Google",
                  pano_id: "PANO-CAR",
                  location: { lat: LAT + 0.0002, lng: LON },
                }
          );
        }
        seen.imageUrl = url;
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      })
    );

    const res = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(res.status).toBe(200);
    expect(seen.imageUrl).toContain("pano=PANO-CAR");
    // The centre, then the ring — all on the free metadata endpoint.
    expect(calls).toBeGreaterThan(1);
  });

  it("aims the camera at the address, not down the street", async () => {
    // Requesting by pano id leaves Google nothing to aim at, so it
    // falls back to the car's direction of travel. The panorama here
    // sits due south of the address, so the camera must look north.
    const seen: { imageUrl?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/metadata?")) {
          return Response.json({
            status: "OK",
            copyright: "© 2023 Google",
            pano_id: "PANO-SOUTH",
            location: { lat: LAT - 0.0002, lng: LON },
          });
        }
        seen.imageUrl = url;
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      })
    );

    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(200);
    const heading = Number(
      new URL(seen.imageUrl!).searchParams.get("heading")
    );
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(1);
  });

  it("leaves the aim to Google when the panorama is on the doorstep", async () => {
    // A bearing between two points a metre apart is noise, not a
    // direction.
    const seen: { imageUrl?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/metadata?")) {
          return Response.json({
            status: "OK",
            copyright: "© 2023 Google",
            pano_id: "PANO-HERE",
            location: { lat: LAT, lng: LON },
          });
        }
        seen.imageUrl = url;
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      })
    );
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(200);
    expect(seen.imageUrl).not.toContain("heading=");
  });

  it("buys the exact panorama it vetted, by id", async () => {
    // Asking again by coordinate is a second search that can land
    // somewhere else — vetting one picture and rendering another.
    const seen = stubUpstreams("OK");
    const res = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(res.status).toBe(200);
    expect(seen.imageUrl).toContain("pano=PANO-GOOGLE");
    expect(seen.imageUrl).not.toContain("location=");
  });
});

describe("a refusal is never remembered", () => {
  it("re-asks after a REQUEST_DENIED, so fixing billing takes effect", async () => {
    // Google answers "you must enable billing" as a normal 200, which a
    // plain revalidate cache stores happily: you link billing, re-run
    // the check, and read back the refusal from days ago with no way to
    // tell it from a live one. The memo holds facts about a coordinate
    // and never a complaint about our own configuration.
    let metadataCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/metadata?")) {
          metadataCalls++;
          return Response.json(
            metadataCalls === 1
              ? {
                  status: "REQUEST_DENIED",
                  error_message: "You must enable Billing on the Google Cloud Project",
                }
              : {
                  status: "OK",
                  copyright: "© 2023 Google",
                  pano_id: "PANO-GOOGLE",
                  location: { lat: LAT, lng: LON },
                }
          );
        }
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      })
    );

    // Billing is off: no kerb shot, and nothing bought.
    const denied = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(denied.status).toBe(404);

    // Billing gets linked. The very next request must see it.
    const fixed = await ask(`lat=${LAT}&lon=${LON}&source=street`);
    expect(fixed.status).toBe(200);
    expect(fixed.headers.get("X-Image-Source")).toBe("street");
    expect(metadataCalls).toBe(2);
  });

  it("does remember that a coordinate has no imagery", async () => {
    // The other half of the rule: a real answer about a place is worth
    // keeping, so a second look costs no round trip.
    let metadataCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("/metadata?")) {
          metadataCalls++;
          return Response.json({ status: "ZERO_RESULTS" });
        }
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      })
    );
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(404);
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(404);
    expect(metadataCalls).toBe(1);
  });
});

describe("the day's own ceiling", () => {
  it("stops asking once the budget is spent, without a round trip", async () => {
    // Google's quota refuses the request; ours declines to make it. By
    // the time the budget is gone there is nothing left to learn, and
    // asking anyway buys a metadata call per card for the rest of the
    // day to be told no.
    vi.stubEnv("IMAGERY_DAILY_CAP", "1");
    const seen = stubUpstreams("OK");

    // First address spends the day's only slot.
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(200);

    // A different address — close enough that only the budget can
    // refuse it — gets the aerial instead, and Google is not troubled
    // about it.
    const before = seen.metadata;
    const next = await ask(`lat=${LAT + 0.0002}&lon=${LON}&source=street`);
    expect(next.status).toBe(404);
    expect(seen.metadata).toBe(before);
  });

  it("charges an address once a day, however often it is viewed", async () => {
    vi.stubEnv("IMAGERY_DAILY_CAP", "1");
    const seen = stubUpstreams("OK");
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(200);
    // The same coordinate again: already paid for, so it must not eat
    // a second slot or be refused.
    expect((await ask(`lat=${LAT}&lon=${LON}&source=street`)).status).toBe(200);
    expect(seen.streetImage).toBe(2);
  });

  it("never spends a slot on the aerial, which is not Google's", async () => {
    vi.stubEnv("IMAGERY_DAILY_CAP", "1");
    stubUpstreams("OK");
    expect((await ask(`lat=${LAT}&lon=${LON}&source=aerial`)).status).toBe(200);
    // The kerb shot for a different address is still affordable.
    expect((await ask(`lat=${LAT + 0.0002}&lon=${LON}&source=street`)).status).toBe(
      200
    );
  });
});

describe("the deployment probe", () => {
  it("reports which sources are configured, and nothing about any address", async () => {
    stubUpstreams("OK");
    const res = await ask("probe=1");
    const body = await res.json();
    expect(body.street).toBe(true);
    expect(body.aerial).toBe(true);
  });

  it("rejects coordinates off the planet", async () => {
    stubUpstreams("OK");
    expect((await ask("lat=91&lon=0")).status).toBe(400);
    expect((await ask("lat=abc&lon=0")).status).toBe(400);
  });
});
