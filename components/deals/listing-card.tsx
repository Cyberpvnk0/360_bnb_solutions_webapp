"use client";

/**
 * One rental in the Deal Finder grid.
 *
 * The skeleton is the one every rental portal has converged on, because
 * it is the one that works: a wide photograph, the rent in the largest
 * type on the card, the unit's facts on one pipe-separated line, and the
 * address quietly beneath. People arrive here already fluent in it.
 *
 * What is ours is the last third. A portal card stops at what the place
 * IS; this one carries what it would DO — a verdict on the photo, and a
 * strip of the three short-let figures the lease turns on. Those come
 * from lib/mock/rentals' single read, which runs the same engine as the
 * panel that opens on click, so a card and its detail view cannot
 * disagree.
 *
 * The picture is the kerb, never the listing's own photos: a photo is
 * copyrighted separately from the facts around it and this product
 * holds no licence to one. "View photos" sends people to the page that
 * does.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, TrendingDown } from "lucide-react";
import { fmtMoney, fmtNum } from "@/lib/format";
import { gradeDeal } from "@/lib/calc/deal-grade";
import type { DealRead } from "@/lib/mock/rentals";
import type { RentalListing } from "@/lib/mock/types";
import { PropertyImage } from "./property-image";
import { PhotosLink } from "./photos-link";
import { DealBadge } from "./deal-badge";
import { AddToListMenu } from "./add-to-list-menu";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL } from "./deal-filters";
import { analyzeHref } from "@/lib/live/analyze-href";
import { cn } from "@/lib/utils";

/** Zillow's separator, and it earns its place: four facts run together
 *  read as one phrase, and commas already mean something in an address. */
function Pipe() {
  return <span className="mx-1.5 text-border">|</span>;
}

/** How long it has been sitting, in the words a person would use. */
function listedAgo(days: number): string {
  if (days === 0) return "Listed today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "bad";
}) {
  return (
    <div className="px-3 py-2 text-center">
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular",
          tone === "good"
            ? "text-gold"
            : tone === "bad"
              ? "text-neg"
              : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

interface ListingCardProps {
  listing: RentalListing;
  /** Opens the detail panel — the whole card is the target. */
  onOpen: (id: string) => void;
  /** The short-let read, computed once by the explorer. */
  deal: DealRead;
  selected: boolean;
  /** True while the map's matching price pill is hovered. */
  hovered: boolean;
  onHoverChange: (id: string | null) => void;
  /** True when a feature filter is on. A row kept because its amenities
   *  are UNKNOWN then has to say so — otherwise sitting in a Furnished
   *  list with no tag reads as "checked and fine". */
  featureFilterActive?: boolean;
  /** Set on the cards that open on screen. Their images load eagerly
   *  and at high priority; everything below stays lazy. */
  priority?: boolean;
}

export const ListingCard = React.forwardRef<HTMLDivElement, ListingCardProps>(
  function ListingCard(
    {
      listing: l,
      deal,
      selected,
      hovered,
      onHoverChange,
      onOpen,
      featureFilterActive = false,
      priority = false,
    },
    ref
  ) {
    const verdict = gradeDeal(deal.cushionPts);
    const cut = l.priceTrend?.cutBy ?? 0;
    const furnished = l.features.includes("Furnished");

    return (
      <div
        ref={ref}
        onMouseEnter={() => onHoverChange(l.id)}
        onMouseLeave={() => onHoverChange(null)}
        onClick={() => onOpen(l.id)}
        className={cn(
          "cursor-pointer overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:elev-raised",
          selected
            ? "border-gold/60"
            : hovered
              ? "border-gold/40"
              : "border-border hover:border-gold/40"
        )}
      >
        <div className="relative">
          <PropertyImage
            listing={l}
            priority={priority}
            className="aspect-[16/9] w-full border-b border-border"
          />

          {/* Verdict first, because it is why this card is worth a
              second of attention; how long it has sat is context. */}
          <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
            <DealBadge grade={verdict.grade} label={verdict.label} />
            {l.daysOnMarket !== undefined ? (
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-[#4a4d57] shadow-sm backdrop-blur-[2px]">
                {listedAgo(l.daysOnMarket)}
              </span>
            ) : null}
          </div>

          {furnished ? (
            <span className="absolute right-3 top-3 rounded-full bg-[#e3b341] px-2 py-0.5 text-[10px] font-semibold text-[#1c1503] shadow-sm">
              Furnished
            </span>
          ) : null}

          {/* Bottom-LEFT: the image tags its own source bottom-right,
              and two overlays fighting for one corner is how a card
              gets ugly at narrow widths. */}
          <PhotosLink
            place={l}
            real={l.id.startsWith("live--")}
            variant="pill"
            className="absolute bottom-2 left-2"
          />
        </div>

        <div className="px-4 pb-3 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-xl font-bold leading-none text-foreground tabular">
              {fmtMoney(l.rentMonthly)}
              <span className="text-sm font-normal text-muted-foreground">
                /mo
              </span>
            </p>
            {/* The one figure on this card about the LANDLORD rather
                than the property: a unit that has cut its rent is a
                lease somebody wants signed. */}
            {cut > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gold">
                <TrendingDown aria-hidden className="size-3.5" />
                {fmtMoney(cut)} cut
              </span>
            ) : null}
          </div>

          <p className="mt-1.5 text-sm text-foreground tabular">
            {l.bedrooms} bd
            <Pipe />
            {l.bathrooms} ba
            {l.sqft > 0 ? (
              <>
                <Pipe />
                {fmtNum(l.sqft)} sqft
              </>
            ) : null}
            <Pipe />
            <span className="font-normal text-muted-foreground">
              {TYPE_LABEL[l.propertyType]}
            </span>
          </p>

          <p className="mt-1 truncate text-sm text-muted-foreground" title={l.address}>
            {l.address}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {l.submarketName ? `${l.submarketName} · ` : ""}
            {l.city}, {l.stateCode}
          </p>

          {l.featuresKnown === false && featureFilterActive ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Amenities not listed — shown just in case
            </p>
          ) : null}
        </div>

        {/* The part a rental portal does not have. */}
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-secondary/40">
          <Stat
            label="Cushion"
            value={`${deal.cushionPts < 0 ? "−" : "+"}${Math.abs(deal.cushionPts)} pts`}
            tone={deal.cushionPts < 0 ? "bad" : deal.cushionPts >= 8 ? "good" : "plain"}
          />
          <Stat
            label="Cash flow"
            value={`${fmtMoney(deal.netCashFlow)}/mo`}
            tone={deal.netCashFlow < 0 ? "bad" : "good"}
          />
          <Stat label="Nightly" value={fmtMoney(deal.nightlyRate)} />
        </div>

        <div
          className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <AddToListMenu listing={l} />
          <Button variant="outline" size="sm" asChild>
            <Link href={analyzeHref(l)}>
              Run the numbers
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }
);
