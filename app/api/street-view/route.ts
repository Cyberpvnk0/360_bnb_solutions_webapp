/**
 * Curb-view photo for a coordinate: /api/street-view?lat=30.31&lon=-81.66
 *
 * The Google key never reaches the browser, and every address is fetched
 * at most once a month (upstream revalidate + a long client cache), so a
 * page full of listings can't turn into a page full of billed requests.
 * No imagery for a spot → 404, and the card falls back to its sketch.
 */

import { fetchStreetView, streetViewExists, hasGoogleKey } from "@/lib/live/photos";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  // Asked once per session before any card tries: without this the
  // answer costs one request per photo-less listing, and a page of
  // twenty-four learns the same thing twenty-four times.
  if (searchParams.get("probe")) {
    return Response.json(
      { configured: hasGoogleKey() },
      { headers: { "cache-control": "public, max-age=3600" } }
    );
  }

  if (!hasGoogleKey()) {
    return new Response("Street View not configured", { status: 503 });
  }
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return new Response("Bad coordinates", { status: 400 });
  }

  // Free probe first — never pay for an image that doesn't exist.
  if (!(await streetViewExists(lat, lon))) {
    return new Response("No imagery here", { status: 404 });
  }

  const image = await fetchStreetView(lat, lon);
  if (!image) return new Response("Upstream error", { status: 502 });

  return new Response(image, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=2592000, immutable",
    },
  });
}
