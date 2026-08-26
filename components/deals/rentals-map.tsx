"use client";

/**
 * The Deal Finder map: MapLibre over keyless OSM vector tiles, one
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
import {
  basemapName,
  basemapStyle,
  describeMapError,
} from "@/lib/map/basemap";
import { fmtMoney } from "@/lib/format";
import type { RentalListing } from "@/lib/mock/types";
import { cn } from "@/lib/utils";


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
}

interface RentalsMapProps {
  listings: RentalListing[];
  /** Set for a market/ZIP search; null while browsing nationwide. */
  focus: MapFocus | null;
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
  /** The last thing MapLibre complained about, or null once a frame
   *  has actually rendered. Named rather than counted: a blank map
   *  should say whose tiles didn't arrive. */
  const [tileError, setTileError] = React.useState<string | null>(null);

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
    const map = new maplibregl.Map({
      container,
      style: basemapStyle(),
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
    // Report, never intervene. An earlier cut swapped in an empty
    // style on the first error, which could blank a map whose tiles
    // were about to arrive; MapLibre already draws whatever it has.
    map.on("error", (event) => setTileError(describeMapError(event)));
    // Tiles for the opening view are in. Anything logged before this
    // was transient, so the notice clears with them.
    map.on("idle", () => setTileError(null));


    // The pane hides below lg (mobile toggle); resize when it reappears.
    const resizer = new ResizeObserver(() => map.resize());
    resizer.observe(container);

    return () => {
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

    // A targeted search frames the searched AREA — the whole metro or
    // ZIP radius — so the city reads as a city even when its listings
    // cluster downtown. Nationwide browsing refits only when the mix of
    // markets on screen materially changes, so paging holds the camera.
    const signature = [...new Set(listings.map((l) => l.marketSlug))]
      .sort()
      .join("|");

    if (focus) {
      if (focus.key !== focusKeyRef.current) {
        const dLat = focus.radiusMiles / MILES_PER_DEG_LAT;
        const dLon =
          dLat / Math.max(0.2, Math.cos((focus.lat * Math.PI) / 180));
        map.fitBounds(
          new maplibregl.LngLatBounds(
            [focus.lon - dLon, focus.lat - dLat],
            [focus.lon + dLon, focus.lat + dLat]
          ),
          { padding: 40, duration: 600 }
        );
      }
    } else if (listings.length > 0 && signature !== marketSigRef.current) {
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

  // Card hover / pill click → pin highlight (map hover feeds back
  // through onHover, so both directions stay in sync).
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      const hot = id === hoveredId || id === selectedId;
      el.classList.toggle("border-gold/60", hot);
      el.classList.toggle("text-gold", hot);
      // The button IS the marker element, so stacking lives on it.
      el.style.setProperty("z-index", hot ? "30" : "10");
    }
  }, [hoveredId, selectedId, listings]);

  return (
    <div className={cn("relative min-w-0 bg-secondary/60", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {tileError ? (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[min(28rem,90%)] rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[11px] text-muted-foreground">
          Street tiles unavailable from {basemapName()} ({tileError}) — pins
          still placed to scale.
        </p>
      ) : null}
    </div>
  );
}
