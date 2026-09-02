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

/** The image URL for a point. Our route, so keys stay server-side and
 *  the chain between sources is decided in one place. */
export function propertyImageSrc(lat: number, lon: number): string {
  return `/api/property-image?lat=${lat}&lon=${lon}`;
}
