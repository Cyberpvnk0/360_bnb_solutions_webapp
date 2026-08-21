"use client";

/**
 * One submarket in the nationwide list: dense row — name and parent
 * market left, the trailing-12 figures and the cushion right. Hover
 * syncs the map pin.
 */

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtMoneyShort, fmtNum, fmtPct } from "@/lib/format";
import type { Submarket } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-right">
      <div className="text-sm font-semibold leading-tight text-foreground tabular">
        {children}
      </div>
      <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

interface SubmarketRowProps {
  submarket: Submarket;
  selected: boolean;
  onSelect: (id: string) => void;
  onHoverChange: (id: string | null) => void;
}

export const SubmarketRow = React.forwardRef<HTMLDivElement, SubmarketRowProps>(
  function SubmarketRow({ submarket: s, selected, onSelect, onHoverChange }, ref) {
    const marginPts = Math.round((s.occupancy - s.avgBreakeven2br) * 100);
    const strong = marginPts >= 8;
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`Select ${s.name} in ${s.marketName} on the map`}
        onClick={() => onSelect(s.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s.id);
          }
        }}
        onMouseEnter={() => onHoverChange(s.id)}
        onMouseLeave={() => onHoverChange(null)}
        className={cn(
          "flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-2 rounded-sm border bg-card px-5 py-3.5 transition-colors duration-150",
          selected ? "border-gold/60" : "border-border hover:border-gold/40"
        )}
      >
        <div className="min-w-0 flex-1 basis-52">
          <p className="truncate text-sm font-semibold text-foreground">
            {s.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            in {s.marketName}, {s.stateCode} · {fmtNum(s.activeListings)} listings
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          <Cell label="Revenue">
            {fmtMoneyShort(annualRevenueFromAdr(s.adr, s.occupancy))}
          </Cell>
          <Cell label="Occupancy">{fmtPct(s.occupancy)}</Cell>
          <Cell label="Rate">{fmtMoney(s.adr)}</Cell>
          <span
            className={cn(
              "inline-flex w-20 items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold tabular",
              marginPts < 0
                ? "border-neg/40 text-neg"
                : strong
                  ? "border-gold-fill/40 bg-gold-fill/10 text-gold"
                  : "border-border text-foreground"
            )}
          >
            {marginPts < 0 ? (
              <TriangleAlert aria-hidden className="size-3" />
            ) : (
              "+"
            )}
            {Math.abs(marginPts)} pts
          </span>
        </div>
      </div>
    );
  }
);
