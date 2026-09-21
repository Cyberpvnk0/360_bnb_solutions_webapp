"use client";

/** Geographic view of measured annual revenue less estimated annual rent.
 * DOM markers remain independent of the basemap and its worker availability. */

import * as React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import { LocateFixed } from "lucide-react";
import {
  basemapStyle,
  documentTheme,
  type BasemapTheme,
} from "@/lib/map/basemap";
import { fmtMoneyShort, fmtPct } from "@/lib/format";
import { autoCollapseAttribution } from "@/lib/map/attribution";
import { RULE_LABEL, type MarketRow } from "@/lib/markets/explorer";
import {
  BAND_COLOR,
  BAND_LABEL,
  SPREAD_BANDS,
  UNMEASURED_COLOR,
  spreadBand,
  type SpreadBand,
} from "@/lib/markets/spread-scale";
import { cn } from "@/lib/utils";

/**
 * THE MAP STARTS WITH NO BASEMAP, ON PURPOSE.
 *
 * A basemap the network refuses used to take the markets down with it
 * and leave an empty grey box. Fetching the style first and swapping to
 * it only once it has actually arrived inverts that: the markets are on
 * screen from the first frame and the streets appear under them a
 * moment later if they are coming at all. Four hundred markets plotted
 * on nothing still say where the permissive states are, which is most
 * of what this view is for.
 *
 * MARKERS, NOT A STYLE LAYER. A GeoJSON source with circle layers is
 * the textbook way to draw four hundred points and it is what this was
 * first written as — and it drew nothing, because tiling that source
 * happens in a web worker and the worker is not always there to do it.
 * A marker is a div: it needs no worker, no source cache and no style
 * to be loaded, which is the whole point when the style may never
 * load. It is also what every other map in this product uses.
 */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "ground",
      type: "background",
      paint: { "background-color": "rgba(0,0,0,0)" },
    },
  ],
};

/**
 * Fetch a basemap style and hand back the parsed object, or null.
 *
 * Handing MapLibre a URL means it decides what a failure is, and a
 * style that 401s leaves the map with no layers and no event to hang a
 * recovery on. Fetching it here makes the failure a value this
 * component can simply not act on.
 */
async function loadStyle(url: string): Promise<maplibregl.StyleSpecification | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as maplibregl.StyleSpecification;
  } catch {
    return null;
  }
}

/**
 * What a dot is: the market's band, or nothing.
 *
 * The map used to be coloured by regulation. A rule is a fact about a
 * market but not the one somebody scanning the country is asking — the
 * question is where the money is, and the rule is what you check once a
 * market is on the shortlist. It has not gone anywhere: it is on the
 * hover card and on every row of the table.
 */
function bandOf(row: MarketRow): SpreadBand | null {
  return spreadBand(row.spread);
}

function colorOf(row: MarketRow): string {
  const band = bandOf(row);
  return band ? BAND_COLOR[band] : UNMEASURED_COLOR;
}

/**
 * One market's dot, inside a wrapper that is left strictly alone.
 *
 * THE MARKER'S OWN ELEMENT MUST NOT BE STYLED. MapLibre positions a DOM
 * marker by writing `transform: translate(...)` onto the element it was
 * handed, so a `style.transform` of ours — a scale on the selected one —
 * overwrites the placement and drops every dot it touches onto the
 * map's top-left corner until the next camera move puts it back. The
 * wrapper is MapLibre's; the button inside it is ours to animate.
 */
