/**
 * Curb-view photo for a coordinate: /api/street-view?lat=30.31&lon=-81.66
 *
 * The Google key never reaches the browser, and every address is fetched
 * at most once a month (upstream revalidate + a long client cache), so a
 * page full of listings can't turn into a page full of billed requests.
 * No imagery for a spot → 404, and the card falls back to its sketch.
 */

import {
  fetchStreetView,
  googleKeyNamesSeen,
  hasGoogleKey,
  streetViewProbe,
} from "@/lib/live/photos";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  // Asked once per session before any card tries: without this the
  // answer costs one request per photo-less listing, and a page of
  // twenty-four learns the same thing twenty-four times.
  if (searchParams.get("probe")) {
    return Response.json(
      {
        configured: hasGoogleKey(),
        // Names only, never values. "Is the key even visible to this
        // deployment" is the question behind half of all vendor
        // failures, and it should be answerable without a redeploy.
        namesSeen: googleKeyNamesSeen(),
      },
      { headers: { "cache-control": "public, max-age=3600" } }
    );
  }

  /**
   * End-to-end setup check, free and safe to hammer:
   *   /api/street-view?check=1
   *
   * Asks the unbilled metadata endpoint about a coordinate that
   * certainly has imagery, so anything other than OK is our
   * configuration rather than the address. Exists because the honest
   * failure — a key whose API is not enabled — otherwise renders as a
   * page of sketches and reads as thin coverage.
   */
  if (searchParams.get("check")) {
    // Times Square. If Street View does not cover this, the problem is
    // not the coordinate.
    const probe = await streetViewProbe(40.758896, -73.98513);
    return Response.json({
      configured: hasGoogleKey(),
      namesSeen: googleKeyNamesSeen(),
      ...probe,
      verdict: probe.ok
        ? "Working. Cards will show real curb photos."
        : probe.denied
          ? `Google refused this key: ${probe.detail ?? "no reason given"}. Enable the Street View Static API on the SAME project the key belongs to, link billing, and make sure the key is not restricted to HTTP referrers — these calls come from the server.`
          : `Unexpected: status ${probe.status ?? "none"}${probe.detail ? ` (${probe.detail})` : ""}.`,
    });
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
  const probe = await streetViewProbe(lat, lon);
  if (!probe.ok) {
    // A refused key is OUR problem and must not masquerade as an
    // address with no coverage: 404 tells the card to draw a sketch and
    // tells whoever is debugging that rural Florida is thin, which is
    // how a switched-off API hides for a week.
    if (probe.denied) {
      return new Response(
        `Street View refused: ${probe.detail ?? probe.status ?? "unknown"}`,
        { status: 502 }
      );
    }
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
