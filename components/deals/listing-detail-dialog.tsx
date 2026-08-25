"use client";

/**
 * The listing overlay: a centered panel over a blurred Deal Finder, so
 * the search stays visible behind the property you're judging. Click a
 * price pill or a card to open it; the X (or Escape, or the backdrop)
 * returns you to the search exactly where you left it.
 *
 * Everything a hunter needs before making the call lives here: the
 * unit's facts, who to contact, the deal read at this market's actual
 * ADR and occupancy, and the actions — add to a list, run the full
 * numbers, open on Zillow. Every figure comes through lib/calc with the
 * same benchmark inputs the cards use, so nothing can disagree.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Mail, Phone, TriangleAlert, User } from "lucide-react";
import { projectDeal } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { benchmark2brInputs } from "@/lib/mock/markets";
import { BEDROOM_ADR_FACTOR } from "@/lib/mock/rentals";
import type { Market, RentalListing } from "@/lib/mock/types";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddToListMenu } from "./add-to-list-menu";
import { PropertyImage } from "./property-image";
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
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export function ListingDetailDialog({
  listing,
  market,
  open,
  onOpenChange,
}: {
  listing: RentalListing | null;
  market: Market | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projection = React.useMemo(() => {
    if (!listing || !market) return null;
    return projectDeal(benchmark2brInputs(listing.rentMonthly), {
      adr: Math.round(market.adr * BEDROOM_ADR_FACTOR[listing.bedrooms]),
      marketOccupancy: market.occupancy,
    });
  }, [listing, market]);

  const cushionPts = projection
    ? Math.round(projection.marginOfSafety * 100)
    : 0;
  const isLive = listing?.id.startsWith("live--") ?? false;
  const contact = listing?.contact;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {listing && market && projection ? (
          <>
            <PropertyImage
              listing={listing}
              className="h-44 w-full shrink-0 rounded-t-sm border-b border-border"
            />

            <div className="border-b border-border px-5 py-4 pr-12">
              <DialogTitle className="text-base leading-tight">
                {listing.address}
              </DialogTitle>
              <DialogDescription>
                {listing.submarketName ? `${listing.submarketName} · ` : ""}
                {listing.city}, {listing.stateCode}
              </DialogDescription>
              <p className="mt-2 text-2xl font-semibold text-foreground tabular">
                {fmtMoney(listing.rentMonthly)}
                <span className="text-sm font-normal text-muted-foreground">
                  /mo asking rent
                </span>
              </p>
              <p className="text-xs text-muted-foreground tabular">
                {listing.bedrooms} bd · {listing.bathrooms} ba ·{" "}
                {listing.sqft > 0 ? `${fmtNum(listing.sqft)} sqft · ` : ""}
                {listing.daysOnMarket === undefined
                  ? "Listed date not published"
                  : listing.daysOnMarket === 0
                  ? "listed today"
                  : `${listing.daysOnMarket} days on market`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
              <AddToListMenu listing={listing} />
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
            </div>

            {/* Who to call — the step between "this pencils" and a lease. */}
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <MetricLabel>{contact?.role ?? "Contact"}</MetricLabel>
                {!isLive ? (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Preview contact
                  </span>
                ) : null}
              </div>
              {contact ? (
                <div className="mt-2 space-y-1.5">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <User aria-hidden className="size-3.5 text-muted-foreground" />
                    {contact.name}
                    {contact.company ? (
                      <span className="font-normal text-muted-foreground">
                        · {contact.company}
                      </span>
                    ) : null}
                  </p>
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                      className="flex items-center gap-2 text-sm text-foreground transition-colors duration-150 hover:text-gold"
                    >
                      <Phone aria-hidden className="size-3.5 text-muted-foreground" />
                      <span className="tabular">{contact.phone}</span>
                    </a>
                  ) : null}
                  {contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-2 text-sm text-foreground transition-colors duration-150 hover:text-gold"
                    >
                      <Mail aria-hidden className="size-3.5 text-muted-foreground" />
                      <span className="truncate">{contact.email}</span>
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  This feed didn&apos;t include contact details for the
                  listing. Open it on Zillow to reach the lister.
                </p>
              )}
            </div>

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

            <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-4 sm:divide-y-0">
              <Figure
                label="Cushion"
                value={`${cushionPts >= 0 ? "+" : "−"}${Math.abs(cushionPts)} pts`}
                sub="Occupancy − breakeven"
                tone={cushionPts < 0 ? "bad" : cushionPts >= 8 ? "good" : "plain"}
              />
              <Figure
                label="Breakeven"
                value={fmtPct(projection.breakevenOccupancy)}
                sub="Nights to cover costs"
              />
              <Figure
                label="Cash flow"
                value={`${fmtMoney(Math.round(projection.netCashFlow))}/mo`}
                sub={`${fmtMoney(Math.round(projection.monthlyRevenue))} − ${fmtMoney(Math.round(projection.monthlyCosts))} costs`}
                tone={projection.netCashFlow < 0 ? "bad" : "good"}
              />
              <Figure
                label="Startup"
                value={fmtMoney(Math.round(projection.startupCapital))}
                sub="Deposit + first month"
              />
            </div>

            {cushionPts < 0 ? (
              <p className="flex items-start gap-2 border-b border-border px-5 py-3 text-xs text-neg">
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                At this rent the market&apos;s occupancy doesn&apos;t clear the
                lease. Negotiate the rent down or pass.
              </p>
            ) : null}

            {listing.description ? (
              <div className="border-b border-border px-5 py-4">
                <MetricLabel>From the listing</MetricLabel>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {listing.description}
                </p>
              </div>
            ) : null}

            <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
              {listing.features.length > 0 ? (
                <div>
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

              <div>
                <MetricLabel>Market context</MetricLabel>
                <dl className="mt-2 space-y-1.5 text-xs">
                  {[
                    ["Market nightly rate", fmtMoney(market.adr)],
                    ["Market occupancy", fmtPct(market.occupancy)],
                    ["Median 2 bd rent", fmtMoney(market.medianRent2br)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium text-foreground tabular">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  asChild
                >
                  <Link href={`/markets/${market.slug}`}>
                    See the {market.name} market
                  </Link>
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
