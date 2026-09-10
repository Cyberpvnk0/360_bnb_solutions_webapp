"use client";

/**
 * The card that docks on the Deal Finder map when a pin is clicked —
 * the same idea as the comps map's, and the way every property portal
 * answers a pin: the listing in brief, on the map, without a panel
 * taking the screen. Details are one button away; the numbers run in
 * a new tab so the search stays where it was.
 */

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { fmtMoney, fmtNum } from "@/lib/format";
import { gradeDeal } from "@/lib/calc/deal-grade";
import type { DealRead } from "@/lib/calc/deal-read";
import type { RentalListing } from "@/lib/mock/types";
import { analyzeHref } from "@/lib/live/analyze-href";
import { Button } from "@/components/ui/button";
import { DealBadge } from "./deal-badge";
import { PropertyImage } from "./property-image";

export function ListingDock({
  listing: l,
  deal,
  onClose,
  onDetails,
}: {
  listing: RentalListing;
  deal: DealRead;
  onClose: () => void;
  onDetails: () => void;
}) {
  const verdict = gradeDeal(deal.cushionPts);
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-card p-3 shadow-[0_4px_16px_rgba(16,16,18,0.12)]">
      <PropertyImage listing={l} className="h-20 w-28 shrink-0 overflow-hidden rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{l.address}</p>
            <p className="truncate text-xs text-muted-foreground">
              {l.city}, {l.stateCode}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close listing card"
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground tabular">
          <span className="text-sm font-bold text-foreground">{fmtMoney(l.rentMonthly)}</span>
          /mo · {l.bedrooms} bd · {l.bathrooms} ba
          {l.sqft > 0 ? <> · {fmtNum(l.sqft)} sqft</> : null}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <DealBadge grade={verdict.grade} label={verdict.label} />
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onDetails}>
              Details
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={analyzeHref(l)} target="_blank" rel="noopener">
                Run the numbers
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
