/**
 * A listing's own page on the source site, found from its address.
 *
 *   GET /api/listing-page?address=<street>&city=<town>&state=<ST>[&zip=]
 *
 * For a surface that shows ONE property and holds no page for it — the
 * analyzer for a typed address, most of all. "View photos" there could
 * only search for the address, and a search finds a listing rather
 * than opening it. This asks the portal's own lookup for the page
 * (lib/live/redfin-page: strict on street, unit, town and state, so a
 * wrong page is never handed back) and the link becomes the listing.
 *
 * One vendor request per address, ever: hits are kept a month and
 * misses a week in the shared store, so the second person to open an
 * address pays nothing and waits for nothing. Only a plan that buys
 * anything may spend the first one.
 *
 * Answers say whether the portal ANSWERED. "No such page" and "never
 * got through" are different facts, and the panel treats the second as
 * something to try again rather than something that is not there.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { resolveListingPage } from "@/lib/live/redfin-page";

/** The lookup's own budget (lib/live/redfin-page) plus room to answer. */
export const maxDuration = 90;

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
    return NextResponse.json(
      { ok: false, reason: "bad-address" },
      { status: 400 }
    );
  }

  const found = await resolveListingPage({ address, city, stateCode: state, zip, point });
  return NextResponse.json({
    ok: true,
    page: found.url,
    answered: found.answered,
    detail: found.detail,
  });
}
