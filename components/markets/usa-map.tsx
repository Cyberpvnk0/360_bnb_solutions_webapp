"use client";

/**
 * Monochrome dark US map with market pins — the left pane of the markets
 * explorer. The only color on the map is data: gold pins where the spread
 * over breakeven is strong, muted red where it's thin, brand red for the
 * selected market.
 *
 * The us-atlas albers topology is pre-projected, so states draw with a
 * null-projection geoPath in the fixed 975×610 space. Pins project with
 * geoAlbersUsa at the matching scale/translate. Zoom and pan are viewBox
 * state; pins counter-scale so they hold a constant screen size.
 */

import * as React from "react";
import { Maximize, Minus, Plus, TriangleAlert } from "lucide-react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import statesTopo from "us-atlas/states-albers-10m.json";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { Market } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Static geometry — computed once at module load.                     */
/* ------------------------------------------------------------------ */

const topo = statesTopo as unknown as Topology<{
  states: GeometryCollection<{ name: string }>;
}>;
const STATE_FEATURES = feature(topo, topo.objects.states).features;
const drawPath = geoPath();
const STATE_PATHS = STATE_FEATURES.map((f) => ({
  name: f.properties?.name ?? "",
  d: drawPath(f) ?? "",
}));

/** Matches the pre-projected albers atlas files. */
const project = geoAlbersUsa().scale(1300).translate([487.5, 305]);

const BASE = { x: 0, y: 0, w: 975, h: 610 } as const;
const MAX_ZOOM = 8;

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampView(v: ViewBox): ViewBox {
  const w = Math.min(BASE.w, Math.max(BASE.w / MAX_ZOOM, v.w));
  const h = w * (BASE.h / BASE.w);
  const x = Math.min(BASE.x + BASE.w - w, Math.max(BASE.x, v.x));
  const y = Math.min(BASE.y + BASE.h - h, Math.max(BASE.y, v.y));
  return { x, y, w, h };
}

function zoomView(v: ViewBox, factor: number, cx: number, cy: number): ViewBox {
  const w = Math.min(BASE.w, Math.max(BASE.w / MAX_ZOOM, v.w * factor));
  const scale = w / v.w;
  return clampView({
    x: cx - (cx - v.x) * scale,
    y: cy - (cy - v.y) * scale,
    w,
    h: w * (BASE.h / BASE.w),
  });
}

