/**
 * Does this vendor ship listing photos?
 *
 *   /api/sources/mashvisor?secret=…&path=/rental-rates&state=FL&city=Tampa
 *   /api/sources/mashvisor?secret=…&sweep=1&state=FL&city=Tampa
 *   /api/sources/mashvisor?secret=…&key=1          ← free, spends nothing
 *
 * ONE QUESTION, ASKED OF THE SERVICE RATHER THAN OF MEMORY. Their docs
 * are not reachable from where this was written, so the response is the
 * evidence. Three AirROI mappers were written from remembered field
 * names against a payload that did not exist; each cost an afternoon,
 * and this route is the alternative.
 *
 * WHAT THE PAPER TRAIL SAYS, AND WHY IT STILL GETS TESTED. Their
 * material says a property profile carries images, and separately that
 * MLS data served through the API is INACTIVE LISTINGS ONLY — a
 * restriction the MLSs impose rather than one they chose. If that
 * holds, the pictures are of properties nobody can lease.
 *
 * Their marketing also named an endpoint, /marketplace-listings-search,
 * that their router does not have: it answered "Cannot GET". Marketing
 * copy is not a route table, which is the second reason nothing here
 * gets written from prose alone.
 *
 * The angle worth measuring: a property profile is keyed by ADDRESS,
 * not by listing. If it carries images, a rental row from the other
 * feed could borrow a picture of the same building whether or not this
 * vendor lists it for rent — at the cost of the photo being from
 * whenever that building last changed hands.
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
  idFieldsIn,
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
 * Paths to try when sweeping.
 *
 * Every one of these appears in their own examples, their own product
 * material, or working third-party code against this API — an earlier
 * cut of this list was half invented, which is a bill for 404s dressed
 * up as a measurement. Reading one path off the docs and passing it in
 * `path=` is still the better move; the sweep is for when you want the
 * lay of the land in one go.
 */
const CANDIDATES: readonly string[] = [
  // Confirmed by their own examples. The control: if this fails, the
  // answer is the key or the plan, not the path.
  "/rental-rates",
  // Property detail. The likeliest home for imagery, and the one that
  // would let a rental row borrow a picture of the same building by
  // address rather than by listing.
  "/property",
  "/property/nearby",
  "/property/price-estimates",
  // Confirmed live in third-party code against this API.
  "/city/investment/{state}/{city}",
  "/city/neighborhoods/{state}/{city}",
  "/trends/neighborhoods",
  "/airbnb-property/market-summary",
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
    /** True when their ROUTER refused, not their application. Means the
     *  path is wrong and everything else is fine. */
    unknownPath: res.unknownPath,
    /** Where the records are, without needing to know the schema. */
    arrays: res.body ? arrayPaths(res.body).slice(0, 12) : [],
    /** Field names and types. No values. */
    fields: res.body ? Object.keys(describeFields(rows, 4)).slice(0, 80) : [],
    /** The vendor explaining itself, when it carried no records. */
    says: res.body ? statusStrings(res.body) : {},
    /** THE ANSWER. Empty means this endpoint carries no imagery. */
    images,
    hasImages: images.length > 0,
    /** What a follow-up call could be made about. */
    ids: idFieldsIn(res.body),
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

  /**
   * search → property profile, in one request.
   *
   * The endpoint documented to carry images takes a property id, and a
   * property id cannot be known in advance — it has to fall out of a
   * search first. Doing that by hand is two round trips and a
   * copy-paste, and the copy-paste is where a probe stops getting run.
   *
   * Two billed calls. It is the only sequence that answers the actual
   * question: can we get a picture of a specific property.
   */
  if (searchParams.get("chain")) {
    // Configurable, because the first path this was hardcoded to did
    // not exist — their router said so — and a chain welded to a dead
    // route can only ever report the same dead route.
    const asked = searchParams.get("chain") ?? "1";
    const searchPath =
      asked === "1" || asked === "" ? "/city/investment/{state}/{city}" : asked;
    const search = await probe(fill(searchPath, state, city), forwarded);
    const id = search.ids[0]?.sample;
    if (!id) {
      return NextResponse.json({
        step1: search,
        verdict: search.ok
          ? "The search answered but carried no id, so there is nothing to look a property up by. Read `fields` for what it did return."
          : "The search itself was refused — read step1.error. Nothing was looked up.",
      });
    }

    const detail = await probe("/property", { ...forwarded, id });
    return NextResponse.json({
      usedId: id,
      step1: search,
      step2: detail,
      verdict: detail.hasImages
        ? `Images found on the property profile for id ${id}. Open a sample URL — and check whether this listing is ACTIVE, because their MLS terms are said to limit API listings to inactive ones, and a photo of a property nobody can lease is not a photo source.`
        : detail.ok
          ? "The property profile answered with no images. Either this plan excludes them, or they live under a path this probe did not walk — pass &raw=1 on a direct ?path=/get-property&id=… call and look."
          : "The property profile was refused — read step2.error.",
    });
  }

  if (searchParams.get("sweep")) {
    const results: Awaited<ReturnType<typeof probe>>[] = [];
    // Sequential: a burst of unknown endpoints is how a rate limit gets
    // discovered the expensive way.
    for (const candidate of CANDIDATES) {
      results.push(await probe(fill(candidate, state, city), forwarded));
    }
    const withImages = results.filter((r) => r.hasImages);
    return NextResponse.json({
      swept: results.length,
      note: "A 404 costs a call and usually names the right path in its message — read `error`. Use ?chain=1 to follow a search result into the property profile, which is where images are documented to live.",
      verdict: withImages.length
        ? `Imagery found on: ${withImages.map((r) => r.path).join(", ")}. Open a sample URL before believing it.`
        : "No imagery on any candidate path. Either these are the wrong endpoints, or this plan does not include photos.",
      results,
    });
  }

  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({
      error: "pass ?path=/some/endpoint (from their docs), ?sweep=1 to try the known candidates, or ?chain=1 (or ?chain=/some/search/path) to search then open a property profile",
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
