"use client";

/**
 * What imagery this deployment can draw, asked once per session.
 *
 * Two facts live at different levels and separating them is the whole
 * design. Whether Street View or aerials are AVAILABLE is a property of
 * the deployment — a key that works, a token that is set — so it is
 * asked once and shared. Whether imagery covers one COORDINATE is a
 * property of the address, and the image route answers that with a 404
 * the card falls through on.
 *
 * Without the shared probe, every photo-less card fires its own request
 * to find out, so a grid of twenty-four spends twenty-four round trips
 * discovering the same thing — and on a deployment with no keys at all,
 * discovering nothing, twenty-four times.
 *
 * The card then asks the image route for ONE source at a time and
 * walks the chain itself on 404: street, then aerial, then the sketch.
 * That is what makes the corner tag honest. A tag written from the
 * deployment probe said "Street View" over every roof Google had no
 * kerb shot for; a tag written from the stage whose image actually
 * loaded cannot.
 */

export interface ImagerySources {
  /** Google Street View: a kerb shot. The good one. */
  street: boolean;
  /** Mapbox aerial: a roof and a lot. Nationwide, no coverage gaps. */
  aerial: boolean;
}

const NONE: ImagerySources = { street: false, aerial: false };

let probe: Promise<ImagerySources> | null = null;

export function imagerySources(): Promise<ImagerySources> {
  probe ??= fetch("/api/property-image?probe=1")
    .then((r) => (r.ok ? r.json() : NONE))
    .then((d: Partial<ImagerySources>) => ({
      street: Boolean(d?.street),
      aerial: Boolean(d?.aerial),
    }))
    .catch(() => NONE);
  return probe;
}

/** The picture a card is on. "sketch" is the seeded drawing, and the
 *  end of the chain. */
export type ImageryStage = "street" | "aerial" | "sketch";
/** A stage the server can draw. */
export type ImagerySource = Exclude<ImageryStage, "sketch">;

/** What the tag under the picture says. Named for what the picture IS,
 *  never for what it is not — "No photo" beside a "View photos" link
 *  read as a contradiction. */
export const STAGE_LABEL: Record<ImagerySource, string> = {
  street: "Street View",
  aerial: "Aerial",
};

/** The best source this deployment has, or the sketch when it has none. */
export function firstStage(sources: ImagerySources): ImageryStage {
  if (sources.street) return "street";
  if (sources.aerial) return "aerial";
  return "sketch";
}

/**
 * Where a card goes when the stage it is on has no picture for THIS
 * coordinate: Street View gives way to an aerial when there is one,
 * and everything gives way to the sketch.
 */
export function nextStage(
  stage: ImageryStage,
  sources: ImagerySources
): ImageryStage {
  if (stage === "street" && sources.aerial) return "aerial";
  return "sketch";
}

/** The image URL for a point. Our route, so keys stay server-side. With
 *  a source, the route serves that source or 404s — never a stand-in —
 *  which is what lets the card label what it shows. */
export function propertyImageSrc(
  lat: number,
  lon: number,
  source?: ImagerySource
): string {
  const base = `/api/property-image?lat=${lat}&lon=${lon}`;
  return source ? `${base}&source=${source}` : base;
}
