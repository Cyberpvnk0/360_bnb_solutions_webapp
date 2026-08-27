/**
 * Short-term-rental data for a point:
 *   /api/str?lat=30.33&lon=-81.66&bedrooms=2   → comps for that point
 *     …&baths=2&guests=4                       → optional; defaulted from bedrooms
 *   /api/str?lat=…&lon=…&shape=comps           → raw payload, keys only
 *   /api/str?lat=…&lon=…&estimate=1            → their revenue model beside ours
 *   /api/str?lat=…&lon=…&shape=all             → sweep every candidate path
 *   …&depth=5                                  → how far into nested payloads to look
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
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import {
  AirRoiError,
  COMPS_PATH,
  fetchComps,
  fetchEstimate,
  fetchMarketIdentity,
  fetchMarketSummary,
  fullNameOf,
  hasAirRoiKey,
  MARKET_PATH,
  MARKET_PROBE_TARGETS,
  probeEndpoint,
  probeShape,
  PROBE_TARGETS,
} from "@/lib/live/airroi";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";

function failure(error: unknown) {
  if (error instanceof AirRoiError) {
    return NextResponse.json(
      {
        live: false,
        reason: error.reason,
        status: error.status ?? null,
        // The service's own words. Capturing this and then not printing
        // it left a 400 looking like an unexplained refusal.
        detail: error.detail ?? null,
      },
      { status: error.reason === "no-key" ? 503 : 502 }
    );
  }
  return NextResponse.json(
    { live: false, reason: "network", status: null },
    { status: 502 }
  );
}

/**
 * Key names and value types only — no listing data leaves this route.
 *
 * The depth limit is a parameter because the default of two was itself
 * a bug in disguise: a comp arrives as eight nested objects, and at
 * depth two every one of them printed as the word "object". The probe
 * reported success while hiding the only thing it was asked to find.
 */
function describe(value: unknown, depth = 0, max = 2): unknown {
  if (Array.isArray(value)) {
    return depth > max
      ? `array(${value.length})`
      : { array: value.length, first: describe(value[0], depth + 1, max) };
  }
  if (value && typeof value === "object") {
    if (depth > max) return "object";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        describe(v, depth + 1, max),
      ])
    );
  }
  return typeof value;
}

/**
 * Measured annual revenue against the revenue our model would predict
 * for the same listing.
 *
 * The projection computes rate x occupancy x nights. That product is
 * only equal to real revenue when rate and occupancy are uncorrelated,
 * and in a seasonal market they plainly are not — peak weeks carry both
 * a higher rate and a fuller calendar — so the naive product should
 * understate. Should. Whether it actually does here, and by how much,
 * depends on how the vendor defines its average rate: over booked
 * nights, the product is nearly exact by construction; over listed
 * nights, it is not.
 *
 * That is not something to reason out. Every comp carries both figures,
 * so this divides one by the other and reports the answer. A ratio near
 * 1.00 means the model is already right and wants no calibration; a
 * ratio consistently away from 1.00 is a real bias worth correcting,
 * and its size is the correction.
 *
 * Costs nothing — the numbers are already in hand.
 */
