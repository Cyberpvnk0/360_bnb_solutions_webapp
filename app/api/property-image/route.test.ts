import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

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

type Seen = { metadata: number; streetImage: number; aerial: number };

/** Stub the two upstreams by host and count what was asked of them. */
function stubUpstreams(metadataStatus: string) {
  const seen: Seen = { metadata: 0, streetImage: 0, aerial: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("maps.googleapis.com") && url.includes("/metadata?")) {
        seen.metadata++;
        return Response.json({ status: metadataStatus });
      }
      if (url.includes("maps.googleapis.com/maps/api/streetview?")) {
        seen.streetImage++;
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
    expect(seen).toEqual({ metadata: 1, streetImage: 1, aerial: 0 });
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
