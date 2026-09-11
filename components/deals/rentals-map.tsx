"use client";

/**
 * The Deal Finder map: MapLibre over keyless OSM vector tiles, one
 * Zillow-shaped price pin per listing. Hover syncs with the card grid
 * in both directions; clicking a pin scrolls its card into view.
 *
 * THE MAP DRIVES THE LIST. Once somebody moves the map themselves —
 * scroll to zoom, drag, the +/− buttons — the viewport is reported up
 * on every settle, and the grid shows only what is inside it, the way
 * every property portal works. A programmatic move (a new search
 * framing its metro) reports nothing and clears the constraint: the
 * search decides what is shown until the person takes the wheel again.
 * While they have it, the camera holds — no refit yanks the view back.
 *
 * Tiles load in the browser; if the network blocks them the pins and
 * interactions still work over the quiet fallback surface.
 */

import * as React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import { basemapStyle, describeMapError, documentTheme, type BasemapTheme } from "@/lib/map/basemap";
import { fmtMoney, fmtMoneyShort } from "@/lib/format";
import type { RentalListing } from "@/lib/mock/types";
import type { ZipBoundary } from "@/lib/map/zip-boundary";
import { createPricePin } from "@/lib/map/price-pin";
import { autoCollapseAttribution } from "@/lib/map/attribution";
import { cn } from "@/lib/utils";
import type { GeoJSON } from "geojson";


/** Continental-US default framing before any pins ask for better. */
const US_CENTER: [number, number] = [-96.8, 38.6];
const US_ZOOM = 3.2;

/** Where the camera should sit for a targeted search: the searched
 *  area itself, so the whole metro frames even when pins cluster. */
export interface MapFocus {
  key: string;
  lat: number;
  lon: number;
  radiusMiles: number;
  /** The exact box to frame, when the area has a known outline — a
   *  ZIP's boundary. Set, it replaces the radius above. */
  bounds?: [number, number, number, number];
}

/* ------------------------------------------------------------------ */
/* The searched ZIP's outline                                          */
/* ------------------------------------------------------------------ */

const BOUNDARY_SOURCE = "zip-boundary";
const BOUNDARY_FILL = "zip-boundary-fill";
const BOUNDARY_LINE = "zip-boundary-line";
/** The pins' red (--select in globals.css). The dark theme inverts the
 *  canvas and turns the hue back, so a mid-lightness red is still a
 *  red there. */
const BOUNDARY_RED = "#d7263d";
const NOTHING: GeoJSON = { type: "FeatureCollection", features: [] };

/**
 * Draw (or clear) the searched ZIP's outline: a faint red wash under
 * the street names so they stay legible, and a red border over
 * everything, the way a drawn boundary reads on every property site.
 * Only ever called once the style has loaded — a source added before
 * that is thrown away with the placeholder style.
 */
/** drawBoundary, with a failure named in the console rather than thrown
 *  into an event handler where nobody sees it. */
function safeDrawBoundary(map: maplibregl.Map, boundary: ZipBoundary | null): void {
  try {
    drawBoundary(map, boundary);
  } catch (e) {
    console.warn("ZIP outline could not be drawn:", e);
  }
}

function drawBoundary(map: maplibregl.Map, boundary: ZipBoundary | null): void {
  const data: GeoJSON = boundary ? (boundary.feature as GeoJSON) : NOTHING;
  const source = map.getSource(BOUNDARY_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(BOUNDARY_SOURCE, { type: "geojson", data });
  const firstSymbol = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: BOUNDARY_FILL,
      type: "fill",
      source: BOUNDARY_SOURCE,
      paint: { "fill-color": BOUNDARY_RED, "fill-opacity": 0.07 },
    },
    firstSymbol
  );
  map.addLayer({
    id: BOUNDARY_LINE,
    type: "line",
    source: BOUNDARY_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": BOUNDARY_RED, "line-width": 2.5, "line-opacity": 0.95 },
  });
}

/** The map's current viewport, in degrees. */
export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Whether a point sits inside the viewport. Longitude wraps at the
 *  antimeridian, which the continental US never reaches, but the check
 *  is written for a box that does anyway. */
