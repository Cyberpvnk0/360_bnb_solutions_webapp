"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface BreakevenGaugeProps {
  /** Breakeven occupancy, fraction 0–1 (may exceed 1 on bad deals). */
  breakeven: number;
  /** The market's actual occupancy, fraction 0–1. Rendered as a tick. */
  marketOccupancy: number;
  /** Outer size in px. */
  size?: number;
  strokeWidth?: number;
  /** Center content — usually the big serif figure. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The product's hero visual: a thin circular gauge.
 *
 * - Gold arc: the property's breakeven occupancy.
 * - Muted grey tick: the market's actual occupancy.
 * - The gap between them is the margin of safety.
 *
 * The arc turns muted red (with the tick now sitting inside the arc) when
 * breakeven meets or exceeds what the market actually runs — the deal
 * doesn't clear its costs. Never a letter grade, never a score.
 */
export function BreakevenGauge({
  breakeven,
  marketOccupancy,
  size = 240,
  strokeWidth = 5,
  children,
  className,
}: BreakevenGaugeProps) {
  const margin = marketOccupancy - breakeven;
  // "Comfortably below" = at least 2 occupancy points of headroom.
  const comfortable = margin >= 0.02;
  const arcColor = comfortable ? "var(--gold)" : "var(--red-muted)";

  const r = (size - strokeWidth * 2 - 8) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const frac = Number.isFinite(breakeven)
    ? Math.min(Math.max(breakeven, 0), 1)
    : 1;

  // Tick marking the market's actual occupancy, from 12 o'clock clockwise.
  const tickAngle = Math.min(Math.max(marketOccupancy, 0), 1) * 2 * Math.PI;
  const tickInner = r - strokeWidth - 3;
  const tickOuter = r + strokeWidth + 3;
  const tx1 = c + tickInner * Math.sin(tickAngle);
  const ty1 = c - tickInner * Math.cos(tickAngle);
  const tx2 = c + tickOuter * Math.sin(tickAngle);
  const ty2 = c - tickOuter * Math.cos(tickAngle);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        Number.isFinite(breakeven)
          ? `Breakeven occupancy ${Math.round(breakeven * 100)} percent; market occupancy ${Math.round(marketOccupancy * 100)} percent`
          : `This deal never breaks even at these costs; market occupancy ${Math.round(marketOccupancy * 100)} percent`
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {/* Track */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
        {/* Breakeven arc, from 12 o'clock clockwise */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? circumference * (1 - frac) : circumference}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1), stroke 150ms" }}
        />
        {/* Market occupancy tick */}
        <line
          x1={tx1}
          y1={ty1}
          x2={tx2}
          y2={ty2}
          stroke="var(--text-muted)"
          strokeWidth={2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
