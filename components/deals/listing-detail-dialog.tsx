"use client";

/**
 * The listing overlay: a stack of panels over a blurred Deal Finder, so
 * the search stays visible behind the property you're judging. Click a
 * price pill or a card to open it; the X (or Escape, or the backdrop)
 * returns you to the search exactly where you left it.
 *
 * SEPARATION COMES FROM SURFACES, NOT HAIRLINES. In light mode the
 * canvas, the card and the border sit within a few percent of each
 * other, so an overlay built from 1px rules on one flat sheet has
 * nothing for the eye to catch: every section blends into the next.
 * Here the overlay's own ground is the grey canvas and each concern is
 * a white panel floating on it — identity, the deal, who to call.
 * Three tones and a shadow do the work six invisible rules were
 * failing to do.
 *
 * The order is the order of the decision: what is it, does it pencil,
 * who do I call. Every figure comes through lib/calc with the same
 * benchmark inputs the cards use, so nothing here can disagree with
 * the grid behind it. The market's own figures are not restated here —
 * the line under the deal heading says which market's ADR and
 * occupancy the projection stands on, and that is the only claim about
 * a market this panel needs to make.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Mail, Phone, TriangleAlert, User, X } from "lucide-react";
import { projectDeal } from "@/lib/calc/arbitrage";
import { fmtMoney, fmtMonth, fmtNum, fmtPct, localityLine } from "@/lib/format";
import { benchmark2brInputs } from "@/lib/mock/markets";
import { basisLabel, estimateDeal, type DealRead } from "@/lib/mock/rentals";
import type { Market, RentalListing } from "@/lib/mock/types";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddToListMenu } from "./add-to-list-menu";
import { PhoneLookup } from "./phone-lookup";
import { PhotosLink } from "./photos-link";
import { PropertyImage } from "./property-image";
import { analyzeHref } from "@/lib/live/analyze-href";
import { hasOwnListingPage, webLookupHref } from "@/lib/live/listing-links";
import { useListingContact } from "./use-listing-contact";
import { usePropertyFigures } from "./use-property-figures";
import { cn } from "@/lib/utils";

/**
 * The line under "If you ran this as a short-term rental": what the
 * figures stand on, in the reader's terms. Never a blend, always said.
 */
function basisLine(read: DealRead, bedrooms: number, marketName: string): string {
  const b = read.basis;
  const occ = `${fmtPct(b.occupancy)} occupancy`;
  const rate = `${fmtMoney(read.nightlyRate)}/night`;
  const when = b.at ? ` ${fmtMonth(b.at)}` : "";
  switch (b.kind) {
    case "comps":
      return `This property's own comps${b.comps ? ` · ${b.comps} listings` : ""} · ${occ} · ${rate}`;
    case "zip":
      return `ZIP ${b.area ?? ""} · ${occ} · ${rate} for a ${bedrooms} bd · measured${when}`;
    case "city":
      return `${b.area ?? marketName} · ${occ} · ${rate} for a ${bedrooms} bd · measured${when}`;
    case "pending":
      return `${marketName} · measuring…`;
    default:
      return `${marketName} · ${occ} · ${rate} for a ${bedrooms} bd · modelled`;
  }
}

/** One white surface on the overlay's grey ground. */
function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-sm border border-border bg-card elev-panel",
        className
      )}
      {...props}
    />
  );
}

