"use client";

/**
 * Is curb imagery wired up at all? Asked once per session.
 *
 * Without this, every image on a page fires its own request to find
 * out, so a grid of twenty-four spends twenty-four round trips
 * discovering the same thing — and on a deployment with no Google key,
 * discovering nothing, twenty-four times. One promise, shared.
 *
 * Lives here rather than inside one component because two surfaces now
 * draw curb shots, and two copies of this would be two probes.
 */
let probe: Promise<boolean> | null = null;

export function streetViewConfigured(): Promise<boolean> {
  probe ??= fetch("/api/street-view?probe=1")
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((d: { configured?: boolean }) => Boolean(d?.configured))
    .catch(() => false);
  return probe;
}

/** The image URL for a point. Our route, so the key stays server-side. */
export function streetViewSrc(lat: number, lon: number): string {
  return `/api/street-view?lat=${lat}&lon=${lon}`;
}
