"use client";

/**
 * /markets/[slug] — one market, underwritten. AirDNA-style hero card up
 * top: terrain banner with the margin badge and watch toggle, identity +
 * primary CTA, then the headline trailing-12 figures. Below: seasonality /
 * ADR-by-bedroom / occupancy-vs-breakeven charts, the submarket spread
 * table, and the "how a 2 bd pencils" card.
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
import {
  annualRevenueFromAdr,
  NIGHTS_PER_MONTH,
  revpar,
} from "@/lib/calc/arbitrage";
import {
  fmtDeltaPct,
  fmtDeltaPts,
  fmtMoney,
  fmtMoneyShort,
  fmtNum,
  fmtPct,
  fmtMonth,
} from "@/lib/format";
import type { Market, Submarket } from "@/lib/mock/types";
import type { MarketStats } from "@/lib/live/market-stats";
import { useSession } from "@/components/providers/session-provider";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/primitives/data-table";
import { DeltaIndicator } from "@/components/primitives/delta-indicator";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import {
  AXIS_PROPS,
  CHART,
  ChartLegend,
  ChartTooltipCard,
  GRID_PROPS,
  makeTooltip,
} from "@/components/charts/kit";
import { MarketBanner, TERRAIN_LABEL } from "./market-banner";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Recharts' Tooltip content prop is typed wider than the kit's tooltip
 *  renderer; adapt without loosening the kit types. */
