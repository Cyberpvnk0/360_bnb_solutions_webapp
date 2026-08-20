"use client";

/**
 * /markets/[slug] — one market, underwritten. Fat stat band up top,
 * seasonality / ADR-by-bedroom / occupancy-vs-breakeven charts below,
 * then the regulation ruling and the "how a 2 bd pencils" strip.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Eye,
  TriangleAlert,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { toast } from "sonner";
import { NIGHTS_PER_MONTH, revpar } from "@/lib/calc/arbitrage";
import {
  fmtDeltaPct,
  fmtDeltaPts,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtMonth,
} from "@/lib/format";
import type { Market } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { DeltaIndicator } from "@/components/primitives/delta-indicator";
import { MetricLabel } from "@/components/primitives/metric-label";
import { PageHeader } from "@/components/primitives/page-header";
import { StatCard, StatHeader } from "@/components/primitives/stat-card";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import {
  AXIS_PROPS,
  CHART,
  ChartLegend,
  ChartTooltipCard,
  GRID_PROPS,
  makeTooltip,
} from "@/components/charts/kit";
import { REGULATION_LABEL, REGULATION_TONE } from "./market-card";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function ChartCard({
  title,
  sub,
  aside,
  children,
}: {
  title: string;
  sub?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-sm border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
        <div>
          <MetricLabel>{title}</MetricLabel>
          {sub ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        {aside}
      </div>
      <div className="px-2 pb-3 pt-4">{children}</div>
    </section>
  );
}

function DeltaSub({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <DeltaIndicator value={value} label={label} />
      <span className="text-[11px] text-muted-foreground">vs last month</span>
    </span>
  );
}

function AdrByBedroomTooltip({
  active,
  payload,
}: TooltipContentProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload as {
    label: string;
    adr: number;
    listings: number;
  };
  return (
    <ChartTooltipCard
      title={row.label}
      rows={[
        { name: "ADR", value: fmtMoney(row.adr), color: CHART.primary },
        { name: "Active listings", value: fmtNum(row.listings) },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MarketDetail({ market: m }: { market: Market }) {
  const { watchedMarketSlugs, toggleWatchMarket, ready } = useSession();
  const watching = watchedMarketSlugs.includes(m.slug);

  const margin = m.occupancy - m.avgBreakeven2br;
  const marginPts = Math.round(margin * 100);

  const last = m.monthly[m.monthly.length - 1];
  const prev = m.monthly[m.monthly.length - 2];
  const revparNow = revpar(last.adr, last.occupancy);
  const revparPrev = revpar(prev.adr, prev.occupancy);
  const revparDelta = revparPrev > 0 ? (revparNow - revparPrev) / revparPrev : 0;

  const seasonality = React.useMemo(
    () =>
      m.monthly.map((mo) => ({
        month: mo.month,
        revenue: revpar(mo.adr, mo.occupancy) * NIGHTS_PER_MONTH,
      })),
    [m.monthly]
  );

  const bedrooms = React.useMemo(
    () =>
      m.adrByBedroom.map((b) => ({
        label: `${b.bedrooms} bd`,
        adr: b.adr,
        listings: b.listings,
      })),
    [m.adrByBedroom]
  );

  const occupancyTrend = React.useMemo(
    () =>
      m.monthly.map((mo) => ({
        month: mo.month,
        occupancy: mo.occupancy,
        breakeven: m.avgBreakeven2br,
      })),
    [m.monthly, m.avgBreakeven2br]
  );

  const occFloor = Math.max(
    0.2,
    Math.min(0.3, Math.floor((m.avgBreakeven2br - 0.03) * 20) / 20)
  );

  const handleWatch = () => {
    toggleWatchMarket(m.slug);
    if (watching) {
      toast(`Stopped watching ${m.name}`, {
        description: "It comes off your dashboard watchlist.",
      });
    } else {
      toast.success(`Watching ${m.name}`, {
        description: "Monthly moves will surface on your dashboard.",
      });
    }
  };

  const banned = m.regulation.status === "banned";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <Link
        href="/markets"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3" />
        All markets
      </Link>

      <PageHeader
        className="mt-3"
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {m.name}
            <StatusChip tone={REGULATION_TONE[m.regulation.status]}>
              {REGULATION_LABEL[m.regulation.status]}
            </StatusChip>
          </span>
        }
        description={`${m.state} · ${fmtNum(m.activeListings)} active short-term rentals`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleWatch}
              disabled={!ready}
              className="gap-1.5"
            >
              {watching ? (
                <>
                  <Check aria-hidden className="size-4 text-gold" />
                  Watching
                </>
              ) : (
                <>
                  <Eye aria-hidden className="size-4" />
                  Watch market
                </>
              )}
            </Button>
            <Button asChild className="gap-1.5">
              <Link href="/analyze">
                Analyze a property in {m.name}
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
            </Button>
          </>
        }
      />

      {/* Stat band */}
      <StatHeader className="mt-6">
        <StatCard
          label="ADR"
          value={fmtMoney(m.adr)}
          sub={<DeltaSub value={m.deltas.adr} label={fmtDeltaPct(m.deltas.adr)} />}
        />
        <StatCard
          label="Occupancy"
          value={fmtPct(m.occupancy)}
          sub={
            <DeltaSub
              value={m.deltas.occupancy}
              label={fmtDeltaPts(m.deltas.occupancy)}
            />
          }
        />
        <StatCard
          label="RevPAR"
          value={fmtMoney(revpar(m.adr, m.occupancy))}
          sub={<DeltaSub value={revparDelta} label={fmtDeltaPct(revparDelta)} />}
        />
        <StatCard
          label="Active listings"
          value={fmtNum(m.activeListings)}
          sub={
            <DeltaSub
              value={m.deltas.listings}
              label={fmtDeltaPct(m.deltas.listings)}
            />
          }
        />
        <StatCard
          label="Avg 2BR breakeven"
          value={fmtPct(m.avgBreakeven2br)}
          sub={
            <span className="text-[11px] text-muted-foreground">
              at median rent
            </span>
          }
        />
        <StatCard
          label="Median 2BR rent"
          value={fmtMoney(m.medianRent2br)}
          sub={
            <span className="text-[11px] text-muted-foreground">
              asking, long-term lease
            </span>
          }
        />
      </StatHeader>

      {/* Charts */}
      <div className="mt-6 space-y-6">
        <ChartCard
          title="Monthly revenue per listing"
          sub="RevPAR × 30.4 nights for the 2BR benchmark, trailing 12 months."
        >
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={seasonality}
              margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
            >
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="month"
                {...AXIS_PROPS}
                tickFormatter={(v) => fmtMonth(String(v))}
                minTickGap={28}
              />
              <YAxis
                {...AXIS_PROPS}
                tickFormatter={(v) => fmtMoney(Number(v))}
                width={56}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                content={makeTooltip(
                  (v) => fmtMoney(v),
                  (label) => fmtMonth(String(label))
                )}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue per listing"
                stroke={CHART.primary}
                strokeWidth={2}
                fill={CHART.areaFill}
                fillOpacity={CHART.areaFillOpacity}
                activeDot={{ r: 3.5, strokeWidth: 0, fill: CHART.primary }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="ADR by bedroom count"
            sub="What each unit size commands per booked night."
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={bedrooms}
                margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
              >
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis
                  {...AXIS_PROPS}
                  tickFormatter={(v) => fmtMoney(Number(v))}
                  width={52}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)", opacity: 0.5 }}
                  content={AdrByBedroomTooltip}
                />
                <Bar
                  dataKey="adr"
                  name="ADR"
                  fill={CHART.primary}
                  barSize={28}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Occupancy vs 2BR breakeven"
            sub="The visible gap is the margin of safety."
            aside={
              <ChartLegend
                items={[
                  { label: "Occupancy", color: CHART.primary },
                  {
                    label: "2BR breakeven",
                    color: CHART.comparison,
                    dashed: true,
                  },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={occupancyTrend}
                margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
              >
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  dataKey="month"
                  {...AXIS_PROPS}
                  tickFormatter={(v) => fmtMonth(String(v))}
                  minTickGap={28}
                />
                <YAxis
                  {...AXIS_PROPS}
                  domain={[occFloor, 0.9]}
                  tickFormatter={(v) => fmtPct(Number(v))}
                  width={44}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={makeTooltip(
                    (v) => fmtPct(v, 1),
                    (label) => fmtMonth(String(label))
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="occupancy"
                  name="Occupancy"
                  stroke={CHART.primary}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0, fill: CHART.primary }}
                />
                <Line
                  type="monotone"
                  dataKey="breakeven"
                  name="2BR breakeven"
                  stroke={CHART.comparison}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* Regulation + how a 2 bd pencils */}
      <div className="mt-6 grid gap-6 pb-10 lg:grid-cols-2">
        <section className="rounded-sm border border-border bg-card p-5">
          <MetricLabel>Regulation</MetricLabel>
          <div className="mt-3 flex items-center gap-3">
            <StatusChip tone={REGULATION_TONE[m.regulation.status]}>
              {REGULATION_LABEL[m.regulation.status]}
            </StatusChip>
            <span className="text-sm font-semibold text-foreground">
              {REGULATION_LABEL[m.regulation.status]} for short-term rentals
            </span>
          </div>
          {m.regulation.note ? (
            <p className="mt-3 text-sm leading-relaxed text-foreground">
              {m.regulation.note}
            </p>
          ) : null}
          {banned ? (
            <p className="mt-3 flex items-start gap-1.5 text-sm text-neg">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Arbitrage operators are effectively excluded here.
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Source: {m.regulation.sourceNote}
          </p>
        </section>

        <section className="rounded-sm border border-border bg-card p-5">
          <MetricLabel>How a 2 bd pencils here</MetricLabel>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
            {[
              { label: "Median rent", value: fmtMoney(m.medianRent2br) },
              { label: "ADR", value: fmtMoney(m.adr) },
              { label: "Breakeven", value: fmtPct(m.avgBreakeven2br) },
            ].map((f) => (
              <div key={f.label} className="bg-card px-3 py-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {f.label}
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular">
                  {f.value}
                </div>
              </div>
            ))}
            <div className="bg-card px-3 py-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Margin
              </div>
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-lg font-semibold tabular",
                  margin >= 0 ? "text-gold" : "text-neg"
                )}
              >
                {margin < 0 ? (
                  <TriangleAlert aria-hidden className="size-4 shrink-0" />
                ) : null}
                {fmtDeltaPts(margin, 0)}
              </div>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            At the {fmtMoney(m.medianRent2br)} median rent, a typical 2 bd here
            breaks even at{" "}
            <span className="font-medium text-foreground tabular">
              {fmtPct(m.avgBreakeven2br)}
            </span>{" "}
            occupancy. The market runs{" "}
            <span className="font-medium text-foreground tabular">
              {fmtPct(m.occupancy)}
            </span>
            {" — "}
            {margin >= 0
              ? `${marginPts} points of headroom before a lease stops covering itself.`
              : `${Math.abs(marginPts)} points short of covering a typical lease.`}
          </p>
        </section>
      </div>
    </div>
  );
}
