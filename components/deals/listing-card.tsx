"use client";

/**
 * One rental listing in the Deal Finder grid: sketch thumb up top (with a
 * "New" chip inside its first days), the asking rent big, the unit line,
 * the address, and a footer pairing the cushion estimate with the two
 * actions — hand the listing to the analyzer, or open the address on
 * Zillow. Hovering syncs the map's price pill.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { RentalListing } from "@/lib/mock/types";
import { PropertyThumb } from "@/components/analyze/property-thumb";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL } from "./deal-filters";
import { cn } from "@/lib/utils";

interface ListingCardProps {
  listing: RentalListing;
  /** Whole points of cushion (occupancy − breakeven) from lib/mock/rentals. */
  cushionPts: number;
  selected: boolean;
  onHoverChange: (id: string | null) => void;
}

export const ListingCard = React.forwardRef<HTMLDivElement, ListingCardProps>(
  function ListingCard(
    { listing: l, cushionPts, selected, onHoverChange },
    ref
  ) {
    const strong = cushionPts >= 8;
    const zillowUrl = `https://www.zillow.com/homes/for_rent/${encodeURIComponent(
      `${l.address}, ${l.city}, ${l.stateCode}`
    )}_rb/`;

    return (
      <div
        ref={ref}
        onMouseEnter={() => onHoverChange(l.id)}
        onMouseLeave={() => onHoverChange(null)}
        className={cn(
          "overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:elev-raised",
          selected ? "border-gold/60" : "border-border hover:border-gold/40"
        )}
      >
        <div className="relative">
          <PropertyThumb
            seed={l.id}
            className="h-28 w-full rounded-none border-0 border-b border-border"
          />
          {l.daysOnMarket < 5 ? (
            <span className="absolute left-3 top-3 rounded-full border border-gold/50 bg-gold-fill/10 px-2 py-0.5 text-[10px] font-medium text-gold">
              New
            </span>
          ) : null}
        </div>

        <div className="px-5 pb-4 pt-3.5">
          <p className="text-lg font-semibold leading-tight text-foreground tabular">
            {fmtMoney(l.rentMonthly)}
            <span className="text-xs font-normal text-muted-foreground">
              /mo
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular">
            {l.bedrooms} bd · {l.bathrooms} ba · {fmtNum(l.sqft)} sqft ·{" "}
            {TYPE_LABEL[l.propertyType]}
          </p>
          <p className="mt-2 truncate text-sm font-medium text-foreground">
            {l.address}
          </p>
          <p className="text-xs text-muted-foreground">
            in {l.city}, {l.stateCode}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span
            aria-label={`${Math.abs(cushionPts)} points of cushion between market occupancy and this rent's breakeven`}
            className={cn(
              "inline-flex w-20 shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold tabular",
              cushionPts < 0
                ? "border-neg/40 text-neg"
                : strong
                  ? "border-gold-fill/40 bg-gold-fill/10 text-gold"
                  : "border-border text-foreground"
            )}
          >
            {cushionPts < 0 ? (
              <TriangleAlert aria-hidden className="size-3" />
            ) : (
              "+"
            )}
            {Math.abs(cushionPts)} pts
          </span>

          <span className="flex items-center gap-1.5">
            <Button size="sm" asChild>
              <Link href={`/analyze?address=${l.analysisId}`}>
                Run the numbers
              </Link>
            </Button>
            <a
              href={zillowUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open on Zillow"
              className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </span>
        </div>
      </div>
    );
  }
);
