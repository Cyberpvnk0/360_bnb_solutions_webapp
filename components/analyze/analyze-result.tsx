"use client";

/**
 * THE CORE SCREEN — an address turned into an underwriting decision.
 *
 * Hero card: property identity, then the figures investors scan first —
 * projected annual revenue, occupancy, ADR — with breakeven occupancy as
 * a compact fourth module (important, deliberately not the centerpiece)
 * and the comp revenue range beneath. Below: a dumb-simple calculator
 * with an Advanced disclosure, the live projection, hover-synced comps
 * table + map, and the lease evidence.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  FileDown,
  FolderPlus,
  MoveDownRight,
  MoveUpRight,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { projectDeal, revpar, type DealInputs } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { fmtDate, fmtMoney, fmtMonths, fmtPct } from "@/lib/format";
import type { Analysis } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { AnimatedNumber } from "@/components/primitives/animated-number";
import { BreakevenGauge } from "@/components/primitives/breakeven-gauge";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { CalculatorInputs } from "./calculator-inputs";
import { CompsExplorer } from "./comps-explorer";
import { LtrCompsTable } from "./comps-tables";
import { PropertyThumb } from "./property-thumb";
import { RevenueRange } from "./revenue-range";
import { cn } from "@/lib/utils";

const PROPERTY_TYPE_LABEL: Record<Analysis["propertyType"], string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhome: "Townhome",
};

function OutputTile({
  label,
  children,
  sub,
  tone,
  className,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "gold" | "neg";
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-6", className)}>
      <MetricLabel>{label}</MetricLabel>
      <div
        className={cn(
          "mt-2 flex items-center gap-1 text-[1.375rem] font-semibold leading-tight tracking-tight tabular",
          tone === "gold" && "text-gold",
          tone === "neg" && "text-neg",
          !tone && "text-foreground"
        )}
      >
        {tone === "neg" ? (
          <MoveDownRight aria-hidden className="size-3.5 shrink-0" />
        ) : null}
        {children}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

export function AnalyzeResult({ analysis }: { analysis: Analysis }) {
  const { saveDeal, isAnalysisSaved, openUpgrade, tier } = useSession();
  const [inputs, setInputs] = React.useState<DealInputs>(analysis.defaults);

  const assumptions = React.useMemo(
    () => deriveMarketAssumptions(analysis.strComps),
    [analysis.strComps]
  );
  const p = React.useMemo(
    () => projectDeal(inputs, assumptions),
    [inputs, assumptions]
  );

  const saved = isAnalysisSaved(analysis.id);
  const neverBreaksEven = !Number.isFinite(p.breakevenOccupancy);
  const comfortable = p.marginOfSafety >= 0.02;
  const marginPts = Math.round(p.marginOfSafety * 100);
  const sleeps = analysis.bedrooms * 2 + 2;
  // Annual figures display as rounded-monthly × 12 so a reader who
  // multiplies the two on-screen numbers gets an exact match.
  const annualRevenueDisplay = Math.round(p.monthlyRevenue) * 12;
  const annualProfitDisplay = Math.round(p.netCashFlow) * 12;

  const handleSave = () => {
    // Save the scenario on screen — the user's edited inputs, not the
    // comp defaults they may have already negotiated away from.
    const result = saveDeal(analysis, inputs);
    if (result.ok) {
      toast.success("Saved to pipeline", {
        description: `${analysis.address} is now in Prospecting.`,
      });
    } else if (result.reason === "duplicate") {
      toast("Already in your pipeline", {
        description: "This address is saved — find it under Prospecting.",
      });
    } else {
      openUpgrade({ reason: "deals" });
    }
  };

  const handleExport = () => {
    if (tier.pdfExport) {
      toast.success("Landlord packet exported", {
        description:
          "A lender-style PDF of this analysis. Download is stubbed in this preview.",
      });
    } else {
      openUpgrade({ reason: "generic" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Hero card */}
      <section className="overflow-hidden rounded-sm border border-border bg-card">
        {/* Identity + actions */}
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
          <PropertyThumb
            seed={analysis.id}
            className="h-28 w-full max-w-44 shrink-0 md:h-[104px] md:w-[152px]"
          />
          <div className="min-w-0 flex-1">
            <MetricLabel>
              Address pull · {fmtDate(analysis.createdAt)}
            </MetricLabel>
            <h1 className="mt-1 truncate font-display text-2xl font-medium tracking-tight text-foreground md:text-3xl">
              {analysis.address}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {analysis.city}, {analysis.stateCode} ·{" "}
              <Link
                href={`/markets/${analysis.marketSlug}`}
                className="inline-flex items-center gap-0.5 text-gold transition-colors duration-150 hover:text-gold-bright"
              >
                View market
                <ArrowUpRight aria-hidden className="size-3" />
              </Link>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <StatusChip tone="outline">{analysis.bedrooms} bd</StatusChip>
              <StatusChip tone="outline">{analysis.bathrooms} ba</StatusChip>
              <StatusChip tone="outline">Sleeps {sleeps}</StatusChip>
              <StatusChip tone="outline">
                {PROPERTY_TYPE_LABEL[analysis.propertyType]}
              </StatusChip>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={handleExport} className="gap-1.5">
              <FileDown aria-hidden className="size-4" />
              Landlord packet
              {!tier.pdfExport ? (
                <span className="text-[10px] uppercase tracking-wider text-gold">
                  Pro
                </span>
              ) : null}
            </Button>
            {saved ? (
              <Button asChild variant="secondary" className="gap-1.5">
                <Link href="/pipeline">
                  <Check aria-hidden className="size-4 text-gold" />
                  In pipeline
                </Link>
              </Button>
            ) : (
              <Button onClick={handleSave} className="gap-1.5">
                <FolderPlus aria-hidden className="size-4" />
                Save to pipeline
              </Button>
            )}
          </div>
        </div>

        {/* Headline figures */}
        <div className="overflow-x-auto border-t border-border">
          <div className="flex min-w-max items-stretch divide-x divide-border">
            <div className="px-6 py-5 first:pl-6">
              <MetricLabel>Projected annual revenue</MetricLabel>
              <AnimatedNumber
                value={annualRevenueDisplay}
                format={fmtMoney}
                className="mt-1.5 block font-display text-3xl font-medium leading-tight tracking-tight"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                gross bookings · {fmtMoney(p.monthlyRevenue)}/mo
              </p>
            </div>
            <div className="px-6 py-5">
              <MetricLabel>Occupancy</MetricLabel>
              <div className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight tabular">
                {fmtPct(assumptions.marketOccupancy)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                what this market actually runs
              </p>
            </div>
            <div className="px-6 py-5">
              <MetricLabel>ADR</MetricLabel>
              <div className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight tabular">
                {fmtMoney(assumptions.adr)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fmtMoney(revpar(assumptions.adr, assumptions.marketOccupancy))}{" "}
                RevPAR · {analysis.strComps.length} comps
              </p>
            </div>
            {/* Breakeven — important, deliberately not the centerpiece. */}
            <div className="flex items-center gap-3.5 px-6 py-5">
              <BreakevenGauge
                breakeven={p.breakevenOccupancy}
                marketOccupancy={p.marketOccupancy}
                size={68}
                strokeWidth={3.5}
              />
              <div>
                <MetricLabel>Breakeven occupancy</MetricLabel>
                <div
                  className={cn(
                    "mt-1 text-[1.625rem] font-semibold leading-tight tracking-tight tabular",
                    !comfortable && "text-neg"
                  )}
                >
                  <AnimatedNumber
                    value={neverBreaksEven ? 0 : p.breakevenOccupancy * 100}
                    format={(n) => (neverBreaksEven ? "—" : `${Math.round(n)}%`)}
                  />
                </div>
                <p
                  className={cn(
                    "mt-1 flex items-center gap-1 text-[11px]",
                    neverBreaksEven || p.marginOfSafety < 0
                      ? "text-neg"
                      : comfortable
                        ? "text-gold"
                        : "text-muted-foreground"
                  )}
                >
                  {neverBreaksEven ? (
                    <>
                      <TriangleAlert aria-hidden className="size-3" />
                      never breaks even at these costs
                    </>
                  ) : p.marginOfSafety >= 0 ? (
                    <>
                      <MoveUpRight aria-hidden className="size-3" />
                      {marginPts} pts of cushion under {fmtPct(p.marketOccupancy)}
                    </>
                  ) : (
                    <>
                      <TriangleAlert aria-hidden className="size-3" />
                      market runs {Math.abs(marginPts)} pts short
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Comp revenue range */}
        <div className="border-t border-border px-6 py-5">
          <RevenueRange
            comps={analysis.strComps}
            subjectAnnualRevenue={annualRevenueDisplay}
          />
        </div>
      </section>

      {/* Calculator: inputs left, outputs right */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
        <CalculatorInputs
          inputs={inputs}
          defaults={analysis.defaults}
          onChange={setInputs}
        />

        <div className="flex flex-col rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold text-foreground">Projection</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              At the market&apos;s actual {fmtPct(p.marketOccupancy)} occupancy,
              from {analysis.strComps.length} comps below.
            </p>
          </div>

          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:[&>*:nth-child(odd)]:border-r sm:[&>*:nth-child(-n+2)]:border-t-0 [&>*]:border-border">
            <OutputTile
              label="Projected monthly STR revenue"
              sub={`${fmtMoney(assumptions.adr)} ADR × ${Math.round(p.occupiedNights)} booked nights${p.cleaningCosts > 0 ? " + cleaning fees" : ""}`}
            >
              <AnimatedNumber value={p.monthlyRevenue} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Total monthly costs"
              sub={`${fmtMoney(p.fixedCosts)} fixed · ${fmtMoney(p.feeCosts)} fees${p.cleaningCosts > 0 ? ` · ${fmtMoney(p.cleaningCosts)} cleaning` : ""}`}
            >
              <AnimatedNumber value={p.monthlyCosts} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Net monthly cash flow"
              tone={p.netCashFlow >= 0 ? "gold" : "neg"}
              sub="Revenue minus every cost, monthly"
            >
              <AnimatedNumber value={p.netCashFlow} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Annual profit"
              tone={p.annualProfit >= 0 ? undefined : "neg"}
              sub="12 months at market occupancy"
            >
              <AnimatedNumber value={annualProfitDisplay} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Total startup capital"
              sub={
                inputs.firstMonthFree
                  ? "Deposit + furnishing — first month waived"
                  : "Deposit + furnishing + first month's rent"
              }
            >
              <AnimatedNumber value={p.startupCapital} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Cash-on-cash return"
              tone={p.cashOnCash >= 0.3 ? "gold" : p.cashOnCash < 0 ? "neg" : undefined}
              sub="Annual profit against cash in"
            >
              <AnimatedNumber
                value={Number.isFinite(p.cashOnCash) ? p.cashOnCash * 100 : 0}
                format={(n) =>
                  Number.isFinite(p.cashOnCash) ? `${n.toFixed(1)}%` : "—"
                }
              />
            </OutputTile>
            <OutputTile
              label="Furnishing payback"
              tone={
                inputs.furnishingBudget <= 0 ||
                Number.isFinite(p.furnishingPaybackMonths)
                  ? undefined
                  : "neg"
              }
              sub={
                inputs.furnishingBudget <= 0
                  ? "Enter a furnishing budget to see payback"
                  : "Months of cash flow to recover setup"
              }
            >
              {inputs.furnishingBudget <= 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : Number.isFinite(p.furnishingPaybackMonths) ? (
                <AnimatedNumber
                  value={p.furnishingPaybackMonths}
                  format={fmtMonths}
                />
              ) : (
                <span>Never</span>
              )}
            </OutputTile>
            <OutputTile
              label="Margin of safety"
              tone={comfortable ? "gold" : "neg"}
              sub="Market occupancy minus your breakeven"
            >
              <AnimatedNumber
                value={neverBreaksEven ? 0 : p.marginOfSafety * 100}
                format={(n) => (neverBreaksEven ? "—" : `${Math.round(n)} pts`)}
              />
            </OutputTile>
          </div>
        </div>
      </div>

      {/* Evidence */}
      <div className="mt-14 space-y-14 pb-14">
        <CompsExplorer comps={analysis.strComps} />
        <LtrCompsTable comps={analysis.ltrComps} />
      </div>
    </div>
  );
}
