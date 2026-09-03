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
  geocodingProbe,
  googleKeyNamesSeen,
  hasGoogleKey,
  streetViewProbe,
} from "@/lib/live/street-view";
import { imageryBudget, reserveImage } from "@/lib/live/quota";

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
      // Times Square, and Google's own headquarters. Both certainly
      // exist, so anything other than OK is our configuration.
      const [street, geocoding] = await Promise.all([
        streetViewProbe(40.758896, -73.98513),
        geocodingProbe(),
      ]);

      /**
       * Which fix to make, from the pair rather than from either alone.
       *
       * Both refused means the whole project is refused — its billing
       * link or the key. One refused means billing is fine and that one
       * API is not switched on. They read identically from a single
       * endpoint and need completely different afternoons.
       */
      const verdict = street.ok
        ? "Street View is working — cards will show kerb photos."
        : street.denied && geocoding.denied
          ? `Google refused BOTH APIs on this key: ${street.detail ?? "no reason given"} — so this is the project, not one API. Check that the key belongs to the project you linked billing to (a key in another project is refused exactly like this), and that it carries no HTTP-referrer restriction, since these calls come from the server. A billing link can take a few minutes to reach the APIs.`
          : street.denied
            ? `Geocoding works on this key but Street View does not: ${street.detail ?? "no reason given"}. Billing is fine — the Street View Static API is not enabled on this key's project, or the key's API restrictions leave it out.`
            : street.rejected
              ? `A panorama exists at this spot but was turned down: ${street.rejected}. That is the guard against putting a shopfront or the neighbour's house under somebody's address — cards fall to an aerial instead.`
              : `Street View unavailable: status ${street.status ?? "none"}${street.detail ? ` (${street.detail})` : ""}.`;

      return Response.json(
        {
          street: { configured: hasGoogleKey(), ...street },
          geocoding,
          aerial: {
            configured: hasAerialKey(),
            namesSeen: aerialKeyNamesSeen(),
          },
          /** This app's own ceiling, beside Google's. Counted per
           *  distinct address, so it tracks what bills rather than what
           *  loads. */
          budget: imageryBudget(),
          verdict:
            verdict +
            (street.ok || hasAerialKey()
              ? ""
              : " There is no Mapbox token either, so cards are drawing sketches."),
        },
        // A diagnostic that can be read from cache is not a diagnostic:
        // somebody fixes the thing, re-runs this, and reads back the
        // complaint they already fixed.
        { headers: { "cache-control": "no-store" } }
      );
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

  /**
   * Street View first, and only when three things hold: the day's
   * budget has room, we have a key, and the free probe says imagery is
   * actually there. The budget is claimed BEFORE the probe rather than
   * after, because once it is spent there is nothing to learn — asking
   * anyway would buy a round trip and a metadata call to be told no,
   * on every card, for the rest of the day.
   */
  const budget =
    only === "aerial" ? { allowed: false } : reserveImage(`${lat},${lon}`);

  if (only !== "aerial" && hasGoogleKey() && budget.allowed) {
    const probe = await streetViewProbe(lat, lon);
    if (probe.ok) {
      const image = await fetchStreetView(
        lat,
        lon,
        probe.panoId,
        probe.heading
      );
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

  // Asked for the kerb specifically and there is none to be had —
  // no imagery, no key, or no budget left today. Either way the card
  // moves to the aerial and labels it as one.
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
