/**
 * The measured figures the Deal Finder projects its cards from.
 *
 *   GET /api/market-figures?market=<slug>&zips=<z1,z2,…>&points=<z:lat:lon,…>
 *
 * The city's figures, and the figures for each ZIP asked about — from
 * the store when they are there, bought from the feed and stored when
 * they are not. See lib/live/market-figures for what each costs and
 * how long it keeps. A ZIP the feed has nothing for answers null, and
 * the caller falls to the city's figures for it.
 *
 * Only accounts on a plan: live rows are theirs, and so are the
 * figures under them. Twelve ZIPs a call, so a first look at a market
 * answers in seconds and the rest follow a batch at a time.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { marketFigures, zipFigures, type Figures } from "@/lib/live/market-figures";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

export const maxDuration = 30;

const MAX_ZIPS = 12;
const CONCURRENCY = 3;

export async function GET(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  const sp = new URL(request.url).searchParams;
  const market = MARKET_BY_SLUG.get(sp.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ ok: false, reason: "unknown-market" }, { status: 404 });
  }

  const zips = [
    ...new Set(
      (sp.get("zips") ?? "")
        .split(",")
        .map((z) => z.trim())
        .filter((z) => /^\d{5}$/.test(z))
    ),
  ].slice(0, MAX_ZIPS);
  const points = new Map<string, { lat: number; lon: number }>();
  for (const entry of (sp.get("points") ?? "").split(",")) {
    const m = /^(\d{5}):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/.exec(entry.trim());
    if (!m) continue;
    const lat = Number(m[2]);
    const lon = Number(m[3]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) points.set(m[1], { lat, lon });
  }

  const [city, byZip] = await Promise.all([
    marketFigures(market),
    (async () => {
      const out: Record<string, Figures | null> = {};
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, zips.length) }, async () => {
          for (;;) {
            const i = next++;
            if (i >= zips.length) return;
            const zip = zips[i];
            out[zip] = await zipFigures(zip, market, points.get(zip));
          }
        })
      );
      return out;
    })(),
  ]);

  return NextResponse.json(
    { ok: true, market: city, zips: byZip },
    { headers: { "Cache-Control": "private, max-age=600" } }
  );
}
