/**
 * Does this vendor ship listing photos?
 *
 *   /api/sources/mashvisor?secret=…&path=/rental-rates&state=FL&city=Tampa
 *   /api/sources/mashvisor?secret=…&sweep=1&state=FL&city=Tampa
 *   /api/sources/mashvisor?secret=…&key=1          ← free, spends nothing
 *
 * ONE QUESTION, ASKED OF THE SERVICE RATHER THAN OF MEMORY. Their docs
 * are not reachable from where this was written, so every path here is
 * a hypothesis and the response is the evidence. Three AirROI mappers
 * were written from remembered field names against a payload that did
 * not exist; each cost an afternoon, and this route is the alternative.
 *
 * `path` takes ANY path relative to their client base, so an endpoint
 * read off the docs in a browser can be tested here without a code
 * change. Extra query parameters are forwarded verbatim — everything
 * except the ones this route reserves (secret, path, sweep, key, raw).
 *
 * WHAT IT REPORTS. Status and the vendor's own words when it refuses;
 * where the records are (arrayPaths); the field names and types, never
 * the values (describeFields); and the finding that matters — every
 * field carrying something that looks like an image, with one real URL
 * per field so somebody can open it and check that it actually serves.
 * A feed that lists twelve photos and returns twelve 403s is not a
 * photo source, and only opening one tells you which you have.
 */

import { NextResponse } from "next/server";
import {
  hasMashvisorKey,
  imageFieldsIn,
  mashvisorCall,
  mashvisorKeyMissingMessage,
  mashvisorKeyNamesSeen,
} from "@/lib/live/mashvisor";
import { arrayPaths, describeFields, statusStrings } from "@/lib/live/shape";

export const maxDuration = 120;

/** Reserved by this route; everything else is forwarded to the vendor. */
const OURS = new Set(["secret", "path", "sweep", "key", "raw"]);

/**
 * Paths to try when sweeping. HYPOTHESES, not documentation.
 *
 * Kept short on purpose. A long guess list is a long bill for a lot of
 * 404s, and the useful move is usually to read one path off the docs
 * and pass it in `path=`. The only reason a sweep exists at all is
 * that a wrong path often answers with the right one — their layer,
 * like the last vendor's, tends to explain itself when it refuses.
 */
const CANDIDATES = [
  // The one endpoint search results actually confirm exists, as a
  // control: if this fails too, the answer is the key or the plan, not
  // the path.
  "/rental-rates",
  "/city/investment/{state}/{city}",
  "/city/traditional/listing",
  "/trends/summary/{state}/{city}",
  "/neighborhood/{state}/{city}",
  "/search/marketplace",
  "/property",
];

function fill(path: string, state: string, city: string): string {
  return path
    .replace("{state}", encodeURIComponent(state))
    .replace("{city}", encodeURIComponent(city));
}

/** One call, described. Never the values — except the image URLs,
 *  which ARE the question and are public CDN links either way. */
async function probe(path: string, params: Record<string, string>) {
  const res = await mashvisorCall(path, params);
  const rows = Array.isArray(res.body) ? res.body : [res.body];
  const images = res.body ? imageFieldsIn(res.body) : [];
  return {
    path,
    status: res.status,
    ok: res.ok,
    error: res.error,
    /** Where the records are, without needing to know the schema. */
    arrays: res.body ? arrayPaths(res.body).slice(0, 12) : [],
    /** Field names and types. No values. */
    fields: res.body ? Object.keys(describeFields(rows, 4)).slice(0, 80) : [],
    /** The vendor explaining itself, when it carried no records. */
    says: res.body ? statusStrings(res.body) : {},
    /** THE ANSWER. Empty means this endpoint carries no imagery. */
    images,
    hasImages: images.length > 0,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Free, and first: "is the key even visible to this deployment" is
  // the question behind half of all vendor failures, and answering it
  // should not cost a call or need a secret.
  if (searchParams.get("key")) {
    return NextResponse.json({
      configured: hasMashvisorKey(),
      namesSeen: mashvisorKeyNamesSeen(),
      ...(hasMashvisorKey() ? {} : { detail: mashvisorKeyMissingMessage() }),
    });
  }

  // Everything below spends. Same gate as the backfill: an
  // unauthenticated URL that costs money is not a diagnostic.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "set CRON_SECRET before this endpoint will spend anything" },
      { status: 503 }
    );
  }
  const offered =
    searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (offered !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!hasMashvisorKey()) {
    return NextResponse.json(
      { error: mashvisorKeyMissingMessage() },
      { status: 503 }
    );
  }

  // Whatever else was passed goes straight to the vendor. Their
  // parameters differ per endpoint and this route has no business
  // knowing which — a probe that only forwards the parameters it was
  // taught can only test the endpoints it was taught.
  const forwarded: Record<string, string> = {};
  for (const [k, v] of searchParams) {
    if (!OURS.has(k)) forwarded[k] = v;
  }

  const state = forwarded.state ?? "FL";
  const city = forwarded.city ?? "Tampa";

  if (searchParams.get("sweep")) {
    const results = [];
    // Sequential: a burst of unknown endpoints is how a rate limit gets
    // discovered the expensive way.
    for (const candidate of CANDIDATES) {
      results.push(await probe(fill(candidate, state, city), forwarded));
    }
    const withImages = results.filter((r) => r.hasImages);
    return NextResponse.json({
      swept: results.length,
      note: "Every path here is a GUESS except /rental-rates. A 404 costs a call and usually names the right path in its message — read `error`.",
      verdict: withImages.length
        ? `Imagery found on: ${withImages.map((r) => r.path).join(", ")}. Open a sample URL before believing it.`
        : "No imagery on any candidate path. Either these are the wrong endpoints, or this plan does not include photos.",
      results,
    });
  }

  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({
      error: "pass ?path=/some/endpoint (from their docs), or ?sweep=1 to try candidates",
      candidates: CANDIDATES,
      base: "https://api.mashvisor.com/v1.1/client",
      hint: "Any parameter other than secret/path/sweep/key/raw is forwarded to the vendor verbatim.",
    });
  }

  const result = await probe(fill(path, state, city), forwarded);

  // The raw body, for when the shape report is not enough — off by
  // default because it can be enormous and it prints values.
  if (searchParams.get("raw")) {
    const res = await mashvisorCall(fill(path, state, city), forwarded);
    return NextResponse.json({ ...result, raw: res.body });
  }

  return NextResponse.json({
    ...result,
    verdict: result.hasImages
      ? "This endpoint carries image URLs. Open a sample in a browser: a field that lists photos and serves 403s is not a photo source."
      : result.ok
        ? "Answered, but no image URLs anywhere in the payload. Wrong endpoint, or this plan has no imagery."
        : "Refused. Read `error` — a wrong path usually names the right one.",
  });
}
