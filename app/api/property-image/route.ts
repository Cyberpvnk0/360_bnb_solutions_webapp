/**
 * A picture of a property: /api/property-image?lat=30.31&lon=-81.66
 *
 * The server picks the source, not the browser. Which sources exist is
 * a fact about the DEPLOYMENT — whether a Google key works, whether a
 * Mapbox token is set — and only whether imagery covers one coordinate
 * is a fact about the property. Splitting it that way means the client
 * asks once per session what is available, then points an <img> here
 * and lets a 404 fall through to the sketch.
 *
 * The chain, best picture first:
 *
 *   1. Street View — a kerb shot of the building. Best, and gone
 *      whenever the Google key is not working.
 *   2. Aerial — the roof and the lot. Weaker, but nationwide with no
 *      coverage gaps, so it is what stands in while Google is down.
 *   3. 404 — the card draws its sketch.
 *
 * With `source=street` or `source=aerial` the route serves THAT source
 * or 404s, never the next one down. The card asks that way, one stage
 * at a time, so the tag under the picture names the picture: written
 * from "does this deployment have a Google key", it said "Street View"
 * over every roof Google had no kerb shot for. Without `source` the
 * route walks the chain itself, for a human with a URL.
 *
 * Never a listing's own photo. No feed welds one onto a row any more —
 * a listing cannot even carry one — so this route is the only picture a
 * card has, and the source page is a link away for the rest.
 *
 * Keys stay server-side, and both upstreams are cached a month, so a
 * page of listings cannot turn into a page of billed requests and the
 * bill tracks distinct addresses rather than pageviews.
 */

import { fetchAerial, aerialKeyNamesSeen, hasAerialKey } from "@/lib/live/aerial";
import {
  fetchStreetView,
  googleKeyNamesSeen,
  hasGoogleKey,
  streetViewProbe,
} from "@/lib/live/street-view";

/** A month, matching both upstreams' own revalidate windows. */
const CACHE = "public, max-age=2592000, immutable";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  /**
   * What this deployment can draw, asked once per session.
   *
   * Without it every photo-less card fires its own request to find out,
   * so a page of twenty-four spends twenty-four round trips learning
   * the same thing. It also drives the LABEL: a card has to say whether
   * it is showing a kerb or a roof, and only this knows which.
   */
  if (searchParams.get("probe")) {
    return Response.json(
      {
        street: hasGoogleKey(),
        aerial: hasAerialKey(),
        namesSeen: [...googleKeyNamesSeen(), ...aerialKeyNamesSeen()],
      },
      { headers: { "cache-control": "public, max-age=3600" } }
    );
  }

  /**
   * End-to-end setup check, free and safe to hammer:
   *   /api/property-image?check=1
   *
   * Asks the unbilled Street View metadata endpoint about a coordinate
   * that certainly has imagery, so anything other than OK is our
   * configuration rather than the address. Exists because the honest
   * failure — a key whose API is not enabled — otherwise renders as a
   * page of aerials and reads as thin coverage.
   */
  if (searchParams.get("check")) {
    // Times Square. If Street View does not cover this, the problem is
    // not the coordinate.
    const probe = await streetViewProbe(40.758896, -73.98513);
    return Response.json({
      street: { configured: hasGoogleKey(), ...probe },
      aerial: { configured: hasAerialKey(), namesSeen: aerialKeyNamesSeen() },
      verdict: probe.ok
        ? "Street View is working — cards will show kerb photos."
        : probe.denied
          ? `Google refused this key: ${probe.detail ?? "no reason given"}. Enable the Street View Static API on the SAME project the key belongs to, link billing, and make sure the key is not restricted to HTTP referrers — these calls come from the server.${
              hasAerialKey() ? " Aerials are covering for it meanwhile." : " And there is no Mapbox token either, so cards are drawing sketches."
            }`
          : `Street View unavailable: status ${probe.status ?? "none"}${probe.detail ? ` (${probe.detail})` : ""}.`,
    });
  }

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return new Response("Bad coordinates", { status: 400 });
  }

  const wanted = searchParams.get("source");
  const only =
    wanted === "street" || wanted === "aerial" ? wanted : null;

  // Street View first, and only when its free probe says imagery is
  // actually there — never pay for a picture that doesn't exist.
  if (only !== "aerial" && hasGoogleKey()) {
    const probe = await streetViewProbe(lat, lon);
    if (probe.ok) {
      const image = await fetchStreetView(lat, lon);
      if (image) {
        return new Response(image, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": CACHE,
            // For a human reading the network tab; the card knows from
            // which stage it asked for.
            "X-Image-Source": "street",
          },
        });
      }
    }
    // A refused key is OUR problem and falls through to the aerial
    // rather than 404ing: the point of the chain is that a card still
    // shows the building when Google is having a bad day.
  }

  // Asked for the kerb specifically and there is none here: say so,
  // so the card can move to the aerial and label it as one.
  if (only === "street") {
    return new Response("No Street View here", { status: 404 });
  }

  const aerial = await fetchAerial(lat, lon);
  if (aerial) {
    return new Response(aerial, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": CACHE,
        "X-Image-Source": "aerial",
      },
    });
  }

  return new Response("No imagery here", { status: 404 });
}