function revenueCheck(comps: { adr: number; occupancy: number; annualRevenue?: number }[]) {
  const pairs = comps
    .filter((c) => typeof c.annualRevenue === "number" && c.annualRevenue > 0)
    .map((c) => ({
      measured: c.annualRevenue!,
      modeled: Math.round(c.adr * c.occupancy * 365),
    }))
    .filter((p) => p.modeled > 0);

  if (pairs.length === 0) {
    return { pairs: 0, note: "no comp reported a measured revenue" };
  }
  const ratios = pairs.map((p) => p.measured / p.modeled).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median =
    ratios.length % 2 === 1 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;

  return {
    pairs: pairs.length,
    /** Median, not mean: one comp that relaunched mid-year has a
     *  trailing revenue covering part of a year and a ratio to match,
     *  and it should not drag the answer. */
    medianRatio: Number(median.toFixed(3)),
    range: [Number(ratios[0].toFixed(3)), Number(ratios[ratios.length - 1].toFixed(3))],
    sample: pairs.slice(0, 5),
    howToRead:
      "measured / modeled, where modeled = adr x occupancy x 365. " +
      "Near 1.00 means the projection needs no calibration. " +
      "Consistently above 1.00 means the model understates real revenue by that factor — the covariance of rate and occupancy across a season — and the median is the correction to apply. " +
      "A wide range means the comps disagree and no single factor is honest.",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const bedrooms = Number(searchParams.get("bedrooms")) || undefined;
  const baths = Number(searchParams.get("baths")) || undefined;
  const guests = Number(searchParams.get("guests")) || undefined;
  const shape = searchParams.get("shape");
  // How far into a nested payload to report. Capped: this prints keys,
  // not values, but an unbounded walk of a deep response is still a way
  // to turn a diagnostic into a data dump.
  const depth = Math.min(6, Math.max(2, Number(searchParams.get("depth")) || 2));

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

  // estimate=1 runs their own revenue model for this property and puts
  // it beside ours. Two billed calls: the estimate, and the market
  // summary its lookup unlocks.
  if (searchParams.get("estimate")) {
    try {
      const estimate = await fetchEstimate({ lat, lon, bedrooms, baths, guests });
      const identity = await fetchMarketIdentity({ lat, lon }).catch(() => null);
      const summary = identity?.market
        ? await fetchMarketSummary(identity.market).catch(() => null)
        : null;

      const derived = deriveMarketAssumptions(estimate.comps);
      const modelled =
        derived.adr > 0 ? Math.round(derived.adr * derived.marketOccupancy * 365) : null;

      return NextResponse.json({
        market: identity?.fullName ?? null,
        marketSummary: summary,
        theirs: {
          revenue: estimate.revenue,
          adr: estimate.adr,
          occupancy: estimate.occupancy,
          percentiles: estimate.percentiles,
          monthlyRevenue: estimate.monthlyRevenue,
        },
        ours: {
          adr: derived.adr,
          occupancy: derived.marketOccupancy,
          modelledRevenue: modelled,
          comps: estimate.comps.length,
        },
        /**
         * The whole question, in one number. Our projection multiplies
         * a mean rate by a mean occupancy; theirs is a model with the
         * same comps behind it. A ratio near 1.00 says the two agree
         * and the projection needs nothing.
         */
        agreement:
          modelled && estimate.revenue
            ? Number((estimate.revenue / modelled).toFixed(3))
            : null,
        howToRead:
          "`ours` is what the analyzer shows today: mean comp ADR times mean comp occupancy times 365. " +
          "`theirs` is the vendor's own model over the same comps, with real percentiles. " +
          "agreement = theirs / ours. Near 1.00 means the projection is sound as it stands. " +
          "Away from 1.00 is the calibration, and its direction says which way the simple product errs.",
      });
    } catch (error) {
      return failure(error);
    }
  }

  // shape=all sweeps every candidate endpoint and reports what each one
  // answered. It costs one billed call per row, so it is a deliberate
  // setup step rather than anything a page reaches.
  if (shape === "all") {
    const results = [];
    let fullName: string | null = null;

    for (const target of PROBE_TARGETS) {
      const outcome = await probeEndpoint(target.path, target.params(lat, lon));
      // The market identifier the second stage needs, taken from what
      // the service returned rather than guessed at.
      if (outcome.ok && fullName === null) fullName = fullNameOf(outcome.shape);
      results.push({
        path: outcome.path,
        ok: outcome.ok,
        status: outcome.status,
        reason: outcome.reason,
        detail: outcome.detail,
        shape: outcome.ok ? describe(outcome.shape, 0, depth) : null,
      });
    }

    // Markets resolve to a name and carry no figures of their own, so
    // the metrics live somewhere keyed on that name. Only worth asking
    // once a real name is in hand.
    for (const target of fullName === null ? [] : MARKET_PROBE_TARGETS) {
      const params = target.params(fullName!);
      const outcome = await probeEndpoint(target.path, params);
      results.push({
        path: `${target.path}?${Object.keys(params).join("&")}`,
        ok: outcome.ok,
        status: outcome.status,
        reason: outcome.reason,
        detail: outcome.detail,
        shape: outcome.ok ? describe(outcome.shape, 0, depth) : null,
      });
    }

    return NextResponse.json({
      swept: results.length,
      marketFullName: fullName,
      results,
      howToRead:
        "Key names and value types only — no listing data leaves this route, though `detail` carries the service's own rejection message, which is how a 400 names the parameter it wanted. " +
        "404 means the path is wrong; 400 means the path is right and the parameters are not; auth means the key is not active; quota means active but out of credit. " +
        "Whichever paths answer 200 with ADR and occupancy in them are the ones to pin ADR_KEYS / OCC_KEYS / REV_KEYS against.",
    });
  }

  if (shape) {
    try {
      // The same target the sweep uses, so the two cannot disagree
      // about what a valid request looks like — which they did, and
      // which cost a round trip and a billed call to notice.
      const target =
        PROBE_TARGETS.find((t) =>
          shape === "market" ? t.path === MARKET_PATH : t.path === COMPS_PATH
        ) ?? PROBE_TARGETS[0];
      const body = await probeShape(target.path, target.params(lat, lon));
      const path = target.path;
      return NextResponse.json({ path, depth, shape: describe(body, 0, depth) });
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
    // Comps only. The market endpoints carry no figures — lookup
    // returns a name, the metrics paths 404 — so pairing every analysis
    // with a second billed call bought a null and some latency.
    const comps = await fetchComps({ lat, lon, bedrooms, baths, guests });
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
      revenueCheck: revenueCheck(comps),
      remaining: spent.remaining,
    });
  } catch (error) {
    return failure(error);
  }
}
