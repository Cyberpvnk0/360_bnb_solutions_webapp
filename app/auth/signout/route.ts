/**
 * Sign out. POST only — a GET would let any image tag or prefetch on
 * the page log somebody out.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    // 303 so the browser follows with GET rather than re-POSTing.
    status: 303,
  });
}
