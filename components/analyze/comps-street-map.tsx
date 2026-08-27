"use client";

/**
 * Real street map for the comp set: MapLibre over CARTO/OSM raster tiles,
 * the subject property at center and every comp pinned at its true
 * distance (bearings seeded for the preview — the caption says so).
 * Clicking a price pill docks a listing card with the property sketch and
 * an "open this area on Airbnb" link in a new tab. When live data lands,
 * the pins and links swap to real listings without touching this layout.
 *
 * Tiles load in the browser; if the network blocks them the pins and
 * interactions still work over the quiet fallback surface.
 */

import * as React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_STYLE, describeMapError } from "@/lib/map/basemap";
import { ArrowUpRight, X } from "lucide-react";
import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { fmtMiles, fmtMoney, fmtPct } from "@/lib/format";
import type { StrComp } from "@/lib/mock/types";
import { PropertyThumb } from "./property-thumb";
import { cn } from "@/lib/utils";


function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MILES_PER_DEG_LAT = 69;

export interface PlacedComp extends StrComp {
  lat: number;
  lon: number;
  /** True when the feed gave a real position, false when the bearing
   *  was invented to sit the comp at the right distance. */
  placed: boolean;
}

/** Subject sits near the market center, offset deterministically per
 *  analysis so two pulls in one city don't stack. */
export function subjectPoint(
  center: { lat: number; lon: number },
  seedId: string
): { lat: number; lon: number } {
  const h = hash(seedId);
  return {
    lat: center.lat + (((h % 200) - 100) / 100) * 0.018,
    lon: center.lon + ((((h >> 8) % 200) - 100) / 100) * 0.022,
  };
}

/** True distance, seeded golden-angle bearing — same spread the radar
 *  preview used, now in geographic space. */
export function placeComps(
  subject: { lat: number; lon: number },
  comps: StrComp[]
): PlacedComp[] {
  const milesPerDegLon =
    MILES_PER_DEG_LAT * Math.cos((subject.lat * Math.PI) / 180);
  return comps.map((c, i) => {
    // A comp that knows roughly where it is still goes there. Most
    // arrive blurred to a small circle around the address, which beats
    // the scatter below by a wide margin — that one only knows the
    // distance and invents the direction.
    if (typeof c.lat === "number" && typeof c.lon === "number") {
      return { ...c, lat: c.lat, lon: c.lon, placed: c.exactLocation === true };
    }
    const angle = (((hash(c.id) % 360) + i * 137.5) % 360) * (Math.PI / 180);
    return {
      ...c,
      lat: subject.lat + (c.distanceMiles / MILES_PER_DEG_LAT) * Math.cos(angle),
      lon: subject.lon + (c.distanceMiles / milesPerDegLon) * Math.sin(angle),
      placed: false as const,
    };
  });
}

/** A tight Airbnb map-view URL around one point — opens real inventory
 *  for the area in a new tab until live listing links land. */
function airbnbAreaUrl(lat: number, lon: number): string {
  const d = 0.006;
  const box = `ne_lat=${(lat + d).toFixed(4)}&ne_lng=${(lon + d).toFixed(4)}&sw_lat=${(lat - d).toFixed(4)}&sw_lng=${(lon - d).toFixed(4)}`;
  return `https://www.airbnb.com/s/homes?refinement_paths%5B%5D=%2Fhomes&search_by_map=true&${box}&zoom=15`;
}

interface CompsStreetMapProps {
  comps: StrComp[];
  subject: { lat: number; lon: number };
  subjectLabel: string;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  className?: string;
}

