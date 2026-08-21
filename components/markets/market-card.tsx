"use client";

/**
 * One market card in the explorer grid: terrain banner up top with the
 * margin-of-safety badge (points of cushion — never a score), the
 * trailing-12 figures, and a watch toggle. The card body selects (syncs
 * the map pin); the name link and footer navigate to the detail page.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Eye, TriangleAlert } from "lucide-react";
import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtMoneyShort, fmtNum, fmtPct } from "@/lib/format";
import type { Market } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { MarketBanner, TERRAIN_LABEL } from "./market-banner";
import { cn } from "@/lib/utils";

function Figure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-5 last:pr-5">
      <div className="truncate text-base font-semibold leading-tight text-foreground tabular">
        {children}
      </div>
      <div className="mt-0.5 text-[10px] font-medium uppercase leading-[1.35] tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

interface MarketCardProps {
  market: Market;
  selected: boolean;
  onSelect: (slug: string) => void;
  onHoverChange: (slug: string | null) => void;
}

export const MarketCard = React.forwardRef<HTMLDivElement, MarketCardProps>(
  function MarketCard({ market: m, selected, onSelect, onHoverChange }, ref) {
    const { watchedMarketSlugs, toggleWatchMarket, ready } = useSession();
    const watching = watchedMarketSlugs.includes(m.slug);
    const marginPts = Math.round((m.occupancy - m.avgBreakeven2br) * 100);
    const strong = marginPts >= 8;

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
          "group cursor-pointer overflow-hidden rounded-sm border bg-card transition-colors duration-150",
          selected ? "border-gold/60" : "border-border hover:border-gold/40"
        )}
      >
        {/* Banner with badge + watch toggle */}
        <div className="relative">
          <MarketBanner slug={m.slug} terrain={m.terrain} className="h-24 w-full" />
          <button
            type="button"
            aria-label={watching ? `Stop watching ${m.name}` : `Watch ${m.name}`}
            aria-pressed={watching}
            disabled={!ready}
            onClick={(e) => {
              e.stopPropagation();
              toggleWatchMarket(m.slug);
            }}
            className={cn(
              "absolute right-3 top-3 flex size-8 items-center justify-center rounded-sm border transition-colors duration-150",
              watching
                ? "border-gold/50 bg-background/85 text-gold"
                : "border-border bg-background/70 text-muted-foreground hover:border-gold/40 hover:text-foreground"
            )}
          >
            {watching ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>

          {/* Margin-of-safety badge — points of cushion, not a score. */}
          <div
            aria-label={`${marginPts} points of cushion between market occupancy and the 2 bd breakeven`}
            className={cn(
              "absolute -bottom-5 left-5 flex size-12 flex-col items-center justify-center rounded-full border bg-surface",
              marginPts < 0
                ? "border-neg/50"
                : strong
                  ? "border-gold/50"
                  : "border-border"
            )}
          >
            <span
              className={cn(
                "flex items-center text-sm font-semibold leading-none tabular",
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
            <span className="text-[8px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              pts
            </span>
          </div>
        </div>

        {/* Identity */}
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-7">
          <div className="min-w-0">
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
            <p className="mt-0.5 text-xs text-muted-foreground">
              {TERRAIN_LABEL[m.terrain]} · {fmtNum(m.activeListings)} listings
            </p>
          </div>
        </div>

        {/* Trailing-12 figures */}
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          <Figure label="Revenue potential">
            {fmtMoneyShort(annualRevenueFromAdr(m.adr, m.occupancy))}
          </Figure>
          <Figure label="Occupancy">{fmtPct(m.occupancy)}</Figure>
          <Figure label="Nightly rate">{fmtMoney(m.adr)}</Figure>
        </div>

        {/* Footer strip */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/40 px-5 py-2">
          <span className="text-[11px] text-muted-foreground">
            Trailing 12 months · 2 bd benchmark
          </span>
          <span className="text-[11px] text-muted-foreground tabular">
            Breakeven{" "}
            <span className="font-medium text-foreground">
              {fmtPct(m.avgBreakeven2br)}
            </span>
          </span>
        </div>
      </div>
    );
  }
);
