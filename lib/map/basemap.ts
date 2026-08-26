import type * as maplibregl from "maplibre-gl";

/**
 * The basemap both maps draw on.
 *
 * Which provider that is gets decided server-side, at /api/map/style —
 * see that route for why. From here it is one URL that always answers
 * with a usable style, so nothing in the components knows or cares
 * whose tiles they are.
 *
 * One style, not two: dark mode inverts the canvas in CSS (see
 * `.dark .maplibregl-canvas` in globals.css), so any light style works
 * in both themes with no second download and nothing to keep in sync.
 */
export const BASEMAP_STYLE = "/api/map/style";

/**
 * What a MapLibre error event is actually telling us, in one line.
 *
 * An earlier cut treated any error arriving before the style finished
 * loading as "no tiles" and swapped in an empty style, which could
 * blank a map whose tiles were fine. Reporting is the whole job now:
 * MapLibre draws what it has, and a legible message beats a grey box.
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
