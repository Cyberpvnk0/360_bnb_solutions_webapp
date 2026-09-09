"use client";

/**
 * Out to the page where the pictures already live.
 *
 * We host no listing imagery at all. The card's picture is a Street
 * View or an aerial of the kerb; the interiors live on the listing
 * site, and this sends people there rather than copying anything here.
 *
 * ONE LABEL, TWO DESTINATIONS. When the row carries its own listing URL
 * this opens that property; when it doesn't, lib/live/listing-links
 * falls back to a site-scoped search that finds it — and on a surface
 * that shows one property, `find` asks the listing site for the page
 * by address in the background and upgrades the link when it lands.
 * Both say
 * "View photos", because the button is named for what the reader is
 * after rather than for our plumbing, and a label that changes under
 * them is its own kind of noise. The hover title still says which one
 * it is, so the difference is available without being shouted.
 *
 * One component for all three surfaces, because the rule about WHEN to
 * show it is the interesting part and it should exist once:
 *
 *   - a real address, or nothing. Seeded preview inventory has
 *     plausible addresses for buildings that do not exist, and a search
 *     for one lands on a stranger's house.
 *   - a link, never an embed. Framing someone's photos inside our
 *     chrome is the thing a link is specifically not.
 *
 * The label says what the reader gets rather than where they are going,
 * and the arrow says they are leaving. Screen readers get the off-site
 * part in words, since they cannot see the arrow.
 */

import { ArrowUpRight, Loader2 } from "lucide-react";
import {
  findingHref,
  hasOwnListingPage,
  photosLink,
  type PhotosDestination,
  type Addressed,
} from "@/lib/live/listing-links";
import { cn } from "@/lib/utils";
import { useListingPage } from "./use-listing-page";

export function PhotosLink({
  place,
  /** False for seeded preview rows — their addresses are generated. */
  real,
  /**
   * True on a surface that shows ONE property: a row without a page
   * asks the listing site for it by address, and the link becomes the
   * listing when the answer lands. Never on a grid — the lookup is a
   * billed request per address.
   */
  find = false,
  /**
   * True while something else on the surface is finding the page (the
   * detail panel's contact lookup does): the link waits for it the
   * same way, without asking a second time.
   */
  pending = false,
  className,
  variant = "button",
}: {
  place: Addressed;
  real: boolean;
  find?: boolean;
  pending?: boolean;
  className?: string;
  /**
   * "button" for an action row, "pill" for an overlay on an image,
   * "chip" for a quiet inline one on a page surface.
   */
  variant?: "button" | "pill" | "chip";
}) {
  const looked = useListingPage(place, find && real && !hasOwnListingPage(place));
  let dest: PhotosDestination | null = real
    ? photosLink(
        looked.page ? { ...place, sourceUrl: looked.page } : place
      )
    : null;
  // While the page is being found, a click goes through the finder
  // page — which opens at once and lands on the listing when the
  // answer comes — rather than to a search because it came early. A
  // lookup that answered "no page" is a search, honestly.
  if (dest?.kind === "search" && (looked.status === "looking" || pending)) {
    const finding = findingHref(place);
    if (finding) dest = { href: finding, kind: "finding" };
  }
  if (!dest) return null;

  const onListing = dest.kind === "listing";
  const finding = dest.kind === "finding";

  return (
    <a
      href={dest.href}
      target="_blank"
      rel="noopener noreferrer"
      title={
        onListing
          ? "Opens this property's listing page"
          : finding
            ? "Opens this property's listing page — finding it now"
            : "Searches the listing sites for this exact address"
      }
      // Cards open a detail panel on click; this must not do both.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-medium transition-colors duration-150",
        variant === "button" &&
          "h-8 rounded-sm border border-border px-3 text-sm text-foreground hover:bg-secondary/60",
        variant === "pill" &&
          "rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white backdrop-blur-[2px] hover:bg-black/70",
        variant === "chip" &&
          "rounded-full border border-border bg-secondary px-3 py-1 text-xs text-foreground hover:bg-secondary/70",
        className
      )}
    >
      View photos
      {finding ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <ArrowUpRight aria-hidden className="size-3.5" />
      )}
      {/* The same words a sighted reader gets. A screen reader saying
          something the button does not say is a second label, not a
          better one. */}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