export function inBounds(p: { lat: number; lon: number }, b: MapBounds): boolean {
  const latOk = p.lat >= b.south && p.lat <= b.north;
  const lonOk =
    b.west <= b.east
      ? p.lon >= b.west && p.lon <= b.east
      : p.lon >= b.west || p.lon <= b.east;
  return latOk && lonOk;
}

interface RentalsMapProps {
  listings: RentalListing[];
  /** Set for a market/ZIP search; null while browsing nationwide. */
  focus: MapFocus | null;
  /** The searched ZIP's outline, drawn in the pins' red; null clears it. */
  boundary?: ZipBoundary | null;
  /** A card docked at the map's bottom edge — the clicked pin's listing. */
  dock?: React.ReactNode;
  /** A click on the map itself, away from any pin: the dock is dismissed. */
  onClear?: () => void;
  /** The viewport after each move the PERSON made; null when a search
   *  re-framed the map and the constraint should lift. */
  onViewportChange?: (bounds: MapBounds | null) => void;
  /** True while the grid is constrained to the viewport — shows the
   *  "show all" control. */
  viewFiltered?: boolean;
  onResetView?: () => void;
  /** The feed has been asked and hasn't answered. An empty map with no
   *  word for it is the same picture as a broken one. */
  loading?: boolean;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  className?: string;
}

const MILES_PER_DEG_LAT = 69;

