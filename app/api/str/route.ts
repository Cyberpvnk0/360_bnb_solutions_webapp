/**
 * Short-term-rental data for a point:
 *   /api/str?lat=30.33&lon=-81.66&bedrooms=2   → comps + market analytics
 *   /api/str?lat=…&lon=…&shape=comps           → raw payload, keys only
 *   /api/str?lat=…&lon=…&shape=all             → sweep every candidate path
 *
 * The AirROI key stays server-side. Calls are billed per request, so
 * each point spends at most one slot of the same daily cap that guards
 * the rental feed, and a failure spends nothing.
 *
 * `shape` is the setup diagnostic: it returns the vendor's own field
 * names (never the values) so the mapper can be pinned to the real
 * payload on the first request made with a live key.
 */

import { NextResponse } from "next/server";
import {
  AirRoiError,
  COMPS_PATH,
  fetchComps,
  fetchMarketAnalytics,
  hasAirRoiKey,
  MARKET_PATH,
  probeEndpoint,
  probeShape,
  PROBE_TARGETS,
} from "@/lib/live/airroi";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";

function failure(error: unknown) {
  if (error instanceof AirRoiError) {
    return NextResponse.json(
      { live: false, reason: error.reason, status: error.status ?? null },
      { status: error.reason === "no-key" ? 503 : 502 }
    );
  }
  return NextResponse.json(
    { live: false, reason: "network", status: null },
    { status: 502 }
  );
}

/** Key names and value types only — no listing data leaves this route. */
function describe(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 2
      ? `array(${value.length})`
      : { array: value.length, first: describe(value[0], depth + 1) };
  }
  if (value && typeof value === "object") {
    if (depth > 2) return "object";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        describe(v, depth + 1),
      ])
    );
  }
  return typeof value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const bedrooms = Number(searchParams.get("bedrooms")) || undefined;
  const shape = searchParams.get("shape");

  if (!hasAirRoiKey()) {
    return NextResponse.json(
      { live: false, reason: "no-key", status: null },
      { status: 503 }
    );
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { live: false, reason: "bad-point", status: null },
      { status: 400 }
    );
  }

  // shape=all sweeps every candidate endpoint and reports what each one
  // answered. It costs one billed call per row, so it is a deliberate
  // setup step rather than anything a page reaches.
  if (shape === "all") {
    const results = [];
    for (const target of PROBE_TARGETS) {
      const outcome = await probeEndpoint(target.path, target.params(lat, lon));
      results.push({
        path: outcome.path,
        ok: outcome.ok,
        status: outcome.status,
        reason: outcome.reason,
        shape: outcome.ok ? describe(outcome.shape) : null,
      });
    }
    return NextResponse.json({
      swept: results.length,
      results,
      howToRead:
        "Key names and value types only — no listing data leaves this route. " +
        "A 404 means the path is wrong and wants correcting in lib/live/airroi.ts; " +
        "auth means the key is not active yet; quota means it is active but out of credit. " +
        "Whichever paths answer 200, read their key names and pin ADR_KEYS / OCC_KEYS / REV_KEYS to them.",
    });
  }

  if (shape) {
    try {
      const path = shape === "market" ? MARKET_PATH : COMPS_PATH;
      const params: Record<string, string> =
        shape === "market"
          ? { lat: String(lat), lng: String(lon) }
          : { latitude: String(lat), longitude: String(lon), bedrooms: "2", currency: "native" };
      const body = await probeShape(path, params);
      return NextResponse.json({ path, shape: describe(body) });
    } catch (error) {
      return failure(error);
    }
  }

  const key = `str:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const gate = checkLiveSearch(key);
  if (!gate.allowed) {
    return NextResponse.json(
      { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const [comps, market] = await Promise.all([
      fetchComps({ lat, lon, bedrooms }),
      fetchMarketAnalytics({ lat, lon }).catch(() => null),
    ]);
    // Too thin to underwrite on is the same as no answer — the seeded
    // comp set is a better read than three strangers' nightly rates.
    if (comps.length < 4) {
      return NextResponse.json(
        { live: false, reason: "thin-coverage", found: comps.length },
        { status: 200 }
      );
    }
    const spent = commitLiveSearch(key);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      comps,
      market,
      remaining: spent.remaining,
    });
  } catch (error) {
    return failure(error);
  }
}
