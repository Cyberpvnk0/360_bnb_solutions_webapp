"use client";

/**
 * Admin charts: tier distribution donut and trailing-12-month pull volume.
 * Palette-only colors per the chart kit — gold primary, grey comparison,
 * muted red for the outlier slice.
 */

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { TIERS, TIER_ORDER, type TierId } from "@/config/app";
import { fmtMonth, fmtNum } from "@/lib/format";
import type { AdminMetrics } from "@/lib/mock/types";
import {
  AXIS_PROPS,
  CHART,
  ChartLegend,
  GRID_PROPS,
  makeTooltip,
} from "@/components/charts/kit";

/** Recharts' Tooltip content prop is typed wider than the kit's tooltip
 *  renderer; adapt without loosening the kit types. */
function asTooltipContent(
  render: (props: TooltipContentProps<number, string>) => React.ReactNode
) {
  return function TooltipContent(props: unknown) {
    return render(props as TooltipContentProps<number, string>);
  };
}

/** Slice color per tier, in TIER_ORDER. Starter is the gold fill knocked
 *  back to 45% so the paying ladder reads free → starter → pro. */
const TIER_SLICE: Record<TierId, { fill: string; fillOpacity: number; legend: string }> = {
  free: {
    fill: "var(--chart-comparison)",
    fillOpacity: 1,
    legend: "var(--chart-comparison)",
  },
  starter: {
    fill: "var(--gold-fill)",
    fillOpacity: 0.45,
    legend: "color-mix(in srgb, var(--gold-fill) 45%, transparent)",
  },
  pro: { fill: "var(--gold-fill)", fillOpacity: 1, legend: "var(--gold-fill)" },
  scale: {
    fill: "var(--red-muted)",
    fillOpacity: 1,
    legend: "var(--red-muted)",
  },
};

export function TierDonut({
  tierCounts,
}: {
  tierCounts: AdminMetrics["tierCounts"];
}) {
  const data = TIER_ORDER.map((tierId) => {
    const entry = tierCounts.find((t) => t.tier === tierId);
    return {
      tier: tierId,
      name: TIERS[tierId].name,
      count: entry?.count ?? 0,
    };
  });
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <div className="relative h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell
                  key={d.tier}
                  fill={TIER_SLICE[d.tier].fill}
                  fillOpacity={TIER_SLICE[d.tier].fillOpacity}
                />
              ))}
            </Pie>
            <Tooltip
              content={asTooltipContent(makeTooltip((v) => fmtNum(v)))}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight text-foreground tabular">
            {fmtNum(total)}
          </span>
          <span className="metric-label">Accounts</span>
        </div>
      </div>
      <ChartLegend
        className="mt-3 justify-center"
        items={data.map((d) => ({
          label: d.name,
          color: TIER_SLICE[d.tier].legend,
        }))}
      />
    </div>
  );
}

export function PullVolumeChart({
  pullVolume,
}: {
  pullVolume: AdminMetrics["pullVolume"];
}) {
  return (
    <div className="h-[268px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={pullVolume}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="month" {...AXIS_PROPS} tickFormatter={fmtMonth} />
          <YAxis {...AXIS_PROPS} tickFormatter={fmtNum} width={48} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", fillOpacity: 0.5 }}
            content={asTooltipContent(
              makeTooltip(
                (v) => fmtNum(v),
                (label) => fmtMonth(String(label))
              )
            )}
          />
          <Bar
            dataKey="pulls"
            name="Pulls"
            fill={CHART.primary}
            barSize={20}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
