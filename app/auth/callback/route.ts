/**
 * Where a confirmation email lands.
 *
 * Supabase sends the user back with a one-time code; exchanging it for
 * a session is what actually signs them in. Without this route the
 * link appears to work and then drops them at a page that says they
 * are signed out.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // Only follow `next` when it is a path on this site. An open
    // redirect here would let a crafted confirmation link bounce
    // someone to another host with their session freshly minted.
    if (!error) {
      const safe =
        next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
          ? next
          : "/dashboard";
      return NextResponse.redirect(`${origin}${safe}`);
    }
    /**
     * The link was opened in a different browser than the one that
     * registered — the phone, for the email a laptop signed up with —
     * so the code verifier that browser holds is not here. The address
     * IS confirmed by this point (the auth server did that before
     * redirecting); only the sign-in could not complete on this device.
     * Telling this person the link "expired" sends them to re-register
     * and resend into a loop that never mails anything. They need one
     * sentence: you are confirmed, sign in.
     */
    if (error.code === "pkce_code_verifier_not_found") {
      return NextResponse.redirect(`${origin}/login?notice=confirmed`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link-expired`);
}