export function RentalsMap({
  listings,
  focus,
  boundary = null,
  dock = null,
  onClear,
  onViewportChange,
  viewFiltered = false,
  onResetView,
  loading = false,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  className,
}: RentalsMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef(new Map<string, maplibregl.Marker>());
  const markerElsRef = React.useRef(new Map<string, HTMLButtonElement>());
  const marketSigRef = React.useRef<string>("");
  const focusKeyRef = React.useRef<string>("");
  /** The style has loaded, so sources and layers may be added. */
  const styleReadyRef = React.useRef(false);
  /** The outline to draw, held for the moment the style is ready. */
  const boundaryRef = React.useRef<ZipBoundary | null>(boundary);
  /** A move the person started is in progress (set on movestart with a
   *  real input event; programmatic moves carry none). */
  const gestureRef = React.useRef(false);
  /** The person has moved the map since the last search framed it, so
   *  the camera is theirs and no refit may take it back. */
  const userMovedRef = React.useRef(false);
  /** The last thing MapLibre complained about, or null once a frame
   *  has actually rendered. Named rather than counted: a blank map
   *  should say whose tiles didn't arrive. */
  const [tileError, setTileError] = React.useState<string | null>(null);
  /** The theme the loaded style was asked for, so a toggle swaps it. */
  const styleThemeRef = React.useRef<BasemapTheme>("light");
  const { resolvedTheme } = useTheme();

  // The theme toggled: the same map, a style drawn for the other side.
  // Pins are DOM and stay; the outline is redrawn when the style lands.
  React.useEffect(() => {
    const map = mapRef.current;
    const theme: BasemapTheme = resolvedTheme === "dark" ? "dark" : "light";
    if (!map || styleThemeRef.current === theme) return;
    styleThemeRef.current = theme;
    styleReadyRef.current = false;
    map.setStyle(basemapStyle(theme));
  }, [resolvedTheme]);

  // Latest handlers reachable from marker listeners without rebuilds.
  const onHoverRef = React.useRef(onHover);
  const onSelectRef = React.useRef(onSelect);
  const onViewportRef = React.useRef(onViewportChange);
  const onClearRef = React.useRef(onClear);
  React.useEffect(() => {
    onHoverRef.current = onHover;
    onSelectRef.current = onSelect;
    onViewportRef.current = onViewportChange;
    onClearRef.current = onClear;
  }, [onHover, onSelect, onViewportChange, onClear]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const markers = markersRef.current;
    const els = markerElsRef.current;
    styleThemeRef.current = documentTheme();
    const map = new maplibregl.Map({
      container,
      style: basemapStyle(styleThemeRef.current),
      center: US_CENTER,
      zoom: US_ZOOM,
      attributionControl: { compact: true },
      // Scroll zooms when the pointer is over the map, as on every
      // property site. The Alt-to-zoom gesture read as a broken map.
      cooperativeGestures: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );
    // The credits have to be on the map (ODbL + the tile provider's
    // terms); they do not have to be open. Folded to the ⓘ badge until
    // the reader clicks it.
    const uncollapse = autoCollapseAttribution(map);
    // Sources and layers may be added once the STYLE is in — not once
    // the map is "loaded", which also waits on every sprite, glyph and
    // tile and never arrives when one of those quietly fails, while the
    // map itself draws fine. Gating the outline on "load" is why it
    // never showed. "style.load" fires on the style alone; "load" is
    // kept as a second chance, and drawing twice is harmless.
    const ready = () => {
      styleReadyRef.current = true;
      safeDrawBoundary(map, boundaryRef.current);
    };
    map.on("style.load", ready);
    map.on("load", ready);
    // A new style throws the outline away; "style.load" draws it again.
    map.on("styledata", () => {
      if (!map.isStyleLoaded()) styleReadyRef.current = false;
    });
    // A pin's click never reaches here (it stops at the pin), so this
    // is the map itself: the docked card goes away.
    map.on("click", () => onClearRef.current?.());

    // Tiles can't load in offline previews — pins still place to scale.
    // Report, never intervene. An earlier cut swapped in an empty
    // style on the first error, which could blank a map whose tiles
    // were about to arrive; MapLibre already draws whatever it has.
    map.on("error", (event) => setTileError(describeMapError(event)));
    // Cleared by a tile that actually arrived — NOT by "idle", which
    // fires just as happily when every tile failed and there is nothing
    // left to try. Clearing on idle is why a blank map stayed silent.
    map.on("sourcedata", (event) => {
      if (event.tile && event.isSourceLoaded) setTileError(null);
    });

    // A move with an input event behind it is the person's; a fitBounds
    // has none. Only the person's moves constrain the grid.
    map.on("movestart", (event) => {
      if ((event as { originalEvent?: unknown }).originalEvent) {
        gestureRef.current = true;
        userMovedRef.current = true;
      }
    });
    map.on("moveend", () => {
      if (!gestureRef.current) return;
      gestureRef.current = false;
      const b = map.getBounds();
      onViewportRef.current?.({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    });

    // The pane hides below lg (mobile toggle); resize when it reappears.
    const resizer = new ResizeObserver(() => map.resize());
    resizer.observe(container);

    return () => {
      resizer.disconnect();
      uncollapse();
      markers.clear();
      els.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // One price pill per visible listing; rebuild on page/filter changes.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const els = markerElsRef.current;
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    els.clear();

    for (const l of listings) {
      // The pin (lib/map/price-pin, styles in globals.css): red pill,
      // short tail, the rent compacted the way the portals print it —
      // $2.4K reads at a glance; the exact figure is on the card and in
      // the label.
      const { marker, pin } = createPricePin({
        label: fmtMoneyShort(l.rentMonthly),
        ariaLabel: `${l.address}, ${l.city} — ${fmtMoney(l.rentMonthly)} a month`,
        onHover: (hot) => onHoverRef.current(hot ? l.id : null),
        onClick: () => onSelectRef.current(l.id),
      });
      els.set(l.id, pin);
      markers.set(
        l.id,
        // Anchored at the bottom so the tail's tip sits on the address,
        // not the pill's centre.
        new maplibregl.Marker({ element: marker, anchor: "bottom", offset: [0, -6] })
          .setLngLat([l.lon, l.lat])
          .addTo(map)
      );
    }

    // A targeted search frames the searched AREA — the whole metro or
    // ZIP radius — so the city reads as a city even when its listings
    // cluster downtown. Nationwide browsing refits only when the mix of
    // markets on screen materially changes, so paging holds the camera.
    const signature = [...new Set(listings.map((l) => l.marketSlug))]
      .sort()
      .join("|");

    if (focus) {
      if (focus.key !== focusKeyRef.current) {
        // A new search takes the wheel back: the constraint lifts and
        // the camera frames the searched area.
        userMovedRef.current = false;
        onViewportRef.current?.(null);
        const dLat = focus.radiusMiles / MILES_PER_DEG_LAT;
        const dLon =
          dLat / Math.max(0.2, Math.cos((focus.lat * Math.PI) / 180));
        // A known outline is framed exactly; otherwise the radius.
        const box = focus.bounds
          ? new maplibregl.LngLatBounds(
              [focus.bounds[0], focus.bounds[1]],
              [focus.bounds[2], focus.bounds[3]]
            )
          : new maplibregl.LngLatBounds(
              [focus.lon - dLon, focus.lat - dLat],
              [focus.lon + dLon, focus.lat + dLat]
            );
        map.fitBounds(box, { padding: 40, duration: 600 });
      }
    } else if (
      listings.length > 0 &&
      signature !== marketSigRef.current &&
      !userMovedRef.current
    ) {
      const bounds = new maplibregl.LngLatBounds(
        [listings[0].lon, listings[0].lat],
        [listings[0].lon, listings[0].lat]
      );
      for (const l of listings) bounds.extend([l.lon, l.lat]);
      map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 0 });
    }
    focusKeyRef.current = focus?.key ?? "";
    marketSigRef.current = signature;
  }, [listings, focus]);

  // The searched ZIP's outline follows the search; drawn now if the
  // style is ready, else the moment it is.
  React.useEffect(() => {
    boundaryRef.current = boundary;
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    safeDrawBoundary(map, boundary);
  }, [boundary]);

  /**
   * Card hover / pill click → pin highlight (map hover feeds back
   * through onHover, so both directions stay in sync).
   *
   * ONLY THE PINS THAT CHANGED. This fires on every card the pointer
   * crosses, and walking every pin on screen to light one is work
   * repeated for nothing — the three ids involved are the two from last
   * time and the two from now.
   */
  const litRef = React.useRef<{ hovered: string | null; selected: string | null }>({
    hovered: null,
    selected: null,
  });
  React.useEffect(() => {
    const paint = (id: string | null) => {
      if (!id) return;
      const el = markerElsRef.current.get(id);
      if (!el) return;
      const selected = id === selectedId;
      const hot = id === hoveredId && !selected;
      el.classList.toggle("is-hot", hot);
      el.classList.toggle("is-selected", selected);
      // Stacking lives on the positioned wrapper, not the pill.
      (el.parentElement ?? el).style.setProperty(
        "z-index",
        selected ? "40" : hot ? "30" : "10"
      );
    };
    const was = litRef.current;
    for (const id of new Set([was.hovered, was.selected, hoveredId, selectedId])) {
      paint(id);
    }
    litRef.current = { hovered: hoveredId, selected: selectedId };
  }, [hoveredId, selectedId]);

  /** A new set of pins starts unlit, so nothing is remembered about
   *  the old ones. Separate from the effect above, which must not know
   *  about the listings at all — that dependency is what made it walk
   *  every pin in the first place. */
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      el.classList.remove("is-hot", "is-selected");
      (el.parentElement ?? el).style.setProperty("z-index", "10");
      void id;
    }
  }, [listings]);

  return (
    <div className={cn("relative min-w-0 bg-secondary/60", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {loading ? (
        <span className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          <span
            aria-hidden
            className="size-3 animate-spin rounded-full border-2 border-border border-t-gold"
          />
          Finding rentals…
        </span>
      ) : null}
      {viewFiltered && !loading ? (
        <button
          type="button"
          onClick={onResetView}
          className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs text-foreground shadow-sm transition-colors duration-150 hover:border-gold/60 hover:text-gold"
        >
          Showing rentals in view
          <span className="font-medium text-gold">Show all</span>
        </button>
      ) : null}
      {tileError ? (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[min(28rem,90%)] rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[11px] text-muted-foreground">
          Street tiles unavailable ({tileError}) — pins still placed to
          scale.
        </p>
      ) : null}
      {dock ? <div className="absolute inset-x-3 bottom-3 z-20">{dock}</div> : null}
    </div>
  );
}
