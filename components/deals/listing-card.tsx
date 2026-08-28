"use client";

/**
 * One rental listing in the Deal Finder grid: sketch thumb up top (with a
 * "New" chip inside its first days), the asking rent big, the unit line,
 * the address, and a footer pairing the cushion estimate with the
 * analyzer hand-off. Hovering syncs the map's price pill.
 *
 * The image is a curb shot, and a pill on it links out to the listing's
 * own photos. We do not hold a licence to the interiors, and the place
 * that does is one click away.
 */

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { RentalListing } from "@/lib/mock/types";
import { PropertyImage } from "./property-image";
import { PhotosLink } from "./photos-link";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL } from "./deal-filters";
import { analyzeHref } from "@/lib/live/analyze-href";
import { cn } from "@/lib/utils";

interface ListingCardProps {
  listing: RentalListing;
  /** Opens the detail panel — the whole card is the target. */
  onOpen: (id: string) => void;
  /** Whole points of cushion (occupancy − breakeven) from lib/mock/rentals. */
  cushionPts: number;
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
      cushionPts,
      selected,
      hovered,
      onHoverChange,
      onOpen,
      featureFilterActive = false,
      priority = false,
    },
    ref
  ) {
    const strong = cushionPts >= 8;

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
            className="h-28 w-full border-b border-border"
          />
          {l.daysOnMarket !== undefined && l.daysOnMarket < 5 ? (
            <span className="absolute left-3 top-3 rounded-full border border-gold/50 bg-gold-fill/10 px-2 py-0.5 text-[10px] font-medium text-gold">
              New
            </span>
          ) : null}
          {/* Bottom-LEFT: the image tags itself bottom-right, and two
              overlays fighting for one corner is how a card gets ugly
              at narrow widths. */}
          <PhotosLink
            place={l}
            real={l.id.startsWith("live--")}
            variant="pill"
            className="absolute bottom-2 left-2"
          />
        </div>

        <div className="px-5 pb-4 pt-3.5">
          <p className="text-lg font-semibold leading-tight text-foreground tabular">
            {fmtMoney(l.rentMonthly)}
            <span className="text-xs font-normal text-muted-foreground">
              /mo
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular">
            {l.bedrooms} bd · {l.bathrooms} ba ·{" "}
            {l.sqft > 0 ? `${fmtNum(l.sqft)} sqft · ` : ""}
            {TYPE_LABEL[l.propertyType]}
          </p>
          <p className="mt-2 truncate text-sm font-medium text-foreground">
            {l.address}
          </p>
          <p className="text-xs text-muted-foreground">
            in {l.submarketName ? `${l.submarketName} · ` : ""}
            {l.city}, {l.stateCode}
          </p>

          {/* Feature tags — Furnished reads gold: it can zero the
              furnishing budget, so it's the tag operators hunt. */}
          {l.featuresKnown === false && featureFilterActive ? (
            <div className="mt-2.5">
              <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Amenities not listed — shown just in case
              </span>
            </div>
          ) : null}

          {l.features.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {l.features.slice(0, 3).map((feature) => (
                <span
                  key={feature}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    feature === "Furnished"
                      ? "border-gold/50 bg-gold-fill/10 text-gold"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {feature}
                </span>
              ))}
              {l.features.length > 3 ? (
                <span className="text-[10px] text-muted-foreground">
                  +{l.features.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}
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

          <span
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Button size="sm" asChild>
              <Link href={analyzeHref(l)}>
                Run the numbers
              </Link>
            </Button>
          </span>
        </div>
      </div>
    );
  }
);