/** Strong spread: market occupancy clears the 2BR breakeven by 8+ points. */
export function hasStrongSpread(m: Market): boolean {
  return m.occupancy - m.avgBreakeven2br >= 0.08;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface UsaMapProps {
  markets: Market[];
  selectedSlug: string | null;
  /** Ring a pin while its list card is hovered. */
  highlightSlug?: string | null;
  onSelect: (slug: string) => void;
  className?: string;
}

export function UsaMap({
  markets,
  selectedSlug,
  highlightSlug,
  onSelect,
  className,
}: UsaMapProps) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = React.useState<ViewBox>({ ...BASE });
  const [hoverSlug, setHoverSlug] = React.useState<string | null>(null);
  const [panning, setPanning] = React.useState(false);

  const positions = React.useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const m of markets) {
      const p = project([m.lon, m.lat]);
      if (p) map.set(m.slug, [p[0], p[1]]);
    }
    return map;
  }, [markets]);

  /** Client pixels → SVG user units (handles preserveAspectRatio). */
  const toUser = React.useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return null;
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return [p.x, p.y];
    },
    []
  );

  /* Wheel zoom needs a non-passive listener to preventDefault. */
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toUser(e.clientX, e.clientY);
      if (!at) return;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      setViewBox((v) => zoomView(v, factor, at[0], at[1]));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toUser]);

  /* When a new selection arrives (e.g. a card click) and its pin sits
   * outside the visible window, pan to it. State is adjusted during
   * render, guarded by the previous-selection comparison. */
  const [lastSelected, setLastSelected] = React.useState(selectedSlug);
  if (selectedSlug !== lastSelected) {
    setLastSelected(selectedSlug);
    const pos = selectedSlug ? positions.get(selectedSlug) : undefined;
    if (pos) {
      const mx = viewBox.w * 0.12;
      const my = viewBox.h * 0.12;
      const inside =
        pos[0] > viewBox.x + mx &&
        pos[0] < viewBox.x + viewBox.w - mx &&
        pos[1] > viewBox.y + my &&
        pos[1] < viewBox.y + viewBox.h - my;
      if (!inside) {
        setViewBox(
          clampView({
            ...viewBox,
            x: pos[0] - viewBox.w / 2,
            y: pos[1] - viewBox.h / 2,
          })
        );
      }
    }
  }

  /* Drag to pan; capture only after the threshold so pin clicks survive. */
  const dragRef = React.useRef<{
    pointerId: number;
    anchor: [number, number];
    moved: boolean;
  } | null>(null);
  const suppressClickRef = React.useRef(false);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const at = toUser(e.clientX, e.clientY);
    if (!at) return;
    dragRef.current = { pointerId: e.pointerId, anchor: at, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const at = toUser(e.clientX, e.clientY);
    if (!at) return;
    const dx = at[0] - drag.anchor[0];
    const dy = at[1] - drag.anchor[1];
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < viewBox.w * 0.006) return;
      drag.moved = true;
      setPanning(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety, not a requirement */
      }
    }
    setViewBox((v) => clampView({ ...v, x: v.x - dx, y: v.y - dy }));
  };

  const endPan = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      // Swallow the click that follows a pan.
      suppressClickRef.current = true;
      window.setTimeout(() => (suppressClickRef.current = false), 0);
    }
    setPanning(false);
  };

  const zoomButtons = (factor: number) => {
    setViewBox((v) => zoomView(v, factor, v.x + v.w / 2, v.y + v.h / 2));
  };

  /** Pin counter-scale so pins keep a constant on-screen size. */
  const k = viewBox.w / BASE.w;

  const hoverMarket = hoverSlug
    ? markets.find((m) => m.slug === hoverSlug) ?? null
    : null;
  const hoverPos = hoverMarket ? positions.get(hoverMarket.slug) : undefined;

  /* Hover label geometry, in the pin's counter-scaled space. */
  let label: {
    w: number;
    h: number;
    dx: number;
    dy: number;
    line1: string;
    line2: string;
  } | null = null;
  if (hoverMarket && hoverPos) {
    const line1 = `${hoverMarket.name}, ${hoverMarket.stateCode}`;
    const line2 = `${fmtMoney(hoverMarket.adr)} ADR · ${fmtPct(hoverMarket.occupancy)} occ`;
    const w = Math.max(line1.length * 6.6, line2.length * 5.4) + 18;
    const h = 36;
    const flipX = hoverPos[0] + (w + 14) * k > viewBox.x + viewBox.w;
    const flipY = hoverPos[1] - (h + 14) * k < viewBox.y;
    label = {
      w,
      h,
      dx: flipX ? -(w + 12) : 12,
      dy: flipY ? 12 : -(h + 12),
      line1,
      line2,
    };
  }

  const isZoomed =
    viewBox.w < BASE.w - 0.5 || viewBox.x > 0.5 || viewBox.y > 0.5;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative min-h-0 flex-1 bg-[var(--map-water)]">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className={cn(
            "h-full w-full touch-none select-none",
            panning ? "cursor-grabbing" : "cursor-grab"
          )}
          role="group"
          aria-label="United States market map"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onPointerLeave={endPan}
        >
          {/* States: monochrome land, hairline borders, no labels. */}
          <g>
            {STATE_PATHS.map((s) => (
              <path
                key={s.name}
                d={s.d}
                fill="var(--map-land)"
                stroke="var(--map-stroke)"
                strokeWidth={0.75}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Pins — the only color on the map. */}
          <g>
            {markets.map((m) => {
              const pos = positions.get(m.slug);
              if (!pos) return null;
              const selected = m.slug === selectedSlug;
              const hovered = m.slug === hoverSlug || m.slug === highlightSlug;
              const strong = hasStrongSpread(m);
              return (
                <g
                  key={m.slug}
                  transform={`translate(${pos[0]} ${pos[1]}) scale(${k})`}
                >
                  {selected ? (
                    <circle
                      r={9}
                      fill="none"
                      stroke="var(--gold)"
                      strokeWidth={1.5}
                      opacity={0.9}
                      className="animate-gold-ring"
                      pointerEvents="none"
                    />
                  ) : hovered ? (
                    <circle
                      r={9}
                      fill="none"
                      stroke="var(--gold)"
                      strokeWidth={1}
                      opacity={0.55}
                      pointerEvents="none"
                    />
                  ) : null}
                  <circle
                    r={hovered || selected ? 6.5 : 5}
                    fill={
                      selected
                        ? "var(--red)"
                        : strong
                          ? "var(--gold)"
                          : "var(--red-muted)"
                    }
                    stroke="var(--map-water)"
                    strokeWidth={1.25}
                    className="cursor-pointer transition-[r] duration-150"
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`${m.name}, ${m.stateCode} — ${fmtMoney(m.adr)} ADR, ${fmtPct(m.occupancy)} occupancy`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (suppressClickRef.current) return;
                      onSelect(m.slug);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(m.slug);
                      }
                    }}
                    onMouseEnter={() => setHoverSlug(m.slug)}
                    onMouseLeave={() =>
                      setHoverSlug((s) => (s === m.slug ? null : s))
                    }
                    onFocus={() => setHoverSlug(m.slug)}
                    onBlur={() =>
                      setHoverSlug((s) => (s === m.slug ? null : s))
                    }
                  />
                </g>
              );
            })}
          </g>

          {/* Hover label */}
          {hoverMarket && hoverPos && label ? (
            <g
              transform={`translate(${hoverPos[0]} ${hoverPos[1]}) scale(${k})`}
              pointerEvents="none"
            >
              <g transform={`translate(${label.dx} ${label.dy})`}>
                <rect
                  width={label.w}
                  height={label.h}
                  rx={2}
                  fill="var(--popover)"
                  stroke="var(--border)"
                />
                <text
                  x={9}
                  y={15}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--popover-foreground)"
                >
                  {label.line1}
                </text>
                <text x={9} y={28} fontSize={10} fill="var(--text-muted)">
                  {label.line2}
                </text>
              </g>
            </g>
          ) : null}
        </svg>

        {/* Zoom controls — hairline buttons. */}
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomButtons(0.7)}
            className="flex size-7 items-center justify-center rounded-sm border border-border bg-surface text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomButtons(1.45)}
            className="flex size-7 items-center justify-center rounded-sm border border-border bg-surface text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
          >
            <Minus aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset map view"
            onClick={() => setViewBox({ ...BASE })}
            disabled={!isZoomed}
            className="flex size-7 items-center justify-center rounded-sm border border-border bg-surface text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Maximize aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex shrink-0 items-center gap-4 border-t border-border bg-background px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-full bg-gold" />
          Strong spread — 8+ pts over breakeven
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-full bg-neg" />
          <TriangleAlert aria-hidden className="size-3 text-neg" />
          Thin spread
        </span>
        <span className="ml-auto hidden md:inline">
          Scroll to zoom · drag to pan
        </span>
      </div>
    </div>
  );
}
