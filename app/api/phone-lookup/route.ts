/**
 * A deep phone lookup for one property.
 *
 *   POST /api/phone-lookup  { address, city, state, zip?, lat?, lon? }
 *
 * Public records, asked for the property's owner and their number,
 * for a listing that gave none. A paid feature, priced in credits
 * (config/app PHONE_LOOKUP_CREDITS) and charged when a match comes
 * back — a name, a number, an email, whatever the record holds, which
 * is exactly what the vendor bills us for: the account's room is read
 * before the vendor is asked, and the credits are taken after it
 * answers — once per address per month for the account, so opening
 * the same property again is free. A vendor answer is kept a month for
 * everyone, so the second account to ask pays the plan and not the
 * vendor.
 *
 * Every answer says what happened: a match, no match (nothing
 * charged), no room on the plan (nothing asked), or a vendor that could
 * not be reached (nothing charged). Nothing off the vendor's answer is
 * logged.
 */

import { NextResponse } from "next/server";
import { PHONE_LOOKUP_CREDITS } from "@/config/app";
import { requirePaid } from "@/lib/auth/gate";
import { canCover, spendCredits } from "@/lib/db/usage";
import { addressKey } from "@/lib/live/address";
import { lookupPhone, phoneLookupConfigured } from "@/lib/live/phone-lookup";
import { zipFromAddress } from "@/lib/live/zip";
import { lookupZipAt } from "@/lib/map/zip-boundary";

export const maxDuration = 60;

export async function POST(request: Request) {
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  if (!phoneLookupConfigured()) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    address?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
    lat?: unknown;
    lon?: unknown;
  } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const city = typeof body?.city === "string" ? body.city.trim() : "";
  const state = typeof body?.state === "string" ? body.state.trim().toUpperCase() : "";
  const key = addressKey(address);
  if (address.length < 4 || city.length < 2 || !/^[A-Z]{2}$/.test(state) || !key) {
    return NextResponse.json({ ok: false, reason: "bad-address" }, { status: 400 });
  }

  // The vendor keys a property by its ZIP too. The row's own, the
  // address line's, or the one under the point.
  const own = typeof body?.zip === "string" && /^\d{5}$/.test(body.zip.trim()) ? body.zip.trim() : null;
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  const point =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat, lon }
      : null;
  const zip = own ?? zipFromAddress(address) ?? (point ? await lookupZipAt(point) : null);
  if (!zip) return NextResponse.json({ ok: false, reason: "no-zip" }, { status: 400 });

  // Room first, then the vendor, then the charge — so nothing is taken
  // for a search that finds nothing, and nothing is asked of the vendor
  // for an account that could not pay for an answer.
  const cover = await canCover(paid.user.id, paid.tier, PHONE_LOOKUP_CREDITS);
  if (!cover.ok) {
    return NextResponse.json(
      { ok: false, reason: "no-credits", remaining: cover.remaining, cost: PHONE_LOOKUP_CREDITS },
      { status: 402 }
    );
  }

  const lookup = await lookupPhone({ address, city, stateCode: state, zip });
  if (!lookup.ok) {
    return NextResponse.json(
      { ok: false, reason: lookup.reason, status: lookup.status ?? null, detail: lookup.detail ?? null },
      { status: lookup.reason === "no-key" ? 503 : 502 }
    );
  }

  if ((lookup.result?.persons.length ?? 0) === 0) {
    // Nobody on record: the vendor bills nothing for a miss, and
    // neither does the plan.
    return NextResponse.json({ ok: true, found: false, result: null, charged: 0 });
  }

  const spend = await spendCredits(
    paid.user.id,
    paid.tier,
    `phone:${state.toLowerCase()}:${key}`,
    PHONE_LOOKUP_CREDITS
  );
  return NextResponse.json({
    ok: true,
    found: true,
    result: lookup.result,
    // A refusal here is a race with a spend that landed in between
    // reading the room and asking the vendor. The vendor has been paid;
    // the answer goes out, unbilled, rather than being thrown away.
    charged: spend.allowed ? spend.charged : 0,
    used: spend.used,
    cap: spend.cap,
    balance: spend.balance ?? null,
    ...(spend.unmetered ? { unmetered: spend.unmetered } : {}),
  });
}