export function CompsStreetMap({
  comps,
  subject,
  subjectLabel,
  hoveredId,
  onHover,
  className,
}: CompsStreetMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  /** The last thing MapLibre complained about, or null once a frame
   *  has actually rendered. Named rather than counted: a blank map
   *  should say whose tiles didn't arrive. */
  const [tileError, setTileError] = React.useState<string | null>(null);

  const placed = React.useMemo(
    () => placeComps(subject, comps),
    [subject, comps]
  );
  const active = activeId ? placed.find((c) => c.id === activeId) : null;

  // Keep the latest handler reachable from marker listeners without
  // rebuilding the map.
  const onHoverRef = React.useRef(onHover);
  React.useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE,
      center: [subject.lon, subject.lat],
      zoom: 12,
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
    // Cleared by a tile that actually arrived — NOT by "idle", which
    // fires just as happily when every tile failed and there is nothing
    // left to try. Clearing on idle is why a blank map stayed silent.
    map.on("sourcedata", (event) => {
      if (event.tile && event.isSourceLoaded) setTileError(null);
    });

    // Subject pin — brand red diamond in a gold ring.
    const subjectEl = document.createElement("div");
    subjectEl.setAttribute("aria-label", subjectLabel);
    subjectEl.className =
      "flex size-7 items-center justify-center rounded-full border border-gold bg-surface/90";
    const diamond = document.createElement("span");
    diamond.className = "block size-2.5 rotate-45 bg-brand";
    subjectEl.appendChild(diamond);
    new maplibregl.Marker({ element: subjectEl })
      .setLngLat([subject.lon, subject.lat])
      .addTo(map);

    // Comp pins — nightly-rate price pills. Tagged with data-comp-id so the
    // highlight effect can find them without sharing mutable refs.
    for (const comp of placed) {
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.compId = comp.id;
      el.setAttribute(
        "aria-label",
        `${comp.name} — ${fmtMoney(comp.adr)} a night, ${fmtMiles(comp.distanceMiles)} away`
      );
      el.className =
        "cursor-pointer rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-foreground tabular transition-colors duration-150 hover:border-gold/60 hover:text-gold";
      el.style.boxShadow = "var(--elev)";
      el.textContent = fmtMoney(comp.adr);
      el.addEventListener("mouseenter", () => onHoverRef.current(comp.id));
      el.addEventListener("mouseleave", () => onHoverRef.current(null));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setActiveId((prev) => (prev === comp.id ? null : comp.id));
      });
      new maplibregl.Marker({ element: el })
        .setLngLat([comp.lon, comp.lat])
        .addTo(map);
    }

    // Frame every pin with breathing room.
    const bounds = new maplibregl.LngLatBounds(
      [subject.lon, subject.lat],
      [subject.lon, subject.lat]
    );
    for (const c of placed) bounds.extend([c.lon, c.lat]);
    map.fitBounds(bounds, { padding: 56, maxZoom: 13.5, duration: 0 });

    map.on("click", () => setActiveId(null));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [placed, subject.lat, subject.lon, subjectLabel]);

  // Table hover → pin highlight (map hover feeds back through onHover).
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const pills =
      container.querySelectorAll<HTMLButtonElement>("[data-comp-id]");
    for (const el of pills) {
      const hot = el.dataset.compId === hoveredId || el.dataset.compId === activeId;
      el.classList.toggle("border-gold/60", hot);
      el.classList.toggle("text-gold", hot);
      const wrapper = el.parentElement;
      if (wrapper) wrapper.style.zIndex = hot ? "30" : "10";
    }
  }, [hoveredId, activeId]);

  return (
    <figure className={cn("min-w-0", className)}>
      <div className="relative overflow-hidden rounded-lg border border-border bg-secondary/60">
        <div ref={containerRef} className="h-[440px] w-full" />

        {tileError ? (
          <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[min(28rem,90%)] rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[11px] text-muted-foreground">
            Street tiles unavailable ({tileError}) — pins are still placed to
            scale.
          </p>
        ) : null}

        {/* Docked listing card for the selected comp */}
        {active ? (
          <div className="absolute inset-x-3 bottom-3 z-20 flex gap-3 rounded-lg border border-border bg-card p-3">
            <PropertyThumb seed={active.id} className="h-20 w-24 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {active.name}
                </p>
                <button
                  type="button"
                  aria-label="Close listing card"
                  onClick={() => setActiveId(null)}
                  className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {active.bedrooms} bd · {fmtMoney(active.adr)} a night ·{" "}
                {fmtPct(active.occupancy)} booked ·{" "}
                {fmtMoney(annualRevenueFromAdr(active.adr, active.occupancy))}
                /yr · {fmtMiles(active.distanceMiles)} away
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <a
                  href={airbnbAreaUrl(active.lat, active.lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
                >
                  Open this area on Airbnb
                  <ArrowUpRight aria-hidden className="size-3" />
                </a>
                {active.placed ? null : (
                  <span className="text-[10px] text-muted-foreground">
                    Approximate position — the platform blurs a listing
                    until it is booked
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <figcaption className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rotate-45 bg-brand" />
          <span>Your property</span>
          <span
            aria-hidden
            className="ml-2 inline-block size-2 rounded-full bg-gold-fill"
          />
          <span>Comps priced by the night — click one to open it</span>
        </p>
        {placed.every((c) => c.placed) ? null : (
          <p>
            {placed.some((c) => c.placed)
              ? "Some pins are approximate — the platform blurs a listing's location until it is booked."
              : "Pins are approximate — the platform blurs a listing's location until it is booked."}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
