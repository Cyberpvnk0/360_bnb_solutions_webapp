/**
 * The account's own profile, written by the server:  PATCH /api/profile
 *
 * The browser lost its write on profiles when the tier column was
 * locked (one policy covers the row), so the one field a person may
 * change — the display name — comes through here, with the secret key,
 * for the signed-in account only. Nothing else on the row is writable
 * from a request: the tier is the plan's, the email is the auth
 * server's.
 */

import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/auth/gate";
import { setFullName } from "@/lib/db/usage";

const MAX_NAME = 80;

export async function PATCH(request: Request) {
  const who = await requireSignedIn();
  if (!who.ok) return who.response;

  const body = (await request.json().catch(() => null)) as { fullName?: unknown } | null;
  const raw = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  if (!raw || raw.length > MAX_NAME) {
    return NextResponse.json(
      { ok: false, reason: "bad-request", hint: `fullName: 1–${MAX_NAME} characters` },
      { status: 400 }
    );
  }

  const result = await setFullName(who.user.id, raw);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: "store", detail: result.detail }, { status: 502 });
  }
  return NextResponse.json({ ok: true, fullName: raw });
}
