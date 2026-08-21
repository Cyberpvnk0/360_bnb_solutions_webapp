"use client";

/**
 * Shared chart conventions so every chart in the product reads as one
 * system: hairline strokes, tabular muted axis labels, gold primary
 * series, recessive grey comparison series (dashed where it's a line, so
 * identity never rides on color alone), no gradient fills except the 8%
 * gold wash under the primary area chart.
 */

import type { TooltipContentProps } from "recharts";
import { cn } from "@/lib/utils";

export const CHART = {
  primary: "var(--chart-primary)",
  comparison: "var(--chart-comparison)",
  negative: "var(--chart-neg)",
  grid: "var(--border)",
  axisText: "var(--text-muted)",
  /** The one permitted underfill, 8% gold beneath the primary area. */
  areaFill: "var(--gold-fill)",
  areaFillOpacity: 0.08,
} as const;

/** Spread into <XAxis>/<YAxis> for consistent, quiet axes. */
export const AXIS_PROPS = {
  tick: { fill: "var(--text-muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

export const GRID_PROPS = {
  stroke: "var(--border)",
  strokeDasharray: "0",
  vertical: false,
} as const;

interface ChartTooltipRow {
  name: string;
  value: string;
  color?: string;
}

/** Hairline-bordered tooltip card used by all charts. */
export function ChartTooltipCard({
  title,
  rows,
}: {
  title?: React.ReactNode;
  rows: ChartTooltipRow[];
}) {
  return (
    <div className="rounded-sm border border-border bg-popover px-3 py-2">
      {title ? <div className="metric-label mb-1.5">{title}</div> : null}
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.color ? (
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{ background: row.color }}
                />
              ) : null}
              {row.name}
            </span>
            <span className="ml-auto font-medium text-foreground tabular">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Generic Recharts tooltip content. Pass `format` to control value text;
 * labels come through as-is. The loose parameter typing keeps the result
 * assignable to Recharts 3's `Tooltip content` prop.
 */
export function makeTooltip(
  format: (value: number, seriesKey: string) => string,
  titleFormat?: (label: string | number) => React.ReactNode
) {
  return function ChartTooltip({
    active,
    payload,
    label,
  }: Partial<TooltipContentProps<number, string>>) {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <ChartTooltipCard
        title={titleFormat ? titleFormat(label as string | number) : String(label ?? "")}
        rows={payload.map((p) => ({
          name: String(p.name),
          value: format(Number(p.value), String(p.dataKey)),
          color: p.color,
        }))}
      />
    );
  };
}

/** Inline legend: colored marks beside muted text labels. */
export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {item.dashed ? (
            <svg aria-hidden width="14" height="2" className="shrink-0">
              <line
                x1="0"
                y1="1"
                x2="14"
                y2="1"
                stroke={item.color}
                strokeWidth="2"
                strokeDasharray="3 2"
              />
            </svg>
          ) : (
            <span
              aria-hidden
              className="inline-block h-0.5 w-3.5 shrink-0"
              style={{ background: item.color }}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}
