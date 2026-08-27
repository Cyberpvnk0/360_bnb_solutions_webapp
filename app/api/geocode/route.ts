/**
 * Address lookup for the analyzer's search box:  /api/geocode?q=…
 *
 * The public federal geocoder — free, keyless, and scoped to exactly
 * the country this product covers. Nothing here is billed, so it can be
 * called on every debounced keystroke without a quota slot.
 *
 * Returns the geocoder's own normalised spelling of each match, which
 * is what the property is actually called rather than what was typed at
 * it, along with a point precise enough to pull comps around.
 */

import { NextResponse } from "next/server";
import { geocodeCandidates } from "@/lib/live/geocode";

export const maxDuration = 20;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().length < 4) return NextResponse.json({ matches: [] });

  const matches = await geocodeCandidates(q).catch(() => []);
  return NextResponse.json({
    matches,
    // An empty list is an answer, and the box should say "no match"
    // rather than spin: a typo and an outage look identical otherwise.
    searched: q.trim(),
  });
}
