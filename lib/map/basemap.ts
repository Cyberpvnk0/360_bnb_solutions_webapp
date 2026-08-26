import type * as maplibregl from "maplibre-gl";

/**
 * The basemap both maps draw on.
 *
 * Which one is a deployment decision, not a code one, so it lives in
 * env and can be changed without a release:
 *
 *   NEXT_PUBLIC_MAP_STYLE_URL   any MapLibre style URL, wins outright
 *   NEXT_PUBLIC_MAPTILER_KEY    a MapTiler key; builds their style URL
 *   (neither)                   OpenFreeMap, keyless
 *
 * These are NEXT_PUBLIC_ because the style is fetched by the browser,
 * so treat the value as published — a MapTiler key belongs to a
 * domain-restricted map key, never a general API credential.
 *
 * We started on CARTO's raster tiles fetched anonymously; CARTO now
 * requires an account and serves unauthenticated tiles stamped "API KEY
 * REQUIRED" across every one. OpenFreeMap replaced them because it
 * needs no key at all, though it is donation-funded with no support
 * commitment behind it — which is exactly the trade a paying product
 * may not want, hence the env override.
 *
 * One style, not two: dark mode inverts the canvas in CSS (see
 * `.dark .maplibregl-canvas` in globals.css), so any light style works
 * in both themes with no second download and nothing to keep in sync.
 */

/** Keyless, unmetered, OpenStreetMap data. The default. */
const OPENFREEMAP = "https://tiles.openfreemap.org/styles/positron";

/** Light, low-contrast, few labels — a backdrop, not the subject. */
const MAPTILER = (key: string) =>
  `https://api.maptiler.com/maps/dataviz-light/style.json?key=${encodeURIComponent(key)}`;

export function basemapStyle(): string {
  // Referenced as whole literals: Next inlines NEXT_PUBLIC_ vars at
  // build time by textual substitution, so a computed key reads empty.
  const explicit = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (explicit) return explicit;
  const maptiler = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (maptiler) return MAPTILER(maptiler);
  return OPENFREEMAP;
}

/** Which provider the current setting resolves to, for the diagnostic
 *  line — a blank map should say whose tiles didn't arrive. */
export function basemapName(): string {
  if (process.env.NEXT_PUBLIC_MAP_STYLE_URL) return "the configured style";
  if (process.env.NEXT_PUBLIC_MAPTILER_KEY) return "MapTiler";
  return "OpenFreeMap";
}

/**
 * What a MapLibre error event is actually telling us, in one line.
 *
 * The previous cut treated any error before the style finished loading
 * as "no tiles" and swapped in an empty style, which could blank a map
 * whose tiles were fine. It now only reports: MapLibre renders what it
 * has, and an unreadable message is worth more than a silent grey box.
 */
export function describeMapError(event: unknown): string {
  const e = event as {
    error?: { message?: string; status?: number };
    sourceId?: string;
  };
  const status = e?.error?.status;
  const message = e?.error?.message ?? "unknown error";
  const where = e?.sourceId ? ` (source "${e.sourceId}")` : "";
  return status ? `HTTP ${status}${where}` : `${message}${where}`;
}

/** Nothing to draw. Pins still place to scale over it. */
export const BASEMAP_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};
