/**
 * A property's own figures, when an analysis has been run on it.
 *
 *   GET /api/property-figures?lat=&lon=&bd=&ba=
 *
 * Reads the comp set the analyzer keeps for this property at this
 * size, and answers the figures the analyzer projects from — or null
 * when nobody has analyzed it. A read of the store, never a purchase.
 * See lib/live/property-figures.
 */

import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/auth/gate";
import { propertyFigures } from "@/lib/live/property-figures";

export const maxDuration = 15;

export async function GET(request: Request) {
  const who = await requireSignedIn();
  if (!who.ok) return who.response;

  const sp = new URL(request.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const bedrooms = Number(sp.get("bd"));
  const bathrooms = Number(sp.get("ba"));
  if (
    !Number.isFinite(lat) || Math.abs(lat) > 90 ||
    !Number.isFinite(lon) || Math.abs(lon) > 180 ||
    !Number.isFinite(bedrooms) || bedrooms < 0 || bedrooms > 20 ||
    !Number.isFinite(bathrooms) || bathrooms <= 0 || bathrooms > 20
  ) {
    return NextResponse.json({ ok: false, reason: "bad-spec" }, { status: 400 });
  }

  const figures = await propertyFigures({ lat, lon, bedrooms, bathrooms });
  return NextResponse.json(
    { ok: true, figures },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
