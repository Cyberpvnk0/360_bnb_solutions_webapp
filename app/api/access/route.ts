/**
 * Sign in with an access code:  POST /api/access  { code }
 *
 * The code opens the dedicated admin account (lib/auth/access-account)
 * and this route redeems a one-time token for it, which sets the same
 * session cookie an ordinary sign-in sets. The reasoning and the
 * controls — the hash, the override, the off switch, the throttle —
 * are in lib/auth/access-code.
 *
 * Reachable signed out (every /api route gates itself), which is the
 * point of it.
 */

import { NextResponse } from "next/server";
import { prepareAccessAccount } from "@/lib/auth/access-account";
import { accessCodeEnabled, allowAttempt, codeMatches } from "@/lib/auth/access-code";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function refuse(status: number, reason: string, message: string) {
  return NextResponse.json({ ok: false, reason, message }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!accessCodeEnabled()) {
    return refuse(403, "disabled", "Code sign-in is turned off for this site.");
  }

  // The platform sets the first forwarded address to the caller's own.
  const caller =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  if (!allowAttempt(caller)) {
    return refuse(429, "too-many", "Too many attempts. Wait ten minutes and try again.");
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!(await codeMatches(code))) {
    return refuse(401, "wrong-code", "That code isn't right. Check it and try again.");
  }

  const prepared = await prepareAccessAccount();
  if (!prepared.ok) {
    return refuse(503, "account", `The code is right, but the account could not be opened: ${prepared.detail}`);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: prepared.tokenHash, type: prepared.type });
  if (error) {
    return refuse(502, "session", `The code is right, but sign-in failed: ${error.message}`);
  }

  return NextResponse.json({ ok: true, next: "/admin" }, { headers: { "cache-control": "no-store" } });
}
