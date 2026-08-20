"use client";

/**
 * One ranked market row in the explorer list. The card body selects (syncs
 * the map pin); only the name link and the "View market" affordance
 * navigate to the detail page.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { revpar } from "@/lib/calc/arbitrage";
import { fmtDeltaPts, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import type { Market, RegulationStatus } from "@/lib/mock/types";
import { DeltaIndicator } from "@/components/primitives/delta-indicator";
import { StatusChip } from "@/components/primitives/status-chip";
import { cn } from "@/lib/utils";

export const REGULATION_LABEL: Record<RegulationStatus, string> = {
  permitted: "Permitted",
  "permit-required": "Permit required",
  banned: "Banned",
  unverified: "Unverified",
};

export const REGULATION_TONE: Record<
  RegulationStatus,
  "gold" | "outline" | "neg" | "neutral"
> = {
  permitted: "gold",
  "permit-required": "outline",
  banned: "neg",
  unverified: "neutral",
};

function Figure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-foreground tabular">
        {children}
      </div>
    </div>
  );
}

interface MarketCardProps {
  market: Market;
  rank: number;
  selected: boolean;
  onSelect: (slug: string) => void;
  onHoverChange: (slug: string | null) => void;
}

export const MarketCard = React.forwardRef<HTMLDivElement, MarketCardProps>(
  function MarketCard({ market: m, rank, selected, onSelect, onHoverChange }, ref) {
    const margin = m.occupancy - m.avgBreakeven2br;
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`Select ${m.name}, ${m.stateCode} on the map`}
        onClick={() => onSelect(m.slug)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(m.slug);
          }
        }}
        onMouseEnter={() => onHoverChange(m.slug)}
        onMouseLeave={() => onHoverChange(null)}
        className={cn(
          "cursor-pointer border-b border-border px-4 py-3 transition-colors duration-150 hover:bg-secondary/50",
          selected && "active-rule bg-secondary/40"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="w-5 shrink-0 text-[11px] text-muted-foreground tabular">
              {String(rank).padStart(2, "0")}
            </span>
            <Link
              href={`/markets/${m.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="group/name inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground transition-colors duration-150 hover:text-gold"
            >
              <span className="truncate">
                {m.name}
                <span className="font-normal text-muted-foreground">
                  , {m.stateCode}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover/name:opacity-100"
              />
              <span className="sr-only">View market</span>
            </Link>
          </div>
          <StatusChip tone={REGULATION_TONE[m.regulation.status]}>
            {REGULATION_LABEL[m.regulation.status]}
          </StatusChip>
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 pl-[30px] sm:grid-cols-5">
          <Figure label="ADR">{fmtMoney(m.adr)}</Figure>
          <Figure label="Occupancy">{fmtPct(m.occupancy)}</Figure>
          <Figure label="RevPAR">{fmtMoney(revpar(m.adr, m.occupancy))}</Figure>
          <Figure label="Listings">{fmtNum(m.activeListings)}</Figure>
          <Figure label="2BR breakeven">
            <span className="flex flex-wrap items-center gap-x-1.5">
              {fmtPct(m.avgBreakeven2br)}
              <DeltaIndicator
                value={margin}
                label={fmtDeltaPts(margin, 0)}
                className="text-[11px]"
              />
            </span>
          </Figure>
        </div>
      </div>
    );
  }
);
