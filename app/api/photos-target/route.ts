/**
 * Where a "View photos" click should land, in one quick answer.
 *
 *   GET /api/photos-target?address=<street>&city=<town>&state=<ST>[&zip=&lat=&lon=]
 *
 * The finder page (/go/listing) asks this and goes where it says:
 * the listing's own page when the fast places have it, Zillow's page
 * for the home when Zillow says it has one, its address page when
 * Zillow could not be asked, pictures of the address on Google when
 * Zillow said no.
 * See lib/live/photos-target. Bounded to a few seconds, and never a
 * billed lookup beyond the ZIP's rentals the contact path reads too.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { photosTarget } from "@/lib/live/photos-target";

export const maxDuration = 20;

export async function GET(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  const { searchParams } = new URL(request.url);
  const address = (searchParams.get("address") ?? "").trim();
  const city = (searchParams.get("city") ?? "").trim();
  const state = (searchParams.get("state") ?? "").trim().toUpperCase();
  const zip = (searchParams.get("zip") ?? "").trim() || undefined;
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const point =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat, lon }
      : undefined;
  if (address.length < 4 || city.length < 2 || !/^[A-Z]{2}$/.test(state)) {
    return NextResponse.json({ ok: false, reason: "bad-address" }, { status: 400 });
  }

  const target = await photosTarget({ address, city, stateCode: state, zip, point });
  if (!target) return NextResponse.json({ ok: false, reason: "bad-address" }, { status: 400 });
  return NextResponse.json({ ok: true, ...target }, { headers: { "Cache-Control": "no-store" } });
}