function asTooltipContent(
  render: (props: TooltipContentProps<number, string>) => React.ReactNode
) {
  return function TooltipContent(props: unknown) {
    return render(props as TooltipContentProps<number, string>);
  };
}

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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {sub ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        {aside}
      </div>
      <div className="px-3 pb-4 pt-5">{children}</div>
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
/* Submarkets table                                                    */
/* ------------------------------------------------------------------ */

/** Points of cushion between what a submarket runs and its 2 bd breakeven. */
function cushionPts(s: Submarket): number {
  return Math.round((s.occupancy - s.avgBreakeven2br) * 100);
}

const SUBMARKET_COLUMNS: DataTableColumn<Submarket>[] = [
  {
    key: "name",
    header: "Submarket",
    cell: (s) => <span className="font-medium text-foreground">{s.name}</span>,
    sortValue: (s) => s.name,
    className: "pl-6",
  },
  {
    key: "listings",
    header: "Listings",
    align: "right",
    cell: (s) => fmtNum(s.activeListings),
    sortValue: (s) => s.activeListings,
  },
  {
    key: "adr",
    header: "Nightly rate",
    align: "right",
    cell: (s) => fmtMoney(s.adr),
    sortValue: (s) => s.adr,
  },
  {
    key: "occupancy",
    header: "Occupancy",
    align: "right",
    cell: (s) => fmtPct(s.occupancy),
    sortValue: (s) => s.occupancy,
  },
  {
    key: "revenue",
    header: "Revenue potential",
    align: "right",
    cell: (s) => fmtMoneyShort(annualRevenueFromAdr(s.adr, s.occupancy)),
    sortValue: (s) => annualRevenueFromAdr(s.adr, s.occupancy),
  },
  {
    key: "breakeven",
    header: "Breakeven",
    align: "right",
    cell: (s) => fmtPct(s.avgBreakeven2br),
    sortValue: (s) => s.avgBreakeven2br,
  },
  {
    key: "cushion",
    header: "Cushion",
    align: "right",
    cell: (s) => {
      const pts = cushionPts(s);
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            pts < 0 ? "text-neg" : pts >= 8 ? "text-gold" : "text-foreground"
          )}
        >
          {pts < 0 ? (
            <TriangleAlert aria-hidden className="size-3 shrink-0" />
          ) : (
            "+"
          )}
          {Math.abs(pts)} pts
        </span>
      );
    },
    sortValue: cushionPts,
    className: "pr-6",
  },
];

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MarketDetail({
  market: m,
  submarkets,
  live = null,
}: {
  market: Market;
  submarkets: Submarket[];
  /** Measured figures for this market, when the feed had them. */
  live?: MarketStats | null;
}) {
  const { watchedMarketSlugs, toggleWatchMarket, ready } = useSession();
  const watching = watchedMarketSlugs.includes(m.slug);

  /**
   * Measured where we have it, seeded where we don't — and never a
   * blend inside one figure.
   *
   * The store only keeps a summary that carries both a rate and an
   * occupancy, so these move together: either the headline row is real
   * or it is the seeded model, and the row says which.
   */
  const measured = live?.stats.adr != null && live.stats.occupancy != null;
  const adr = measured ? live!.stats.adr! : m.adr;
  const occupancy = measured ? live!.stats.occupancy! : m.occupancy;
  const activeListings = measured && live!.stats.activeListings != null
    ? Math.round(live!.stats.activeListings)
    : m.activeListings;
  const revparValue = measured && live!.stats.revpar != null
    ? live!.stats.revpar
    : revpar(adr, occupancy);
  const annualRevenue = measured && live!.stats.revenue != null
    ? live!.stats.revenue
    : annualRevenueFromAdr(adr, occupancy);

  // The cushion is the point of the page, so it reads against whichever
  // occupancy is real.
  const margin = occupancy - m.avgBreakeven2br;
  const marginPts = Math.round(margin * 100);
  const strong = marginPts >= 8;

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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <Link
        href="/markets"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3" />
        All markets
      </Link>

      {/* Hero card */}
      <section className="mt-4 overflow-hidden rounded-sm border border-border bg-card">
        {/* Banner with badge + watch toggle */}
        <div className="relative">
          <MarketBanner slug={m.slug} terrain={m.terrain} className="h-28 w-full" />
          <button
            type="button"
            aria-label={watching ? `Stop watching ${m.name}` : `Watch ${m.name}`}
            aria-pressed={watching}
            disabled={!ready}
            onClick={handleWatch}
            className={cn(
              "absolute right-4 top-4 inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-xs font-medium transition-colors duration-150",
              watching
                ? "border-gold/50 bg-background/85 text-foreground"
                : "border-border bg-background/70 text-muted-foreground hover:border-gold/40 hover:text-foreground"
            )}
          >
            {watching ? (
              <Check aria-hidden className="size-4 text-gold" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
            {watching ? "Watching" : "Watch market"}
          </button>

          {/* Margin-of-safety badge — points of cushion, not a score. */}
          <div
            aria-label={`${marginPts} points of cushion between market occupancy and the 2 bd breakeven`}
            className={cn(
              "absolute -bottom-6 left-6 flex size-14 flex-col items-center justify-center rounded-full border bg-surface",
              marginPts < 0
                ? "border-neg/50"
                : strong
                  ? "border-gold/50"
                  : "border-border"
            )}
          >
            <span
              className={cn(
                "flex items-center text-base font-semibold leading-none tabular",
                marginPts < 0 ? "text-neg" : strong ? "text-gold" : "text-foreground"
              )}
            >
              {marginPts < 0 ? (
                <TriangleAlert aria-hidden className="mr-0.5 size-3" />
              ) : (
                "+"
              )}
              {Math.abs(marginPts)}
            </span>
            <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              pts
            </span>
          </div>
        </div>

        {/* Identity + primary CTA */}
        <div className="flex flex-col gap-4 p-6 pt-8 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-medium tracking-tight text-foreground md:text-3xl">
              {m.name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {m.state} · {TERRAIN_LABEL[m.terrain]} ·{" "}
              {fmtNum(activeListings)} active rentals
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild className="gap-1.5">
              <Link href="/analyze">
                Analyze a property in {m.name}
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Headline figures. When these are measured the row says so,
            with the feed's own granularity and the time it was read —
            never dressed up as this moment. */}
        {measured ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-6 pt-4 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
              Measured
            </span>
            {live?.stats.fullName ? <span>· {live.stats.fullName}</span> : null}
            <span>· read {new Date(live!.asOf).toLocaleDateString()}</span>
          </div>
        ) : null}
        <div className="overflow-x-auto border-t border-border">
          <div className="flex min-w-max items-stretch divide-x divide-border">
            <div className="px-6 py-5">
              <MetricLabel>Revenue potential</MetricLabel>
              <div className="mt-1.5 font-display text-3xl font-medium leading-tight tracking-tight text-foreground">
                {fmtMoneyShort(annualRevenue)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                per listing, trailing 12 months
              </p>
            </div>
            <div className="px-6 py-5">
              <MetricLabel>Occupancy</MetricLabel>
              <div className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight text-foreground tabular">
                {fmtPct(occupancy)}
              </div>
              {/* A seeded month-over-month delta beside a measured
                  figure would read as measured too. There is no live
                  delta, so there is no delta. */}
              {measured ? null : (
                <div className="mt-1">
                  <DeltaSub
                    value={m.deltas.occupancy}
                    label={fmtDeltaPts(m.deltas.occupancy)}
                  />
                </div>
              )}
            </div>
            <div className="px-6 py-5">
              <MetricLabel>Nightly rate</MetricLabel>
              <div className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight text-foreground tabular">
                {fmtMoney(adr)}
              </div>
              {measured ? null : (
                <div className="mt-1">
                  <DeltaSub value={m.deltas.adr} label={fmtDeltaPct(m.deltas.adr)} />
                </div>
              )}
            </div>
            <div className="px-6 py-5">
              <MetricLabel>RevPAR</MetricLabel>
              <div className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight text-foreground tabular">
                {fmtMoney(revparValue)}
              </div>
              {measured ? null : (
                <div className="mt-1">
                  <DeltaSub value={revparDelta} label={fmtDeltaPct(revparDelta)} />
                </div>
              )}
            </div>
            <div className="px-6 py-5">
              <MetricLabel>2 bd breakeven</MetricLabel>
              <div className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight text-foreground tabular">
                {fmtPct(m.avgBreakeven2br)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                at {fmtMoney(m.medianRent2br)} median rent
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Charts */}
      <div className="mt-8 space-y-8">
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
                content={asTooltipContent(
                  makeTooltip(
                    (v) => fmtMoney(v),
                    (label) => fmtMonth(String(label))
                  )
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

        <div className="grid gap-8 lg:grid-cols-2">
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
                  cursor={{ fill: "var(--surface-2)", fillOpacity: 0.5 }}
                  content={asTooltipContent(AdrByBedroomTooltip)}
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
                  content={asTooltipContent(
                    makeTooltip(
                      (v) => fmtPct(v, 1),
                      (label) => fmtMonth(String(label))
                    )
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

      {/* Submarkets */}
      <section className="mt-8 overflow-hidden rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Submarkets — {submarkets.length} areas inside {m.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Neighborhood-level spreads within this market.
          </p>
        </div>
        <DataTable
          columns={SUBMARKET_COLUMNS}
          rows={submarkets}
          rowKey={(s) => s.id}
          initialSort={{ key: "cushion", dir: "desc" }}
        />
      </section>

      {/* How a 2 bd pencils */}
      <div className="mt-8 pb-10">
        <section className="rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold text-foreground">
              How a 2 bd pencils here
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The benchmark unit at the median lease and typical costs.
            </p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
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
          </div>
        </section>
      </div>
    </div>
  );
}
