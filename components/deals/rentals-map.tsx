"use client";

/**
 * The Deal Finder map: MapLibre over CARTO/OSM raster tiles, one
 * rounded price pill per listing on the current page. Hover syncs with
 * the card grid in both directions; clicking a pill scrolls its card
 * into view. The camera refits whenever the filtered set moves to a
 * materially different mix of markets; until then it holds still so
 * paging deeper doesn't yank the view around.
 *
 * Tiles load in the browser; if the network blocks them the pins and
 * interactions still work over the quiet fallback surface.
 */

import * as React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fmtMoney } from "@/lib/format";
import type { RentalListing } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

const LIGHT_TILES = ["a", "b", "c", "d"].map(
  (s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`
);
const DARK_TILES = ["a", "b", "c", "d"].map(
  (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`
);

const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';

function rasterStyle(tiles: string[]): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution: ATTRIBUTION,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

/** Continental-US default framing before any pins ask for better. */
const US_CENTER: [number, number] = [-96.8, 38.6];
const US_ZOOM = 3.2;

interface RentalsMapProps {
  /** Only the currently visible page of listings gets a pill. */
  listings: RentalListing[];
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  className?: string;
}

export function RentalsMap({
  listings,
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
  const [tilesBlocked, setTilesBlocked] = React.useState(false);

  // Latest handlers reachable from marker listeners without rebuilds.
  const onHoverRef = React.useRef(onHover);
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onHoverRef.current = onHover;
    onSelectRef.current = onSelect;
  }, [onHover, onSelect]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const markers = markersRef.current;
    const els = markerElsRef.current;

    const dark = document.documentElement.classList.contains("dark");
    const map = new maplibregl.Map({
      container,
      style: rasterStyle(dark ? DARK_TILES : LIGHT_TILES),
      center: US_CENTER,
      zoom: US_ZOOM,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    // Tiles can't load in offline previews — pins still place to scale.
    map.on("error", (e) => {
      if ((e as { sourceId?: string }).sourceId === "basemap") {
        setTilesBlocked(true);
      }
    });

    // Follow the app theme without rebuilding the map.
    const observer = new MutationObserver(() => {
      const nowDark = document.documentElement.classList.contains("dark");
      map.setStyle(rasterStyle(nowDark ? DARK_TILES : LIGHT_TILES));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // The pane hides below lg (mobile toggle); resize when it reappears.
    const resizer = new ResizeObserver(() => map.resize());
    resizer.observe(container);

    return () => {
      observer.disconnect();
      resizer.disconnect();
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
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute(
        "aria-label",
        `${l.address}, ${l.city} — ${fmtMoney(l.rentMonthly)} a month`
      );
      el.className =
        "cursor-pointer rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-foreground tabular transition-colors duration-150 hover:border-gold/60 hover:text-gold";
      el.style.boxShadow = "var(--elev)";
      el.textContent = fmtMoney(l.rentMonthly);
      el.addEventListener("mouseenter", () => onHoverRef.current(l.id));
      el.addEventListener("mouseleave", () => onHoverRef.current(null));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectRef.current(l.id);
      });
      els.set(l.id, el);
      markers.set(
        l.id,
        new maplibregl.Marker({ element: el })
          .setLngLat([l.lon, l.lat])
          .addTo(map)
      );
    }

    // Refit only when the set of markets on screen materially changes —
    // paging deeper inside the same markets keeps the camera still.
    const signature = [...new Set(listings.map((l) => l.marketSlug))]
      .sort()
      .join("|");
    if (listings.length > 0 && signature !== marketSigRef.current) {
      const bounds = new maplibregl.LngLatBounds(
        [listings[0].lon, listings[0].lat],
        [listings[0].lon, listings[0].lat]
      );
      for (const l of listings) bounds.extend([l.lon, l.lat]);
      map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 0 });
    }
    marketSigRef.current = signature;
  }, [listings]);

  // Card hover / pill click → pin highlight (map hover feeds back
  // through onHover, so both directions stay in sync).
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      const hot = id === hoveredId || id === selectedId;
      el.classList.toggle("border-gold/60", hot);
      el.classList.toggle("text-gold", hot);
      el.parentElement?.style.setProperty("z-index", hot ? "30" : "10");
    }
  }, [hoveredId, selectedId, listings]);

  return (
    <div className={cn("relative min-w-0 bg-secondary/60", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {tilesBlocked ? (
        <p className="pointer-events-none absolute left-3 top-3 z-20 rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[11px] text-muted-foreground">
          Street tiles unavailable here — pins still placed to scale.
        </p>
      ) : null}
    </div>
  );
}
