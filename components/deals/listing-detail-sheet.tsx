"use client";

/**
 * The listing panel: click a price pill on the map (or a card) and the
 * property opens here with everything needed to judge and keep it —
 * the unit's facts, the deal math at this market's actual ADR and
 * occupancy, and the three actions that matter: shortlist it, run the
 * full numbers, or open it on Zillow.
 *
 * Every figure comes through lib/calc with the same benchmark inputs the
 * market pages use, so the cushion here can never disagree with the
 * cushion on the card behind it.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Bookmark, BookmarkCheck, TriangleAlert } from "lucide-react";
import { projectDeal } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { benchmark2brInputs } from "@/lib/mock/markets";
import { BEDROOM_ADR_FACTOR } from "@/lib/mock/rentals";
import type { Market, RentalListing } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { PropertyImage } from "./property-image";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function Figure({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "plain" | "good" | "bad";
}) {
  return (
    <div className="px-5 py-4">
      <MetricLabel>{label}</MetricLabel>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular",
          tone === "good"
            ? "text-gold"
            : tone === "bad"
              ? "text-neg"
              : "text-foreground"
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

interface ListingDetailSheetProps {
  listing: RentalListing | null;
  market: Market | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ListingDetailSheet({
  listing,
  market,
  open,
  onOpenChange,
}: ListingDetailSheetProps) {
  const { shortlist, toggleShortlist, isShortlisted, ready } = useSession();

  // Same benchmark the cards and market pages use: this rent, this
  // market's ADR scaled to the bedroom count, this market's occupancy.
  const projection = React.useMemo(() => {
    if (!listing || !market) return null;
    return projectDeal(benchmark2brInputs(listing.rentMonthly), {
      adr: Math.round(market.adr * BEDROOM_ADR_FACTOR[listing.bedrooms]),
      marketOccupancy: market.occupancy,
    });
  }, [listing, market]);

  const saved = listing ? isShortlisted(listing.id) : false;
  const cushionPts = projection
    ? Math.round(projection.marginOfSafety * 100)
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        {listing && market && projection ? (
          <>
            <PropertyImage
              listing={listing}
              className="h-40 w-full shrink-0 border-b border-border"
            />

            <SheetHeader className="gap-1 border-b border-border px-5 py-4">
              <SheetTitle className="text-base leading-tight">
                {listing.address}
              </SheetTitle>
              <SheetDescription>
                {listing.submarketName ? `${listing.submarketName} · ` : ""}
                {listing.city}, {listing.stateCode}
              </SheetDescription>
              <p className="mt-1.5 text-2xl font-semibold text-foreground tabular">
                {fmtMoney(listing.rentMonthly)}
                <span className="text-sm font-normal text-muted-foreground">
                  /mo asking rent
                </span>
              </p>
              <p className="text-xs text-muted-foreground tabular">
                {listing.bedrooms} bd · {listing.bathrooms} ba ·{" "}
                {listing.sqft > 0 ? `${fmtNum(listing.sqft)} sqft · ` : ""}
                {listing.daysOnMarket === 0
                  ? "listed today"
                  : `${listing.daysOnMarket} days on market`}
              </p>
            </SheetHeader>

            {/* Actions first — this panel exists to keep or advance a deal. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
              <Button
                variant={saved ? "outline" : "default"}
                size="sm"
                disabled={!ready}
                onClick={() => toggleShortlist(listing)}
                className={saved ? "border-gold/50 text-gold" : undefined}
              >
                {saved ? (
                  <>
                    <BookmarkCheck aria-hidden className="size-4" />
                    Shortlisted
                  </>
                ) : (
                  <>
                    <Bookmark aria-hidden className="size-4" />
                    Save to shortlist
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/analyze?address=${listing.analysisId}`}>
                  Run the numbers
                </Link>
              </Button>
              <a
                href={`https://www.zillow.com/homes/for_rent/${encodeURIComponent(
                  `${listing.address}, ${listing.city}, ${listing.stateCode}`
                )}_rb/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                Zillow
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
              {shortlist.length > 0 ? (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {shortlist.length} shortlisted
                </span>
              ) : null}
            </div>

            {/* The read: does nightly beat this lease? */}
            <div className="border-b border-border px-5 py-3">
              <p className="text-sm font-semibold text-foreground">
                If you ran this as a short-term rental
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                At {market.name}&apos;s actual {fmtPct(market.occupancy)}{" "}
                occupancy and{" "}
                {fmtMoney(
                  Math.round(market.adr * BEDROOM_ADR_FACTOR[listing.bedrooms])
                )}{" "}
                nightly rate for a {listing.bedrooms} bd.
              </p>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border">
              <Figure
                label="Cushion"
                value={`${cushionPts >= 0 ? "+" : "−"}${Math.abs(cushionPts)} pts`}
                sub="Occupancy minus breakeven"
                tone={cushionPts < 0 ? "bad" : cushionPts >= 8 ? "good" : "plain"}
              />
              <Figure
                label="Breakeven"
                value={fmtPct(projection.breakevenOccupancy)}
                sub="Nights booked to cover costs"
              />
              <Figure
                label="Monthly cash flow"
                value={fmtMoney(Math.round(projection.netCashFlow))}
                sub={`${fmtMoney(Math.round(projection.monthlyRevenue))} revenue − ${fmtMoney(Math.round(projection.monthlyCosts))} costs`}
                tone={projection.netCashFlow < 0 ? "bad" : "good"}
              />
              <Figure
                label="Startup capital"
                value={fmtMoney(Math.round(projection.startupCapital))}
                sub="Deposit + first month, before furnishing"
              />
            </div>

            {cushionPts < 0 ? (
              <p className="flex items-start gap-2 border-b border-border px-5 py-3 text-xs text-neg">
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                At this rent the market&apos;s occupancy doesn&apos;t clear the
                lease. Negotiate the rent down or pass.
              </p>
            ) : null}

            {listing.features.length > 0 ? (
              <div className="border-b border-border px-5 py-4">
                <MetricLabel>Features</MetricLabel>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {listing.features.map((f) => (
                    <span
                      key={f}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        f === "Furnished"
                          ? "border-gold/50 bg-gold-fill/10 text-gold"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="px-5 py-4">
              <MetricLabel>Market context</MetricLabel>
              <dl className="mt-2 space-y-1.5 text-xs">
                {[
                  ["Market nightly rate", fmtMoney(market.adr)],
                  ["Market occupancy", fmtPct(market.occupancy)],
                  ["Median 2 bd rent", fmtMoney(market.medianRent2br)],
                  ["Active rentals tracked", fmtNum(market.activeListings)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium text-foreground tabular">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
                <Link href={`/markets/${market.slug}`}>
                  See the {market.name} market
                </Link>
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