/**
 * One figure in the deal panel.
 *
 * Label beside the value on a phone and stacked above it on a desktop:
 * three stat blocks at 375px are three-quarters whitespace, and the
 * same three at 700px want the vertical rhythm.
 */
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
    // Centred in its cell, because the cushion column beside these is
    // taller than they are and left them stranded at the top of a tall
    // white box.
    <div className="flex flex-col justify-center px-5 py-3.5 sm:py-4">
      <div className="flex items-baseline justify-between gap-3 sm:block">
        <MetricLabel>{label}</MetricLabel>
        <p
          className={cn(
            "text-lg font-semibold tabular sm:mt-1.5 sm:text-xl",
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
      {sub ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The cushion, drawn: the bar is the share of nights that only pays the
 * costs, the tick is where the market actually runs, and the gap between
 * them is the number printed above. The figures are stated in words
 * either side, so the picture is a second reading of the same fact and
 * never the only one.
 */
function CushionMeter({
  breakeven,
  occupancy,
}: {
  breakeven: number;
  occupancy: number;
}) {
  // A deal that never breaks even has an infinite breakeven; draw it as
  // a full bar rather than dropping the picture entirely.
  const clamp = (n: number) =>
    Math.min(Math.max(Number.isFinite(n) ? n : 1, 0), 1);
  const be = clamp(breakeven);
  const occ = clamp(occupancy);
  const clears = Number.isFinite(breakeven) && occupancy > breakeven;

  return (
    <div
      role="img"
      aria-label={`Breakeven ${fmtPct(breakeven)} of nights against a market running ${fmtPct(occupancy)}`}
    >
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary" />
        <div
          className={cn(
            "absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-[width] duration-500",
            clears ? "bg-gold/70" : "bg-neg/70"
          )}
          style={{ width: `${be * 100}%` }}
        />
        <span
          aria-hidden
          className="absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${occ * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        <span>Breakeven {fmtPct(breakeven)}</span>
        <span>Market {fmtPct(occupancy)}</span>
      </div>
    </div>
  );
}

/** A contact row with its icon in a quiet disc, so the column scans. */
function ContactRow({
  icon: Icon,
  children,
  href,
}: {
  icon: typeof User;
  children: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
  return href ? (
    <a
      href={href}
      className="flex items-center gap-2.5 text-sm text-foreground transition-colors duration-150 hover:text-gold"
    >
      {body}
    </a>
  ) : (
    <div className="flex items-center gap-2.5 text-sm text-foreground">
      {body}
    </div>
  );
}

export function ListingDetailDialog({
  listing,
  market,
  deal = null,
  open,
  onOpenChange,
}: {
  listing: RentalListing | null;
  market: Market | null;
  /** The row's read from the grid, so the panel shows the same numbers
   *  the card did — and the same grain. */
  deal?: DealRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // The property's own comps when an analysis has been run — the
  // analyzer's exact figures — otherwise the grain the row was
  // projected from on the grid. Never a blend; the line under the
  // heading says which. See lib/live/property-figures.
  const own = usePropertyFigures(listing, open);
  const read = React.useMemo<DealRead | null>(() => {
    if (!listing || !market) return null;
    if (own.figures) {
      return estimateDeal(listing, market, {
        adr: own.figures.adr,
        occupancy: own.figures.occupancy,
        kind: "comps",
        area: null,
        at: own.figures.at,
        comps: own.figures.comps,
      });
    }
    return deal ?? estimateDeal(listing, market);
  }, [listing, market, deal, own.figures]);
  const projection = React.useMemo(() => {
    if (!listing || !read) return null;
    return projectDeal(benchmark2brInputs(listing.rentMonthly), {
      adr: read.nightlyRate,
      marketOccupancy: read.basis.occupancy,
    });
  }, [listing, read]);

  const cushionPts = projection
    ? Math.round(projection.marginOfSafety * 100)
    : 0;
  const short = cushionPts < 0;
  const isLive = listing?.id.startsWith("live--") ?? false;
  // The feed's own contact when it has one, otherwise the listing page's
  // — read on open, because reading a page costs money and a property
  // nobody looked at must not spend any.
  const looked = useListingContact(listing, open);
  const contact = listing?.contact ?? looked.contact;
  // The page the contact lookup found, when the row arrived without
  // one — so "View photos" opens the property too.
  const pageFound = looked.page ?? undefined;
  const locality = listing
    ? localityLine(
        listing.address,
        listing.city,
        listing.stateCode,
        listing.submarketName
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-3xl"
      >
        {/* Its own disc rather than a bare glyph: at the top of a white
            panel a naked X has no edge to aim at. */}
        <DialogClose className="absolute right-3.5 top-3.5 z-20 inline-flex size-8 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-xs transition-colors duration-150 hover:bg-secondary hover:text-foreground">
          <X aria-hidden className="size-4" />
          <span className="sr-only">Close</span>
        </DialogClose>

        {listing && market && projection ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            {/* ---------------------------------------------------- */}
            {/* What it is                                            */}
            {/* ---------------------------------------------------- */}
            <Panel>
              <div className="p-4 sm:p-5">
                <div className="flex gap-4 sm:gap-5">
                  {/* The kerb or the roof, never the listing's own
                      photos — those live on the source's page, one
                      click away below. A column beside the facts rather
                      than a band across the top: on the sketch, that
                      band was two hundred pixels of nothing above the
                      price. */}
                  <PropertyImage
                    listing={listing}
                    priority
                    className="size-20 shrink-0 rounded-sm border border-border sm:h-auto sm:w-36 sm:self-stretch"
                  />

                  <div className="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-3 pr-9 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      {listing.daysOnMarket !== undefined &&
                      listing.daysOnMarket < 5 ? (
                        <StatusChip tone="gold" className="mb-1.5">
                          {listing.daysOnMarket === 0
                            ? "Listed today"
                            : `New · ${listing.daysOnMarket}d`}
                        </StatusChip>
                      ) : null}

                      <DialogTitle className="font-display text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
                        {listing.address}
                      </DialogTitle>

                      {locality ? (
                        <DialogDescription className="mt-1 text-sm">
                          {locality}
                        </DialogDescription>
                      ) : (
                        <DialogDescription className="sr-only">
                          {listing.city}, {listing.stateCode}
                        </DialogDescription>
                      )}

                      <p className="mt-2 text-xs text-muted-foreground tabular">
                        {listing.bedrooms} bd · {listing.bathrooms} ba
                        {listing.sqft > 0
                          ? ` · ${fmtNum(listing.sqft)} sqft`
                          : ""}
                        {listing.daysOnMarket === undefined
                          ? " · listed date not published"
                          : listing.daysOnMarket >= 5
                            ? ` · ${listing.daysOnMarket} days on market`
                            : ""}
                      </p>
                    </div>

                    {/* Opposite the address rather than under it. The
                        rent is the other half of the headline, and
                        stacked under a two-line address it left the
                        right half of the panel empty. */}
                    <div className="shrink-0 sm:text-right">
                      <p className="text-2xl font-semibold text-foreground tabular sm:text-3xl">
                        {fmtMoney(listing.rentMonthly)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        per month asking
                      </p>
                    </div>
                  </div>
                </div>

                {/* Full width, under both columns: in the text column
                    these wrapped one chip per line on a phone.
                    Furnished reads gold — it can zero the furnishing
                    budget, so it is the tag operators hunt. */}
                {listing.features.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {listing.features.map((f) => (
                      <span
                        key={f}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          f === "Furnished"
                            ? "border-gold/50 bg-gold-fill/12 text-gold"
                            : "border-border bg-secondary/70 text-muted-foreground"
                        )}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/50 px-4 py-3 sm:px-5">
                <AddToListMenu listing={listing} />
                <Button variant="outline" size="sm" asChild>
                  <Link href={analyzeHref(listing)} target="_blank" rel="noopener">
                    Run the numbers
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </Button>
                <PhotosLink
                  place={{ ...listing, sourceUrl: listing.sourceUrl ?? pageFound }}
                  real={isLive}
                  // The contact lookup above is finding the page for a
                  // row that has none; a click meanwhile waits for it.
                  pending={looked.status === "loading"}
                />
              </div>
            </Panel>

            {/* ---------------------------------------------------- */}
            {/* Does it pencil                                        */}
            {/* ---------------------------------------------------- */}
            <Panel>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border bg-secondary/50 px-4 py-3 sm:px-5">
                <h3 className="text-sm font-semibold text-foreground">
                  If you ran this as a short-term rental
                </h3>
                <p
                  className="text-xs text-muted-foreground tabular"
                  title={read ? basisLabel(read.basis) : undefined}
                >
                  {read ? basisLine(read, listing.bedrooms, market.name) : null}
                </p>
              </div>

              <div className="grid sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)]">
                {/* The headline. Tinted rather than merely bigger: on a
                    white panel size alone does not say "read this one
                    first". */}
                <div
                  className={cn(
                    "border-b border-border p-4 sm:border-b-0 sm:border-r sm:p-5",
                    short ? "bg-neg/[0.06]" : "bg-gold-fill/[0.08]"
                  )}
                >
                  <MetricLabel>Cushion</MetricLabel>
                  <p
                    className={cn(
                      "mt-1 font-display text-3xl font-semibold tracking-tight tabular sm:text-4xl",
                      short ? "text-neg" : "text-gold"
                    )}
                  >
                    {short ? "−" : "+"}
                    {Math.abs(cushionPts)}
                    <span className="ml-1 text-lg font-normal sm:text-xl">
                      pts
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Occupancy − breakeven
                  </p>
                  <div className="mt-4">
                    <CushionMeter
                      breakeven={projection.breakevenOccupancy}
                      occupancy={market.occupancy}
                    />
                  </div>
                </div>

                <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  <Figure
                    label="Breakeven"
                    value={fmtPct(projection.breakevenOccupancy)}
                    sub="Nights to cover costs"
                  />
                  <Figure
                    label="Cash flow"
                    value={`${fmtMoney(Math.round(projection.netCashFlow))}/mo`}
                    sub={`${fmtMoney(Math.round(projection.monthlyRevenue))} revenue − ${fmtMoney(Math.round(projection.monthlyCosts))} costs`}
                    tone={projection.netCashFlow < 0 ? "bad" : "good"}
                  />
                  <Figure
                    label="Startup"
                    value={fmtMoney(Math.round(projection.startupCapital))}
                    sub="Deposit + first month"
                  />
                </div>
              </div>

              {short ? (
                <p className="flex items-start gap-2 border-t border-border bg-neg/[0.07] px-4 py-2.5 text-xs text-neg sm:px-5">
                  <TriangleAlert
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  At this rent the market&apos;s occupancy doesn&apos;t clear
                  the lease. Negotiate the rent down or pass.
                </p>
              ) : null}
            </Panel>

            {/* ---------------------------------------------------- */}
            {/* Who to call                                           */}
            {/* ---------------------------------------------------- */}
            {/* Full width, and the details laid out across it rather
                than stacked in a column: this used to be half of a
                two-up row beside a market panel, and on its own that
                column left the right half of the overlay empty. */}
            <Panel className="p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <MetricLabel>{contact?.role ?? "Contact"}</MetricLabel>
                {!isLive ? <StatusChip tone="neutral">Preview</StatusChip> : null}
              </div>

              {contact ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7">
                  {/* A page routinely gives a number and no name. Show
                      the row only when there is somebody to name —
                      an empty one reads as a name we failed to load. */}
                  {contact.name || contact.company ? (
                    <ContactRow icon={User}>
                      {contact.name ? (
                        <span className="font-medium">{contact.name}</span>
                      ) : null}
                      {contact.company ? (
                        <span
                          className={
                            contact.name ? "text-muted-foreground" : "font-medium"
                          }
                        >
                          {contact.name ? " · " : ""}
                          {contact.company}
                        </span>
                      ) : null}
                    </ContactRow>
                  ) : null}
                  {contact.phone ? (
                    <ContactRow
                      icon={Phone}
                      href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    >
                      <span className="tabular">{contact.phone}</span>
                    </ContactRow>
                  ) : null}
                  {contact.email ? (
                    <ContactRow icon={Mail} href={`mailto:${contact.email}`}>
                      {contact.email}
                    </ContactRow>
                  ) : null}
                </div>
              ) : looked.status === "loading" ? (
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  Checking the listing for contact details…
                </p>
              ) : (
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  {/* Three different facts, and they must not read the
                      same. "Couldn't read it" is not "there is none",
                      and sending somebody away from a number that
                      exists is the failure that matters here. */}
                  {!isLive
                    ? "Preview inventory carries no contact details."
                    : looked.status === "unreadable"
                      ? "Couldn't read this listing's page just now."
                      : looked.status === "no-page"
                        ? "This property isn't on the listing site contacts are read from."
                        : "This listing's page publishes no contact details."}
                  {hasOwnListingPage({ ...listing, sourceUrl: listing.sourceUrl ?? pageFound }) &&
                  looked.status !== "none"
                    ? " The listing page behind View photos may have them."
                    : ""}
                </p>
              )}
              {/* Only when the listing site gave no number — none on
                  file, a page that could not be read, or one that
                  publishes none. Two ways on from there: a deep lookup
                  of public records for the owner's number (credits,
                  charged only when one comes back), and a web search
                  for the rental, typed out, since the reader was about
                  to type it anyway. */}
              {isLive && !contact?.phone && looked.status !== "loading" && looked.status !== "idle" ? (
                <div className="mt-3 flex flex-col gap-3">
                  <PhoneLookup listing={listing} />
                  {(() => {
                    const href = webLookupHref(listing);
                    return href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Searches the web for this rental, where a contact is often posted"
                        className="inline-flex h-8 w-fit items-center gap-1 rounded-sm border border-border px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary/60"
                      >
                        Web lookup
                        <ArrowUpRight aria-hidden className="size-3.5" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : null;
                  })()}
                </div>
              ) : null}
            </Panel>

            {/* Seeded inventory only. A live row's description is the
                source's own prose, which this product does not
                republish — the flags are mined from it and the text is
                dropped. */}
            {!isLive && listing.description ? (
              <Panel className="p-4 sm:p-5">
                <MetricLabel>About this unit</MetricLabel>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {listing.description}
                </p>
              </Panel>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
