/**
 * One Redfin listing's full gallery:
 *   /api/redfin/listing?url=https%3A%2F%2Fwww.redfin.com%2FFL%2F…
 *   …&shape=1  → the vendor's field names, and which endpoint answered
 *
 * Called only when a student opens a listing. A page of twenty-four
 * cards must never become twenty-four billed requests, so nothing here
 * runs while browsing a list.
 *
 * And once bought, a detail is kept. At ten credits it is the most
 * expensive call in the system — ten times a whole page of search
 * results — and until now the only thing holding it was the framework's
 * own cache, which is bound to a deployment. Every push discarded the
 * lot, so the next student to open a listing paid for it again. The
 * store outlives deploys, so the second purchase never happens.
 *
 * The url parameter arrives from the browser and is checked against
 * redfin.com before anything is fetched — an unchecked fetcher would
 * happily proxy whatever it was handed.
 */

import { NextResponse } from "next/server";
import {
  fetchRedfinListing,
  LISTING_REVALIDATE_SECONDS,
  RedfinError,
} from "@/lib/live/redfin";
import {
  isFresh,
  readListingDetail,
  writeListingDetail,
} from "@/lib/db/market-store";
import { arrayPaths, describeFields, statusStrings } from "@/lib/live/shape";

/** A listing's photos and amenities don't change once it's posted;
 *  only its availability does, and that comes from the feed. Matches
 *  the framework cache window this replaces. */
const DETAIL_TTL_MS = LISTING_REVALIDATE_SECONDS * 1000;

/** A parsed listing page is slower than a plain fetch. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const shape = searchParams.get("shape");

  if (!url) {
    return NextResponse.json(
      { ok: false, reason: "missing-url" },
      { status: 400 }
    );
  }

  // The shape probe needs the vendor's raw payload, which is
  // deliberately not stored, so it always goes live.
  if (!shape) {
    const stored = await readListingDetail(url);
    if (stored && isFresh(stored.at, DETAIL_TTL_MS)) {
      return NextResponse.json({
        ok: true,
        ...stored.detail,
        credits: 0,
        cached: true,
      });
    }
  }

  try {
    const { photos, amenities, features, depositMin, depositMax, credits, body } =
      await fetchRedfinListing(url);
    if (shape) {
      return NextResponse.json({
        credits,
        photoCount: photos.length,
        amenities,
        features,
        depositMin,
        depositMax,
        arrays: arrayPaths(body),
        status: statusStrings(body),
        responseShape: describeFields([body], 6),
        samplePhotos: photos.slice(0, 3),
      });
    }
    // Ten credits just left the account; make it the last time.
    // Photos and flags only — the vendor's prose was mined for facts
    // inside the fetch and dropped there, and it stays dropped.
    await writeListingDetail(url, {
      photos,
      amenities,
      features,
      depositMin,
      depositMax,
    });

    return NextResponse.json({
      ok: true,
      photos,
      amenities,
      features,
      depositMin,
      depositMax,
      credits,
      cached: false,
    });
  } catch (error) {
    if (error instanceof RedfinError) {
      return NextResponse.json(
        { ok: false, reason: error.reason, detail: error.detail ?? null },
        { status: error.reason === "no-key" ? 503 : 502 }
      );
    }
    return NextResponse.json(
      { ok: false, reason: "network" },
      { status: 502 }
    );
  }
}
