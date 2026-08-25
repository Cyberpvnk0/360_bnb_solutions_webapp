/**
 * One Redfin listing's full gallery:
 *   /api/redfin/listing?url=https%3A%2F%2Fwww.redfin.com%2FFL%2F…
 *   …&shape=1  → the vendor's field names, and which endpoint answered
 *
 * Called only when a student opens a listing. A page of twenty-four
 * cards must never become twenty-four billed requests, so nothing here
 * runs while browsing a list.
 *
 * The url parameter arrives from the browser and is checked against
 * redfin.com before anything is fetched — an unchecked fetcher would
 * happily proxy whatever it was handed.
 */

import { NextResponse } from "next/server";
import { fetchRedfinListing, RedfinError } from "@/lib/live/redfin";
import { arrayPaths, describeFields, statusStrings } from "@/lib/live/shape";

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
    return NextResponse.json({
      ok: true,
      photos,
      amenities,
      features,
      depositMin,
      depositMax,
      credits,
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