function dotFor(row: MarketRow): HTMLElement {
  const wrap = document.createElement("div");
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${row.name}, ${row.stateCode}`);
  const color = colorOf(row);
  const placed = bandOf(row) !== null;
  el.className = "market-map-point";
  el.dataset.measured = String(placed);
  el.style.setProperty("--point-color", color);
  el.setAttribute("title", row.name + ", " + row.stateCode + " · " + (placed ? BAND_LABEL[bandOf(row)!] : "Not measured"));
  const dot = document.createElement("span");
  dot.className = "market-map-dot";
  dot.setAttribute("aria-hidden", "true");
  el.appendChild(dot);
  wrap.style.zIndex = placed ? "1" : "0";
  wrap.appendChild(el);
  return wrap;
}

/** The dot inside a marker's wrapper. */
function dotOf(marker: maplibregl.Marker | undefined): HTMLElement | null {
  const child = marker?.getElement().firstElementChild;
  return child instanceof HTMLElement ? child : null;
}

/**
 * The box to frame, which is not simply every market's box.
 *
 * Alaska and Hawaii are four thousand miles from the rest of the
 * catalogue, so a bounds that includes them shrinks the lower forty-
 * eight — four hundred markets — to a smudge in the middle of the
 * panel to make room for six. When the overwhelming majority of what
 * is on screen is contiguous, frame that and let the other two states
 * sit outside the initial view; filter down to them and the majority
 * flips, so the map flies there instead.
 */
const LOWER_48 = { west: -125.5, east: -66.5, south: 24, north: 49.5 };

function framing(rows: MarketRow[]): maplibregl.LngLatBounds {
  const inside = rows.filter(
    (r) =>
      r.lon >= LOWER_48.west &&
      r.lon <= LOWER_48.east &&
      r.lat >= LOWER_48.south &&
      r.lat <= LOWER_48.north,
  );
  const frame = inside.length >= rows.length * 0.85 && inside.length > 0 ? inside : rows;
  const bounds = new maplibregl.LngLatBounds();
  for (const r of frame) bounds.extend([r.lon, r.lat]);
  return bounds;
}

interface Props {
  rows: MarketRow[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  /** MapLibre measures its container, so the caller has to give this
   *  one a height that resolves to a real number at every width rather
   *  than inherit from a stretched grid row. */
  className?: string;
}


export function MarketsMap({ rows, selected, onSelect, className }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<maplibregl.Marker[]>([]);
  const [live, setLive] = React.useState(false);
  const [hovered, setHovered] = React.useState<MarketRow | null>(null);
  const styleThemeRef = React.useRef<BasemapTheme>("light");
  const { resolvedTheme } = useTheme();

  const onSelectRef = React.useRef(onSelect);
  const selectedRef = React.useRef(selected);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
    selectedRef.current = selected;
  }, [onSelect, selected]);

  // Built once. Markers and the view are cheap and get their own
  // effects; creating a MapLibre instance is the expensive one.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    styleThemeRef.current = documentTheme();
    let alive = true;
    const map = new maplibregl.Map({
      container,
      // The markets first; the streets when and if they arrive.
      style: BLANK_STYLE,
      center: [-97, 38.5],
      zoom: 3.1,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // The credits have to be on the map (ODbL + the tile provider's
    // terms); they do not have to be open. Folded to the ⓘ badge until
    // the reader clicks it.
    const uncollapse = autoCollapseAttribution(map);
    map.on("load", () => {
      setLive(true);
      void loadStyle(basemapStyle(styleThemeRef.current)).then((loaded) => {
        if (alive && loaded) map.setStyle(loaded);
      });
    });
    // Clicking the ground clears the selection, as on every map.
    map.on("click", () => onSelectRef.current(null));

    /**
     * THE PANEL DOES NOT EXIST UNTIL IT IS ASKED FOR.
     *
     * This map is created the moment "Show map" is pressed, in the same
     * commit that first renders its container, so MapLibre measures an
     * element the browser has not laid out yet. Every later size change
     * goes through here too, which is what a sticky panel beside a
     * resizing table needs anyway.
     */
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);

    return () => {
      alive = false;
      resize.disconnect();
      uncollapse();
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    const theme: BasemapTheme = resolvedTheme === "dark" ? "dark" : "light";
    if (!map || styleThemeRef.current === theme) return;
    styleThemeRef.current = theme;
    let alive = true;
    // Same rule as the first load: a style that does not arrive is one
    // this map does not swap to, rather than one it breaks on.
    void loadStyle(basemapStyle(theme)).then((loaded) => {
      if (alive && loaded) map.setStyle(loaded);
    });
    return () => {
      alive = false;
    };
  }, [resolvedTheme]);

  // The rows changed: new dots, and a view that frames them. Filtering
  // to one state should fly there rather than leave it to be found.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !live) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = rows.map((row) => {
      const wrap = dotFor(row);
      wrap.addEventListener("mouseenter", () => setHovered(row));
      wrap.addEventListener("mouseleave", () => setHovered(null));
      wrap.addEventListener("focusin", () => setHovered(row));
      wrap.addEventListener("focusout", () => setHovered(null));
      wrap.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(row.slug === selectedRef.current ? null : row.slug);
      });
      return new maplibregl.Marker({ element: wrap }).setLngLat([row.lon, row.lat]).addTo(map);
    });
    if (rows.length === 0) return;
    map.fitBounds(framing(rows), {
      padding: { top: 30, bottom: 30, left: 28, right: 28 },
      maxZoom: rows.length === 1 ? 9 : 11,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600,
    });
  }, [rows, live]);

  /**
   * The selected market, lit wherever it was chosen — a pin, or a row
   * under the pointer. Styles the dot, never the wrapper around it.
   *
   * TWO MARKERS, NOT FOUR HUNDRED. This runs on every row the pointer
   * crosses, and walking the whole catalogue to change one dot made
   * hovering a table feel like work. Only the dot that was lit and the
   * dot that is now need touching; the index of the last one is kept
   * so the first can be found without a search.
   */
  const litRef = React.useRef<{ marker: maplibregl.Marker; row: MarketRow } | null>(
    null
  );
  React.useEffect(() => {
    const paint = (
      marker: maplibregl.Marker,
      row: MarketRow,
      on: boolean
    ) => {
      const el = dotOf(marker);
      if (!el) return;
      el.dataset.selected = String(on);
      el.setAttribute("aria-pressed", String(on));
      marker.getElement().style.zIndex = on ? "3" : bandOf(row) !== null ? "1" : "0";
    };

    const i = selected ? rows.findIndex((r) => r.slug === selected) : -1;
    const marker = i >= 0 ? markersRef.current[i] : undefined;
    const next = marker ? { marker, row: rows[i] } : null;
    if (next?.marker === litRef.current?.marker) return;
    // The old one by its element rather than its index: a rebuild
    // replaces the whole array, and painting a marker that is no longer
    // on the map is a write to a detached node — harmless, and cheaper
    // than another effect reaching across to reset a shared index.
    if (litRef.current) paint(litRef.current.marker, litRef.current.row, false);
    if (next) paint(next.marker, next.row, true);
    litRef.current = next;
  }, [selected, rows, live]);


  const measuredCount = rows.filter((row) => row.spread !== null).length;
  const resetView = () => {
    if (!rows.length) return;
    mapRef.current?.fitBounds(framing(rows), {
      padding: 30, maxZoom: rows.length === 1 ? 9 : 11,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
    });
  };

  return (
    <div className={cn("market-map flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Market landscape</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Find where revenue goes further</p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[10px] tabular text-muted-foreground">
          <span className="font-semibold text-foreground">{measuredCount}</span> / {rows.length} measured
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-secondary">
        <div ref={containerRef} className="size-full" />
        <button type="button" onClick={resetView} title="Fit all visible markets" aria-label="Fit all visible markets"
          className="absolute left-3 top-3 z-10 flex size-8 items-center justify-center rounded-lg border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
          <LocateFixed aria-hidden className="size-4" />
        </button>
        {rows.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg border border-border bg-card/95 px-4 py-3 text-xs text-muted-foreground">No markets match these filters</p>
          </div>
        ) : null}
        {hovered ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 w-52 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
            <p className="truncate text-xs font-semibold text-foreground">{hovered.name}, {hovered.stateCode}</p>
            {hovered.spread !== null ? (
              <>
                <p className="mt-1 text-xl font-semibold tracking-tight tabular" style={{ color: colorOf(hovered) }}>
                  {hovered.spread >= 0 ? "+" : "−"}{fmtMoneyShort(Math.abs(hovered.spread))}
                  <span className="ml-1 text-[10px] font-normal tracking-normal text-muted-foreground">/ year vs. rent</span>
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {hovered.measured?.revenue != null ? fmtMoneyShort(hovered.measured.revenue) + " revenue" : ""}
                  {hovered.measured?.occupancy != null ? " · " + fmtPct(hovered.measured.occupancy) + " booked" : ""}
                </p>
              </>
            ) : <p className="mt-1 text-xs text-muted-foreground">Not measured yet</p>}
            <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">{RULE_LABEL[hovered.regulation.status]} · Click to select</p>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-border px-4 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px]">
          <span className="font-medium text-foreground">Annual revenue − rent</span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="size-1.5 rounded-full border border-muted-foreground/60" /> Not measured</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full" role="img" aria-label="Market spread: well under rent, under rent, about level, over rent, well over rent">
          {SPREAD_BANDS.map((band) => <span key={band} className="flex-1" style={{ backgroundColor: BAND_COLOR[band] }} title={BAND_LABEL[band]} />)}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] tabular text-muted-foreground"><span>−$20K or less</span><span>Near $0</span><span>+$20K or more</span></div>
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground/80">Before cleaning, fees, utilities and furnishing.</p>
      </div>
    </div>
  );
}
