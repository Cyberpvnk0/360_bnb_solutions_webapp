/**
 * The measured figures the Deal Finder projects its cards from.
 *
 *   POST /api/market-figures  { market, rows: [{ id, lat, lon, bd, ba }] }
 *
 * For each row, the finest grain there is: the property's own comp set
 * when one is on file (the analyzer's exact figures); else what the
 * real listings around it say — those within a mile when there are
 * enough, within two when there are not — from the market's comp pool;
 * else nothing, and the card falls to the city's measured figures,
 * which ride along. A row nothing stands near gets a seed: one comp
 * set bought at that row's point and size, the analyzer's own purchase
 * under the analyzer's own key, once a month per patch of map. See
 * lib/live/comp-pool and lib/live/market-figures.
 *
 *   GET /api/market-figures?market=<slug>&lat=&lon=&bd=&ba=
 *
 * The same read for one point, spelled out — what is on file, what the
 * pool holds around it, what a seed would do — for the person asking
 * why a card says what it says. Reads only; buys nothing.
 *
 * Only accounts on a plan: live rows are theirs, and so are the
 * figures under them.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { readEstimates } from "@/lib/db/market-store";
import {
  ensureSeed,
  nearbyFigures,
  poolAround,
  readPool,
  seedCell,
} from "@/lib/live/comp-pool";
import { marketFigures } from "@/lib/live/market-figures";
import { propertyEstimateKey, propertyFiguresFrom } from "@/lib/live/property-figures";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 60;

const MAX_ROWS = 24;
/** Seeds a call: each is a billed purchase and a few seconds. */
const MAX_SEEDS = 2;

interface RowIn {
  id: string;
  lat: number;
  lon: number;
  bd: number;
  ba: number;
}

/** What a row stands on, when it stands on listings. */
export interface RowFigures {
  kind: "comps" | "nearby";
  adr: number;
  occupancy: number;
  comps: number;
  radiusMiles: number;
  at: string | null;
}

function rowsFrom(value: unknown): RowIn[] {
  if (!Array.isArray(value)) return [];
  const out: RowIn[] = [];
  for (const raw of value.slice(0, MAX_ROWS)) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r.id !== "string" || r.id.length > 200) continue;
    const row = specFrom(r);
    if (row) out.push({ id: r.id, ...row });
  }
  return out;
}

function specFrom(r: Record<string, unknown>): Omit<RowIn, "id"> | null {
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const bd = Number(r.bd);
  const ba = Number(r.ba);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(bd) || bd < 0 || bd > 20) return null;
  return {
    lat,
    lon,
    bd: Math.round(bd),
    ba: Number.isFinite(ba) && ba > 0 && ba <= 20 ? ba : Math.max(1, Math.round(bd) - 1),
  };
}

function ownFor(
  row: Omit<RowIn, "id">,
  sets: Map<string, Parameters<typeof propertyFiguresFrom>[0]>
): RowFigures | null {
  const own = propertyFiguresFrom(
    sets.get(propertyEstimateKey({ lat: row.lat, lon: row.lon, bedrooms: row.bd, bathrooms: row.ba }))
  );
  return own
    ? { kind: "comps", adr: own.adr, occupancy: own.occupancy, comps: own.comps, radiusMiles: own.radiusMiles, at: own.at }
    : null;
}

export async function POST(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  const body = (await request.json().catch(() => null)) as {
    market?: unknown;
    rows?: unknown;
  } | null;
  const market = MARKET_BY_SLUG.get(typeof body?.market === "string" ? body.market : "");
  if (!market) {
    return NextResponse.json({ ok: false, reason: "unknown-market" }, { status: 404 });
  }
  const rows = rowsFrom(body?.rows);

  try {
    const keys = rows.map((r) => propertyEstimateKey({ lat: r.lat, lon: r.lon, bedrooms: r.bd, bathrooms: r.ba }));
    const [city, pool, sets] = await Promise.all([
      marketFigures(market),
      readPool(market.slug),
      readEstimates(keys),
    ]);

    const answer: Record<string, RowFigures | null> = {};
    const unmet = new Map<string, RowIn>();
    for (const row of rows) {
      const own = ownFor(row, sets);
      if (own) {
        answer[row.id] = own;
        continue;
      }
      const near = nearbyFigures(pool, row, row.bd);
      answer[row.id] = near ? { kind: "nearby", ...near, at: null } : null;
      if (!near) {
        const cell = seedCell(row);
        if (!unmet.has(cell)) unmet.set(cell, row);
      }
    }

    // A patch of map with a row nothing stands near gets a seed — a
    // couple a call, side by side — and every unanswered row is read
    // again off the pool the seeds joined. The seeded row itself now
    // has its own set on file, and stands on exactly that.
    const seeds = [...unmet.values()].slice(0, MAX_SEEDS);
    const outcomes = await Promise.all(
      seeds.map((row) => ensureSeed(market, row, { bedrooms: row.bd, bathrooms: row.ba }))
    );
    const seeded = outcomes.map((o, i) => ({ id: seeds[i].id, ...o }));
    if (outcomes.some((o) => o.outcome === "seeded" || o.outcome === "kept")) {
      const grown = await readPool(market.slug);
      const again = await readEstimates(
        seeds.map((r) => propertyEstimateKey({ lat: r.lat, lon: r.lon, bedrooms: r.bd, bathrooms: r.ba }))
      );
      for (const row of rows) {
        if (answer[row.id] !== null) continue;
        const own = ownFor(row, again);
        if (own) {
          answer[row.id] = own;
          continue;
        }
        const near = nearbyFigures(grown, row, row.bd);
        answer[row.id] = near ? { kind: "nearby", ...near, at: null } : null;
      }
    }

    return NextResponse.json(
      { ok: true, market: city, rows: answer, seeded },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  const sp = new URL(request.url).searchParams;
  const market = MARKET_BY_SLUG.get(sp.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ ok: false, reason: "unknown-market" }, { status: 404 });
  }
  const spec = specFrom({ lat: sp.get("lat"), lon: sp.get("lon"), bd: sp.get("bd"), ba: sp.get("ba") });
  if (!spec) return NextResponse.json({ ok: false, reason: "bad-spec" }, { status: 400 });

  const key = propertyEstimateKey({ lat: spec.lat, lon: spec.lon, bedrooms: spec.bd, bathrooms: spec.ba });
  const [city, pool, sets] = await Promise.all([
    marketFigures(market),
    readPool(market.slug),
    readEstimates([key]),
  ]);
  const stored = sets.get(key) ?? null;
  return NextResponse.json({
    ok: true,
    market: market.slug,
    key,
    own: {
      onFile: stored !== null,
      version: stored?.estimate.v ?? null,
      comps: Array.isArray(stored?.estimate.comps) ? stored.estimate.comps.length : 0,
      at: stored?.at ?? null,
      figures: propertyFiguresFrom(stored),
    },
    pool: poolAround(pool, spec),
    nearby: nearbyFigures(pool, spec, spec.bd),
    cell: seedCell(spec),
    city,
  });
}
