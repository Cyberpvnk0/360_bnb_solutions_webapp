/**
 * Bulk city-id discovery: /api/redfin/cities?batch=0
 *
 * Redfin publishes every city id in its state index pages, so 51 page
 * reads cover all 387 markets — instead of 387 slow, billed lookups
 * against an undocumented endpoint.
 *
 * Run batch 0 upward until `batch + 1 === batches`, and paste each
 * `resolved` block into REDFIN_CITY_ID. The point is to end up with the
 * ids in source, not to keep asking for them at runtime.
 *
 * State indexes list a state's larger cities and skip small resort
 * towns, so `?missing=1&batch=0` finishes the job: it asks for whatever
 * is still unseeded by name, twenty at a time.
 */

import { NextResponse } from "next/server";
import {
  resolveBatch,
  resolveMissingBatch,
  stillMissing,
} from "@/lib/live/redfin-bulk";

/** Ten states at five in flight, each capped — fits the budget. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = Number(searchParams.get("batch"));
  const batch = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;

  // The tail: markets no state index listed, asked for by name.
  if (searchParams.get("missing")) {
    const tail = await resolveMissingBatch(batch);
    const got = Object.keys(tail.resolved).length;
    return NextResponse.json({
      ...tail,
      found: got,
      paste: Object.entries(tail.resolved)
        .map(([slug, id]) => `  "${slug}": ${id},`)
        .join("\n"),
      next:
        batch + 1 < tail.batches
          ? `/api/redfin/cities?missing=1&batch=${batch + 1}`
          : null,
      verdict:
        got === 0
          ? "Nothing resolved in this batch. These may genuinely not exist as Redfin cities — small towns often sit under a county or neighbouring city."
          : `${got} resolved, ${tail.unresolved.length} still unmatched in this batch.`,
    });
  }

  const result = await resolveBatch(batch);
  const found = Object.keys(result.resolved).length;

  return NextResponse.json({
    ...result,
    found,
    marketsStillMissingOverall: stillMissing().length,
    /** Paste this straight into REDFIN_CITY_ID. */
    paste: Object.entries(result.resolved)
      .map(([slug, id]) => `  "${slug}": ${id},`)
      .join("\n"),
    next:
      batch + 1 < result.batches
        ? `/api/redfin/cities?batch=${batch + 1}`
        : null,
    verdict:
      result.failedStates.length > 0
        ? `${found} resolved, but ${result.failedStates.length} state page(s) didn't load — re-run this batch; those states' markets are in "unresolved".`
        : found === 0
          ? "No city links found on any page in this batch. Either the state index URL shape changed, or the pages came back as block screens."
          : `${found} resolved, ${result.unresolved.length} unmatched in these states.`,
  });
}
