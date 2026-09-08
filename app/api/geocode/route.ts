/**
 * Address suggestions for every address box:  /api/geocode?q=…
 *
 * Up to five addresses that start like what was typed — street, city,
 * state, ZIP, and where each is — updating on every keystroke that
 * clears the box's debounce. See lib/live/address-suggest for the
 * providers and their order.
 *
 *   /api/geocode?resolve=<address>
 *
 * The point for a suggestion that arrived without one (a text-only
 * provider), asked for once, when it is picked.
 */

import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/auth/gate";
import { geocode } from "@/lib/live/geocode";
import { MIN_QUERY, suggestAddresses } from "@/lib/live/address-suggest";

export const maxDuration = 20;

export async function GET(request: Request) {
  // An account is the price of asking: the billed providers behind this
  // are ours, and an open relay to them is a bill with no name on it.
  const who = await requireSignedIn();
  if (!who.ok) return who.response;

  const params = new URL(request.url).searchParams;

  const resolve = params.get("resolve");
  if (resolve !== null) {
    const result = await geocode(resolve);
    return NextResponse.json({ point: result.point, source: result.source });
  }

  const q = (params.get("q") ?? "").trim();
  if (q.length < MIN_QUERY) return NextResponse.json({ matches: [], searched: q });

  const matches = await suggestAddresses(q);
  return NextResponse.json({
    matches,
    // An empty list is an answer, and the box should say "no match"
    // rather than spin: a typo and an outage look identical otherwise.
    searched: q,
  });
}
