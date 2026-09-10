/**
 * The measured figures the Deal Finder projects its cards from.
 *
 *   POST /api/market-figures  { market, rows: [{ id, zip, lat, lon, bd, ba }] }
 *
 * For each row: what the real listings around it say — those within a
 * mile when there are enough, within two when there are not — from
 * the market's comp pool. For a row with nothing near it, the ZIP
 * gets a seed: one comp set bought at that row's point and size, the
 * analyzer's own purchase under the analyzer's own key, once a month.
 * The city's measured figures ride along, for rows that still have
 * nothing near them. See lib/live/comp-pool and lib/live/market-figures.
 *
 * Only accounts on a plan: live rows are theirs, and so are the
 * figures under them. A page of rows a call, a few seeds a call, so a
 * first look at a market answers in seconds and the rest follow.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { ensureSeed, nearbyFigures, readPool, type NearbyFigures } from "@/lib/live/comp-pool";
import { marketFigures } from "@/lib/live/market-figures";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const MAX_ROWS = 24;
/** Seeds a call: each is a billed purchase and a couple of seconds. */
const MAX_SEEDS = 3;

interface RowIn {
  id: string;
  zip: string | null;
  lat: number;
  lon: number;
  bd: number;
  ba: number;
}

function rowsFrom(value: unknown): RowIn[] {
  if (!Array.isArray(value)) return [];
  const out: RowIn[] = [];
  for (const raw of value.slice(0, MAX_ROWS)) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r.id !== "string" || r.id.length > 200) continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const bd = Number(r.bd);
    const ba = Number(r.ba);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) continue;
    if (!Number.isFinite(bd) || bd < 0 || bd > 20) continue;
    out.push({
      id: r.id,
      zip: typeof r.zip === "string" && /^\d{5}$/.test(r.zip) ? r.zip : null,
      lat,
      lon,
      bd: Math.round(bd),
      ba: Number.isFinite(ba) && ba > 0 && ba <= 20 ? ba : Math.max(1, Math.round(bd) - 1),
    });
  }
  return out;
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

  const [city, pool] = await Promise.all([marketFigures(market), readPool(market.slug)]);

  const answer: Record<string, NearbyFigures | null> = {};
  const unmet = new Map<string, RowIn>();
  for (const row of rows) {
    const near = nearbyFigures(pool, row, row.bd);
    answer[row.id] = near;
    if (!near && row.zip && !unmet.has(row.zip)) unmet.set(row.zip, row);
  }

  // A ZIP with a row nothing stands near gets a seed, a few a call;
  // the rows in it are read again off the pool the seed joined.
  const seeded: string[] = [];
  for (const [zip, row] of [...unmet].slice(0, MAX_SEEDS)) {
    const outcome = await ensureSeed(market, zip, row, { bedrooms: row.bd, bathrooms: row.ba });
    if (outcome === "seeded" || outcome === "kept") seeded.push(zip);
  }
  if (seeded.length > 0) {
    const grown = await readPool(market.slug);
    for (const row of rows) {
      if (answer[row.id] === null) answer[row.id] = nearbyFigures(grown, row, row.bd);
    }
  }

  return NextResponse.json(
    { ok: true, market: city, rows: answer, seeded },
    { headers: { "Cache-Control": "no-store" } }
  );
}
