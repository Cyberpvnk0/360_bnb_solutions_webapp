import { afterEach, describe, expect, it, vi } from "vitest";
import { basemapStyle } from "@/lib/map/basemap";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/gate", () => ({ requireSignedIn: gate }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("market map style isolation", () => {
  it.each([
    ["", "streets-v2"],
    ["?view=markets", "dataviz-light"],
    ["?view=markets&theme=dark", "dataviz-dark"],
  ])("selects the intended raster map for %s", async (query, map) => {
    vi.stubEnv("MAP_RASTER", "1");
    vi.stubEnv("MAPTILER_KEY", "test-key");
    vi.stubEnv("MAPTILER_MAP", "streets-v2");
    gate.mockResolvedValue({ ok: true });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/map/style" + query));
    expect(response.status).toBe(200);
    const style = await response.json();
    expect(style.sources.basemap.tiles[0]).toContain(`/maps/${map}/`);
    expect(style.sources.basemap.attribution).toContain("OpenStreetMap");
  });

  it("retains the sign-in gate for market styles", async () => {
    gate.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const { GET } = await import("./route");
    expect((await GET(new Request("http://localhost/api/map/style?view=markets"))).status).toBe(401);
  });

  it("leaves property map URLs unchanged and separates market style caches", () => {
    expect(basemapStyle("light")).toBe("/api/map/style");
    expect(basemapStyle("dark")).toBe("/api/map/style?theme=dark");
    expect(basemapStyle("light", "markets")).toBe("/api/map/style?view=markets");
    expect(basemapStyle("dark", "markets")).toBe("/api/map/style?theme=dark&view=markets");
  });
});
