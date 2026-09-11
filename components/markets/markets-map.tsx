"use client";

/**
 * Four hundred markets on one map of the country.
 *
 * The table answers "which market", this answers "where" — and for a
 * strategy whose first constraint is the local rule, where matters in
 * a way a sorted list cannot show: the bans cluster, the permissive
 * states are obvious at a glance, and a student picking somewhere to
 * work can see the shape of it before reading a row.
 *
 * Colour is the rule and nothing else — gold where nightly letting is
 * permitted, red where it is banned, plain in between. Size is whether
 * the market has measured figures, so the filled dots are the ones
 * with something to read and the hollow ones are honestly empty.
 *
 * The view follows the filters: narrowing to one state flies to that
 * state rather than leaving somebody to find it.
 */

import * as React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import {
  basemapStyle,
  documentTheme,
  type BasemapTheme,
} from "@/lib/map/basemap";
import { fmtMoneyShort, fmtPct } from "@/lib/format";
import { RULE_LABEL, type MarketRow } from "@/lib/markets/explorer";
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
 * The rule, as a colour: gold where nightly letting is open, red where
 * it is closed, plain grey for the two in between. These are the same
 * three the table's pills use, written as hex because a marker is an
 * inline style rather than a class.
 */
const RULE_COLOR: Record<string, string> = {
  permitted: "#e3b341",
  "permit-required": "#8c8c96",
  unverified: "#b9b9c2",
  banned: "#c41e2e",
};

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
  const color = RULE_COLOR[row.regulation.status] ?? RULE_COLOR.unverified;
  const size = row.measured ? 11 : 8;
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    "display:block",
    "border-radius:9999px",
    "cursor:pointer",
    "padding:0",
    `background:${row.measured ? color : "transparent"}`,
    `border:1.5px solid ${color}`,
    `opacity:${row.measured ? "0.95" : "0.55"}`,
    "transition:transform 150ms ease, box-shadow 150ms ease",
  ].join(";");
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
      wrap.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(row.slug === selectedRef.current ? null : row.slug);
      });
      return new maplibregl.Marker({ element: wrap }).setLngLat([row.lon, row.lat]).addTo(map);
    });
    if (rows.length === 0) return;
    map.fitBounds(framing(rows), {
      padding: 48,
      maxZoom: rows.length === 1 ? 9 : 11,
      duration: 600,
    });
  }, [rows, live]);

  // The selected market, lit wherever it was chosen — a pin, or a row
  // under the pointer. Styles the dot, never the wrapper around it.
  React.useEffect(() => {
    rows.forEach((row, i) => {
      const el = dotOf(markersRef.current[i]);
      if (!el) return;
      const color = RULE_COLOR[row.regulation.status] ?? RULE_COLOR.unverified;
      const on = row.slug === selected;
      el.style.transform = on ? "scale(1.7)" : "scale(1)";
      el.style.boxShadow = on ? `0 0 0 5px ${color}38` : "";
      el.style.opacity = on ? "1" : row.measured ? "0.95" : "0.55";
      const wrap = markersRef.current[i]?.getElement();
      if (wrap) wrap.style.zIndex = on ? "2" : "";
    });
  }, [selected, rows, live]);

  const card =
    hovered ?? (selected ? (rows.find((r) => r.slug === selected) ?? null) : null);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-border bg-secondary/40",
        className
      )}
    >
      {/* Sized directly, not positioned. MapLibre's own stylesheet sets
          `position: relative` on whatever it mounts into, which beats an
          `absolute inset-0` and collapses the element to nothing. */}
      <div ref={containerRef} className="size-full" />
      {/* What the colours mean, where somebody looking at them is. */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border bg-card/95 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm">
        {(["permitted", "permit-required", "banned"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: RULE_COLOR[s] }}
            />
            {RULE_LABEL[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full border border-muted-foreground/60" />
          No figures yet
        </span>
      </div>

      {card ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 w-48 rounded-sm border border-border bg-card/95 px-3 py-2 shadow-md">
          <p className="truncate text-sm font-medium text-foreground">{card.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {card.stateCode} · {RULE_LABEL[card.regulation.status]}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground tabular">
            {card.measured?.revenue != null
              ? `${fmtMoneyShort(card.measured.revenue)}/yr${
                  card.measured.occupancy != null
                    ? ` · ${fmtPct(card.measured.occupancy)} booked`
                    : ""
                }`
              : "No measured figures yet"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
