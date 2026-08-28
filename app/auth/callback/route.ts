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
      const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${safe}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link-expired`);
}
