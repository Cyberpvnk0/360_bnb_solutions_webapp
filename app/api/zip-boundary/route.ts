/**
 * The outline of one ZIP code, for the Deal Finder map:
 *
 *   /api/zip-boundary?zip=32225
 *
 * Answers { ok: true, boundary } with a GeoJSON polygon and its box, or
 * { ok: false, reason } when the Census Bureau's boundary service has
 * no shape for it or could not be reached. See lib/map/zip-boundary for
 * where the shapes come from.
 *
 * Kept in the shared store once fetched: a ZIP's outline changes with a
 * census, and the same handful of ZIPs get searched by everybody.
 */

import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/auth/gate";
import { readKeyedBlob, writeKeyed } from "@/lib/db/market-store";
import { fetchZipBoundary, isZipBoundary } from "@/lib/map/zip-boundary";

export const maxDuration = 20;

const STORE_PREFIX = "zip-boundary:";

export async function GET(request: Request) {
  const who = await requireSignedIn();
  if (!who.ok) return who.response;

  const zip = (new URL(request.url).searchParams.get("zip") ?? "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ ok: false, reason: "bad-zip" }, { status: 400 });
  }

  const headers = { "Cache-Control": "private, max-age=86400" };

  const stored = await readKeyedBlob(`${STORE_PREFIX}${zip}`).catch(() => null);
  if (stored && isZipBoundary(stored.value)) {
    return NextResponse.json({ ok: true, boundary: stored.value }, { headers });
  }

  const boundary = await fetchZipBoundary(zip);
  if (!boundary) {
    return NextResponse.json({ ok: false, reason: "no-shape" }, { headers });
  }
  // A failed write is a shape fetched again next time, not a missing
  // outline now.
  void writeKeyed(`${STORE_PREFIX}${zip}`, boundary).catch(() => undefined);
  return NextResponse.json({ ok: true, boundary }, { headers });
}
