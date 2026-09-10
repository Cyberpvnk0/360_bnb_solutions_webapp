/**
 * The measured figures the Deal Finder projects its cards from.
 *
 *   POST /api/market-figures  { market, rows: [{ id, lat, lon, bd, ba, address, st }] }
 *
 * For each row, the finest grain there is, and never a purchase:
 *
 *   analyzed  the property's own comp set is on file — somebody ran
 *             the analyzer on it, under this point or this address —
 *             and the card stands on the analyzer's exact figures, at
 *             any age, until a newer analysis replaces them.
 *   nearby    the real listings around it, from the market's comp pool:
 *             the set the analyzer would buy for it, mimicked out of
 *             the listings every analysis in the city has brought in.
 *   city      nothing within two miles: the market's rate for the
 *             property's size — measured from the market's own listings
 *             of that size when the pool holds enough, scaled from the
 *             city's measured average otherwise — corrected by what the
 *             city's analyses actually stood on.
 *
 * See lib/live/property-figures, lib/live/comp-pool and
 * lib/live/market-figures. The city's row is the one thing this route
 * ever buys, once a month per market.
 *
 *   GET /api/market-figures?market=<slug>&lat=&lon=&bd=&ba=&address=&st=
 *
 * The same read for one property, spelled out — what is on file, what
 * the pool holds around it, the correction, the city — for the person
 * asking why a card says what it says.
 *
 * Only accounts on a plan: live rows are theirs, and so are the
 * figures under them.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import type { Spread } from "@/lib/calc/deal-read";
import { readEstimates } from "@/lib/db/market-store";
import {
  calibrate,
  cityCalibration,
  nearbyFigures,
  poolAround,
  readPool,
  sizeModel,
  TYPICAL_BEDROOMS,
  type Calibration,
} from "@/lib/live/comp-pool";
import { marketFigures, type Figures } from "@/lib/live/market-figures";
import {
  newestPropertyFigures,
  propertyEstimateKeys,
  type StoredSet,
} from "@/lib/live/property-figures";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const MAX_ROWS = 24;

interface RowIn {
  id: string;
  lat: number;
  lon: number;
  bd: number;
  ba: number;
  address: string | null;
  st: string | null;
}

/** What a row stands on, when it stands on listings. */
export interface RowFigures {
  kind: "comps" | "nearby";
  adr: number;
  occupancy: number;
  comps: number;
  radiusMiles: number;
  at: string | null;
  /** How far an analysis may land from these; absent on the
   *  property's own analysis. */
  spread?: Spread;
}

/** The city's figures as the cards use them: the market's rate for
 *  each bedroom count, with the correction on it, and how far an
 *  analysis has tended to land from them. */
export type CityFigures = Figures & {
  calibration: Calibration | null;
  rates: Record<number, number>;
  spread: Spread;
};

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
  const address = typeof r.address === "string" && r.address.length <= 200 ? r.address : null;
  const st = typeof r.st === "string" && /^[A-Za-z]{2}$/.test(r.st) ? r.st : null;
  return {
    lat,
    lon,
    bd: Math.round(bd),
    ba: Number.isFinite(ba) && ba > 0 && ba <= 20 ? ba : Math.max(1, Math.round(bd) - 1),
    address,
    st,
  };
}

function keysFor(row: Omit<RowIn, "id">): string[] {
  return propertyEstimateKeys({
    lat: row.lat,
    lon: row.lon,
    bedrooms: row.bd,
    bathrooms: row.ba,
    address: row.address,
    stateCode: row.st,
  });
}

function ownFor(row: Omit<RowIn, "id">, sets: Map<string, StoredSet>): RowFigures | null {
  const own = newestPropertyFigures(keysFor(row).map((k) => sets.get(k)));
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
    const [city, pool, sets] = await Promise.all([
      marketFigures(market),
      readPool(market.slug),
      readEstimates(rows.flatMap(keysFor)),
    ]);

    const model = sizeModel(pool.comps, city);
    const answer: Record<string, RowFigures | null> = {};
    for (const row of rows) {
      const own = ownFor(row, sets);
      if (own) {
        answer[row.id] = own;
        continue;
      }
      const near = nearbyFigures(pool.comps, row, row.bd, model);
      answer[row.id] = near
        ? {
            kind: "nearby",
            adr: near.adr,
            occupancy: near.occupancy,
            comps: near.comps,
            radiusMiles: near.radiusMiles,
            at: null,
            spread: near.spread,
          }
        : null;
    }

    const corrected: CityFigures | null = city
      ? calibrate(city, cityCalibration(pool.anchors, city, model), model)
      : null;
    return NextResponse.json(
      { ok: true, market: corrected, rows: answer },
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
  const spec = specFrom({
    lat: sp.get("lat"),
    lon: sp.get("lon"),
    bd: sp.get("bd"),
    ba: sp.get("ba"),
    address: sp.get("address") ?? undefined,
    st: sp.get("st") ?? undefined,
  });
  if (!spec) return NextResponse.json({ ok: false, reason: "bad-spec" }, { status: 400 });

  const keys = keysFor(spec);
  const [city, pool, sets] = await Promise.all([
    marketFigures(market),
    readPool(market.slug),
    readEstimates(keys),
  ]);
  const model = sizeModel(pool.comps, city);
  const calibration = cityCalibration(pool.anchors, city, model);
  return NextResponse.json({
    ok: true,
    market: market.slug,
    keys,
    own: keys.map((key) => {
      const stored = sets.get(key) ?? null;
      return {
        key,
        onFile: stored !== null,
        version: stored?.estimate.v ?? null,
        comps: Array.isArray(stored?.estimate.comps) ? stored.estimate.comps.length : 0,
        at: stored?.at ?? null,
      };
    }),
    figures: ownFor(spec, sets),
    pool: poolAround(pool.comps, spec),
    nearby: nearbyFigures(pool.comps, spec, spec.bd, model),
    sizes: { typical: TYPICAL_BEDROOMS, level: model.level, measured: model.measured },
    anchors: pool.anchors.length,
    calibration,
    city,
    cityAsUsed: city ? calibrate(city, calibration, model) : null,
  });
}
