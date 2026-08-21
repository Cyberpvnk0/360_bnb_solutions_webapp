"use client";

/**
 * THE CORE SCREEN — an address turned into an underwriting decision.
 *
 * Hero: breakeven occupancy inside the circular gauge, against the
 * market's actual occupancy. Left: live calculator inputs. Right: outputs
 * recalculating on every keystroke. Below: the comp evidence for both the
 * revenue projection and the lease estimate.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  FileDown,
  FolderPlus,
  MoveDownRight,
} from "lucide-react";
import { toast } from "sonner";
import { projectDeal, type DealInputs } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import {
  fmtDate,
  fmtMoney,
  fmtMonths,
  fmtPct,
} from "@/lib/format";
import type { Analysis } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { AnimatedNumber } from "@/components/primitives/animated-number";
import { BreakevenGauge } from "@/components/primitives/breakeven-gauge";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { CalculatorInputs } from "./calculator-inputs";
import { LtrCompsTable, StrCompsTable } from "./comps-tables";
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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <MetricLabel>Address pull · {fmtDate(analysis.createdAt)}</MetricLabel>
            <StatusChip tone="outline">
              {analysis.bedrooms} bd · {analysis.bathrooms} ba ·{" "}
              {PROPERTY_TYPE_LABEL[analysis.propertyType]}
            </StatusChip>
          </div>
          <h1 className="mt-1.5 truncate font-display text-2xl font-medium tracking-tight text-foreground md:text-3xl">
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={handleExport} className="gap-1.5">
            <FileDown aria-hidden className="size-4" />
            Landlord packet
            {!tier.pdfExport ? (
              <span className="text-[10px] uppercase tracking-wider text-gold">Pro</span>
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

      {/* Hero: the breakeven gauge */}
      <section
        aria-label="Breakeven occupancy"
        className="mt-8 flex flex-col items-center border-y border-border py-14"
      >
        <BreakevenGauge
          breakeven={p.breakevenOccupancy}
          marketOccupancy={p.marketOccupancy}
          size={300}
          strokeWidth={6}
        >
          <MetricLabel>Breakeven occupancy</MetricLabel>
          <AnimatedNumber
            value={neverBreaksEven ? 0 : p.breakevenOccupancy * 100}
            format={(n) => (neverBreaksEven ? "—" : `${Math.round(n)}%`)}
            className={cn(
              "font-display text-7xl font-medium leading-none tracking-tight",
              comfortable ? "text-foreground" : "text-neg"
            )}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            market runs at{" "}
            <span className="font-medium text-foreground tabular">
              {fmtPct(p.marketOccupancy)}
            </span>
          </p>
        </BreakevenGauge>

        <div className="mt-6">
          {neverBreaksEven ? (
            <StatusChip tone="neg">Never breaks even at these costs</StatusChip>
          ) : comfortable ? (
            <StatusChip tone="gold">
              {marginPts} pts margin of safety
            </StatusChip>
          ) : p.marginOfSafety >= 0 ? (
            <StatusChip tone="neutral">
              Only {marginPts} pts of headroom — thin
            </StatusChip>
          ) : (
            <StatusChip tone="neg">
              Market runs {Math.abs(marginPts)} pts below your breakeven
            </StatusChip>
          )}
        </div>
        <p className="mt-3 max-w-md text-center text-xs text-muted-foreground">
          {neverBreaksEven
            ? "At these fees, a booked night costs more than it earns. Cut costs or walk away."
            : comfortable
              ? "Every occupancy point above the gold arc is profit. The grey tick is what this market actually runs."
              : p.marginOfSafety >= 0
                ? "You clear costs, but one soft month puts you underwater. Negotiate the rent down."
                : "This lease doesn't pencil at market performance. Change the numbers or the address."}
        </p>
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
              sub={`${fmtMoney(assumptions.adr)} ADR × ${Math.round(p.occupiedNights)} booked nights + cleaning fees`}
            >
              <AnimatedNumber value={p.monthlyRevenue} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Total monthly costs"
              sub={`${fmtMoney(p.fixedCosts)} fixed · ${fmtMoney(p.feeCosts)} fees · ${fmtMoney(p.cleaningCosts)} cleaning`}
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
              <AnimatedNumber value={p.annualProfit} format={fmtMoney} />
            </OutputTile>
            <OutputTile
              label="Total startup capital"
              sub="Deposit + furnishing + first month's rent"
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
                format={(n) => (Number.isFinite(p.cashOnCash) ? `${n.toFixed(1)}%` : "—")}
              />
            </OutputTile>
            <OutputTile
              label="Furnishing payback"
              tone={Number.isFinite(p.furnishingPaybackMonths) ? undefined : "neg"}
              sub="Months of cash flow to recover setup"
            >
              {Number.isFinite(p.furnishingPaybackMonths) ? (
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
        <StrCompsTable comps={analysis.strComps} />
        <LtrCompsTable comps={analysis.ltrComps} />
      </div>
    </div>
  );
}
