import type * as maplibregl from "maplibre-gl";

/**
 * The basemap both maps draw on.
 *
 * Which provider that is gets decided server-side, at /api/map/style —
 * see that route for why. From here it is one URL per theme that
 * always answers with a usable style, so nothing in the components
 * knows or cares whose tiles they are.
 *
 * Two styles, one per theme: the provider draws the dark map as a
 * dark map. An earlier cut inverted the light canvas in CSS, which
 * turned parks black-green and roads into wires; a map drawn for the
 * dark is the map the rest of the dark theme deserves.
 */
export type BasemapTheme = "light" | "dark";

export function basemapStyle(theme: BasemapTheme): string {
  return theme === "dark" ? "/api/map/style?theme=dark" : "/api/map/style";
}

/** The theme the page is showing right now, read off the document:
 *  the theme provider writes the class before the first paint, so it
 *  is right at the moment a map is created. */
export function documentTheme(): BasemapTheme {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

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
