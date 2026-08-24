/**
 * Short-term-rental data for a point:
 *   /api/str?lat=30.33&lon=-81.66&bedrooms=2   → comps + market analytics
 *   /api/str?lat=…&lon=…&shape=comps           → raw payload, keys only
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
  fetchComps,
  fetchMarketAnalytics,
  hasAirRoiKey,
  probeShape,
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

  if (shape) {
    try {
      const path =
        shape === "market" ? "/v1/market/analytics" : "/v1/listings/search";
      const body = await probeShape(path, {
        latitude: String(lat),
        longitude: String(lon),
        limit: "3",
      });
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
