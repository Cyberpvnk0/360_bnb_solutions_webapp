"use client";

/**
 * Top-down comp map: the subject property at center, each comp placed at
 * its true distance on hairline range rings. Distances come from the
 * data; bearings are seeded for the preview (and say so in the caption).
 * Monochrome map surface — the only color is data, matching the market
 * explorer: gold comps, brand red for the subject/selection.
 */

import * as React from "react";
import { fmtMoney } from "@/lib/format";
import type { StrComp } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

const SIZE = 360;
const C = SIZE / 2;
const MAX_R = C - 34;
const MIN_R = 30;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface PlacedComp extends StrComp {
  x: number;
  y: number;
}

export function CompsMap({
  comps,
  hoveredId,
  onHover,
  className,
}: {
  comps: StrComp[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  className?: string;
}) {
  const maxDistance = Math.max(...comps.map((c) => c.distanceMiles), 1);
  // Rings at whole miles up to the farthest comp.
  const ringMiles = Array.from(
    { length: Math.max(1, Math.ceil(maxDistance)) },
    (_, i) => i + 1
  ).filter((m) => m <= Math.ceil(maxDistance));

  const placed: PlacedComp[] = React.useMemo(
    () =>
      comps.map((comp, i) => {
        // Golden-angle spread keeps seeded bearings from clumping.
        const angle =
          ((hash(comp.id) % 360) + i * 137.5) % 360;
        const rad = (angle * Math.PI) / 180;
        const r =
          MIN_R + (comp.distanceMiles / maxDistance) * (MAX_R - MIN_R);
        // Fixed precision so server and client serialize identically.
        return {
          ...comp,
          x: Math.round((C + r * Math.cos(rad)) * 100) / 100,
          y: Math.round((C + r * Math.sin(rad)) * 100) / 100,
        };
      }),
    [comps, maxDistance]
  );

  return (
    <figure className={cn("min-w-0", className)}>
      <div
        className="overflow-hidden rounded-sm border border-border"
        style={{ background: "var(--map-land)" }}
      >
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="block w-full"
          role="img"
          aria-label={`Map of ${comps.length} comparable rentals within ${maxDistance.toFixed(1)} miles of the property`}
        >
          {/* Range rings — real distance, drawn to scale */}
          {ringMiles.map((mile) => {
            const r = MIN_R + (mile / maxDistance) * (MAX_R - MIN_R);
            if (r > MAX_R + 1) return null;
            return (
              <g key={mile}>
                <circle
                  cx={C}
                  cy={C}
                  r={r}
                  fill="none"
                  stroke="var(--map-stroke)"
                  strokeWidth="1"
                />
                <text
                  x={C + r * 0.7071 + 3}
                  y={C + r * 0.7071 + 9}
                  fontSize="9"
                  fill="var(--text-muted)"
                  stroke="var(--map-land)"
                  strokeWidth="3"
                  paintOrder="stroke"
                  className="tabular"
                >
                  {mile} mi
                </text>
              </g>
            );
          })}

          {/* Comp pins with nightly-rate labels */}
          {placed.map((comp) => {
            const hovered = hoveredId === comp.id;
            const labelLeft = comp.x > SIZE - 64;
            return (
              <g
                key={comp.id}
                onMouseEnter={() => onHover(comp.id)}
                onMouseLeave={() => onHover(null)}
                className="cursor-pointer"
              >
                {hovered ? (
                  <circle
                    cx={comp.x}
                    cy={comp.y}
                    r={9}
                    fill="none"
                    stroke="var(--gold-bright)"
                    strokeWidth="1.5"
                  />
                ) : null}
                <circle
                  cx={comp.x}
                  cy={comp.y}
                  r={hovered ? 5 : 4}
                  fill={hovered ? "var(--gold-bright)" : "var(--gold-fill)"}
                  style={{ transition: "r 150ms" }}
                />
                <text
                  x={labelLeft ? comp.x - 8 : comp.x + 8}
                  y={comp.y + 3.5}
                  fontSize="10"
                  textAnchor={labelLeft ? "end" : "start"}
                  fill={hovered ? "var(--text)" : "var(--text-muted)"}
                  stroke="var(--map-land)"
                  strokeWidth="3"
                  paintOrder="stroke"
                  className="tabular"
                  style={{ fontWeight: hovered ? 600 : 400 }}
                >
                  {fmtMoney(comp.adr)}
                </text>
              </g>
            );
          })}

          {/* Subject property — brand red diamond with gold ring */}
          <g>
            <circle
              cx={C}
              cy={C}
              r={11}
              fill="none"
              stroke="var(--gold)"
              strokeWidth="1"
            />
            <rect
              x={C - 5}
              y={C - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${C} ${C})`}
              fill="var(--red)"
            />
          </g>
        </svg>
      </div>
      <figcaption className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rotate-45 bg-brand" />
          <span>Your property</span>
          <span aria-hidden className="ml-2 inline-block size-2 rounded-full bg-gold-fill" />
          <span>Comps, labeled by nightly rate</span>
        </p>
        <p>Distances exact; bearings approximate in preview.</p>
      </figcaption>
    </figure>
  );
}
