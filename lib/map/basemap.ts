import type * as maplibregl from "maplibre-gl";

/**
 * The basemap both maps draw on.
 *
 * Previously CARTO's raster tiles, fetched anonymously. CARTO now
 * requires an account for those, and rather than refuse they serve the
 * tiles stamped "API KEY REQUIRED" across every one — which is how a
 * Tampa search came to show a watermark through the price pins.
 *
 * OpenFreeMap serves OpenStreetMap vector tiles with no key, no account
 * and no request ceiling, which is the only arrangement that survives
 * handing this to a few thousand students at once. Vector rather than
 * raster also means labels stay sharp at every zoom instead of blurring
 * between tile steps.
 *
 * There is one style, not two: dark mode is a CSS filter over the
 * canvas (`.dark .maplibregl-canvas` in globals.css), so following the
 * theme costs no second download and no style swap mid-session.
 */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/**
 * Shown when the style can't be fetched at all. The pins still place to
 * scale over it, so an offline preview degrades to a diagram rather
 * than an empty box.
 */
export const BASEMAP_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};
