"use client";

/**
 * Live comps, two ways at once: the ranked table and the street map,
 * hover-synced in both directions. The projection's assumptions are the
 * averages of exactly these rows — stated in the footer.
 */

import * as React from "react";
import { ArrowUpRight, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { compLinkNote, compListingUrl } from "@/lib/live/comp-links";
import {
  COMPS_RADIUS_MAX_MILES,
  deriveMarketAssumptions,
} from "@/lib/calc/comps";
import { fmtDate, fmtMiles, fmtMoney, fmtPct, fmtNum} from "@/lib/format";
import type { StrComp } from "@/lib/mock/types";
import type { CompsFallbackReason } from "@/lib/live/str-comps";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { InfoHint } from "@/components/primitives/info-hint";
import { HINTS } from "@/lib/copy/hints";
import { CompsStreetMap } from "./comps-street-map";
import { cn } from "@/lib/utils";

function strColumns(
  onStrike: ((id: string) => void) | undefined
): DataTableColumn<StrComp>[] {
  return [
  {
    key: "name",
    header: "Listing",
    cell: (c) => {
      const page = compListingUrl(c);
      // Why the arrow beside a name is missing, for anyone who hovers
      // it: dense rows have no room to print the reason, and a row
      // that silently lacks what fifteen others have reads as a bug.
      const note = compLinkNote(c);
      return (
        <span className="inline-flex max-w-full items-center gap-1.5">
          <span
            title={note ?? undefined}
            className={cn(
              "truncate font-sans font-medium text-foreground",
              note && "decoration-dotted underline-offset-4 [text-decoration-line:underline]"
            )}
          >
            {c.name}
          </span>
          {page ? (
            <a
              href={page}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${c.name} on Airbnb`}
              title="Open on Airbnb"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </span>
      );
    },
    sortValue: (c) => c.name,
    // The one column that gives. Every numeric column is as wide as
    // its header and no wider; this one takes whatever is left and
    // truncates the name into it. `max-w-0` is the table-layout idiom
    // that lets a cell shrink below its text (a cell's minimum is
    // otherwise its longest word), and `min-w-32` keeps it from
    // shrinking into nothing on a phone, where the table scrolls
    // sideways instead. Without this the table was as wide as its
    // longest row and the Distance column fell off the right edge.
    className: "w-full min-w-32 max-w-0",
  },
  {
    key: "bedrooms",
    header: "Beds",
    align: "right",
    cell: (c) => c.bedrooms,
    sortValue: (c) => c.bedrooms,
  },
  {
    key: "adr",
    header: "ADR",
    align: "right",
    cell: (c) => fmtMoney(c.adr),
    sortValue: (c) => c.adr,
  },
  {
    key: "occupancy",
    header: "Occupancy",
    align: "right",
    cell: (c) => fmtPct(c.occupancy),
    sortValue: (c) => c.occupancy,
  },
  {
    key: "annualRevenue",
    header: "Revenue/yr",
    align: "right",
    cell: (c) => fmtMoney(annualRevenueFromAdr(c.adr, c.occupancy)),
    sortValue: (c) => annualRevenueFromAdr(c.adr, c.occupancy),
  },
  {
    key: "distance",
    header: "Distance",
    align: "right",
    cell: (c) => fmtMiles(c.distanceMiles),
    sortValue: (c) => c.distanceMiles,
  },
  {
    /**
     * How many guests have actually stayed and said so.
     *
     * The rate and occupancy beside it come from a calendar read once;
     * this is the only column that says people have been through the
     * door. A comp with none is not necessarily dead — a new listing
     * takes bookings long before its first review — but it is the one
     * the reader should look at twice before letting it set their
     * number, and striking it is a click away in the next column.
     */
    key: "reviews",
    header: "Reviews",
    align: "right",
    cell: (c) =>
      typeof c.reviews !== "number" ? (
        <span className="text-muted-foreground/60">—</span>
      ) : c.reviews === 0 ? (
        <span className="text-muted-foreground">None</span>
      ) : (
        <span className="text-muted-foreground">{fmtNum(c.reviews)}</span>
      ),
    // Comps that never said sort last, rather than with the zeros:
    // "we did not ask" and "nobody stayed" are different answers.
    sortValue: (c) => (typeof c.reviews === "number" ? c.reviews : -1),
  },
  {
    key: "strike",
    header: <span className="sr-only">Remove</span>,
    align: "right",
    cell: (c) =>
      onStrike ? (
        <button
          type="button"
          aria-label={`Remove ${c.name} from the comp set`}
          title="Remove this comp — every figure above follows"
          onClick={(e) => {
            // The row itself docks the card on the map; this does not.
            e.stopPropagation();
            onStrike(c.id);
          }}
          className="rounded-sm p-1 text-muted-foreground opacity-60 transition-[color,opacity,background-color] duration-150 hover:bg-neg/10 hover:text-neg hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
      ) : null,
    className: "w-8",
  },
  ];
}

/** How far the set reaches: "within 1 mi" when it all sits inside a
 *  mile, "within 2 mi" inside two, and "nearby" for a set bought before
 *  the ceiling was set. */
function reachLabel(comps: readonly StrComp[]): string {
  if (comps.length === 0) return "nearby";
  const reach = Math.max(...comps.map((c) => c.distanceMiles));
  if (!Number.isFinite(reach)) return "nearby";
  if (reach <= 1) return "within 1 mi";
  if (reach <= 2) return "within 2 mi";
  return "nearby";
}

/**
 * Why there is a model here instead of listings, in one sentence.
 *
 * Every one of these used to be the same silent `liveComps: false`, so
 * the screen could say nothing — and said "Live comps" instead. The
 * reader is owed the difference between "your plan did not pay for
 * this" and "the feed is down": the first is a decision they can make,
 * the second is one they cannot.
 */
/**
 * The same reason, in two or three words, for the badge.
 *
 * On the badge because the sentence version lives in a paragraph that
 * gets skimmed: a member looking at a screen of invented listings
 * could not say WHY without being told where to look, and neither
 * could anybody helping them. The badge is the one element on this
 * header nobody misses.
 */
function reasonChip(reason: CompsFallbackReason | null | undefined): string {
  switch (reason) {
    case "not-paid":
      return "plan";
    case "not-configured":
      return "not set up";
    case "daily-cap":
      return "budget spent";
    case "thin-set":
      return "none nearby";
    case "vendor-key":
      return "key rejected";
    case "vendor-quota":
      return "out of credits";
    case "vendor-budget":
      return "daily brake";
    case "vendor":
      return "source down";
    case "no-point":
      return "no location";
    default:
      return "";
  }
}

function fallbackNote(reason: CompsFallbackReason | null | undefined): string {
  switch (reason) {
    case "not-paid":
      return "Your plan did not cover a live comp set for this one.";
    case "not-configured":
      return "Live comps are not configured on this deployment.";
    case "daily-cap":
      return "The day's live-comp budget is spent; try again tomorrow.";
    case "thin-set":
      return "Too few real listings were found nearby to stand a projection on.";
    case "vendor-key":
      return "The comp service rejected this deployment's key.";
    case "vendor-quota":
      return "The comp service says this account is out of credits.";
    case "vendor-budget":
      return "This deployment's own daily call brake (AIRROI_DAILY_CALLS) is stopping the call.";
    case "vendor":
      return "The live comp source could not be reached for this one.";
    case "no-point":
      return "This property has no coordinates to search around.";
    default:
      return "";
  }
}

export function CompsExplorer({
  comps,
  address,
  propertyPoint = null,
  marketCenter,
  live = false,
  thin = false,
  boughtAt = null,
  reason = null,
  onStrike,
  struckCount = 0,
  onRestore,
}: {
  comps: StrComp[];
  address: string;
  /** The property's own coordinates — where "Your property" is pinned.
   *  Every analysis of a real address has them; the comps were bought
   *  around this exact point, so the pin and the comps agree. */
  propertyPoint?: { lat: number; lon: number } | null;
  /** The market's centre: the fallback pin when a property has no
   *  coordinates of its own, and said to be that on screen. */
  marketCenter: { lat: number; lon: number } | null;
  /** True when these came from the live STR feed rather than the
   *  seeded preview set — the reader deserves to know which. */
  live?: boolean;
  /** Fewer real listings than a projection normally stands on. */
  thin?: boolean;
  /** When the set was read, ISO. Printed under the heading: these are
   *  real listings as they stood on a day, and one of them can be off
   *  the platform by the time somebody clicks it. */
  boughtAt?: string | null;
  /** Why the modelled set is standing in, when it is. */
  reason?: CompsFallbackReason | null;
  /** Strike a comp out of the set. Absent when the set is down to the
   *  last one every figure on the page divides by. */
  onStrike?: (id: string) => void;
  /** How many the reader has struck, so the footer can say so. */
  struckCount?: number;
  onRestore?: () => void;
}) {
  // A plain date, because fmtDate is handed bare YYYY-MM-DD across this
  // product and appends a time of its own to whatever it gets.
  const readOn = boughtAt ? fmtDate(boughtAt.slice(0, 10)) : null;
  const columns = React.useMemo(() => strColumns(onStrike), [onStrike]);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  /** The comp whose card is docked on the map — from a row or a pin. */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { adr, marketOccupancy } = deriveMarketAssumptions(comps);
  /**
   * Where "Your property" goes: the property's own coordinates — the
   * point the comps were bought around — and nothing else.
   *
   * An earlier version took the market centre and nudged it by a hash
   * of the analysis id, a leftover from seeded addresses that had no
   * real location and needed not to stack. For a real address that put
   * the diamond up to a mile from the house, beside comps whose
   * distances were measured from the house. The nudge is gone. Without
   * coordinates the pin sits at the market centre and the caption says
   * so; Orlando only as a last resort for an analysis whose market
   * record is missing.
   *
   * MEMOISED ON THE COORDINATES, NOT REBUILT PER RENDER. This object is
   * the map's anchor, and the map component (rightly) treats a new
   * anchor as a new map; a fresh object on every hover tore the map
   * down each time.
   */
  const exact = propertyPoint !== null;
  const subjectLat = propertyPoint?.lat ?? marketCenter?.lat ?? 28.54;
  const subjectLon = propertyPoint?.lon ?? marketCenter?.lon ?? -81.38;
  const subject = React.useMemo(
    () => ({ lat: subjectLat, lon: subjectLon }),
    [subjectLat, subjectLon]
  );

  return (
    <section aria-label="Short-term rental comps">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <div>
          {/* THE WORD "LIVE" IS A CLAIM, and it used to be printed
              whatever was underneath it. A modelled set rendered as
              "Live comps — 9 short-term rentals" over nine invented
              listings, contradicted only by a small badge to its right
              that is hidden below 640px. Somebody reading this screen on
              a phone had no way at all to know the listings were not
              real, and the two symptoms that make it obvious once you
              know — no cover photo, no working link — read as the
              product being broken rather than as the set being a model. */}
          <h2 className="text-sm font-semibold text-foreground">
            {live ? "Live comps" : "Modelled comps"} — {comps.length} short-term
            rentals {reachLabel(comps)}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {live ? (
              <>
                The projection above is computed from these listings, nothing
                else.
                {/* SAID, NOT SUBSTITUTED. A set this small used to be
                    thrown away and replaced by invented listings; the
                    honest answer is to show what is really there and
                    let the reader weigh it. */}
                {thin ? (
                  <>
                    {" "}
                    Only {comps.length} {comps.length === 1 ? "listing" : "listings"}{" "}
                    still listed within {COMPS_RADIUS_MAX_MILES} miles — thin
                    evidence, so weigh it accordingly.
                  </>
                ) : null}
                {/* The date, not a promise. A comp set is what was listed
                    on the day it was read; a host can take a listing down
                    the next morning, and the link below it then opens the
                    platform's own error page rather than the property. */}
                {readOn ? (
                  <> Read {readOn}; a listing can come down after that.</>
                ) : null}
              </>
            ) : (
              <>
                These are typical figures for this size in this market, not
                listings that exist. {fallbackNote(reason)} They carry no photo
                and no link because there is nothing to link to.
              </>
            )}
          </p>
        </div>
        {/* Shown at EVERY width now. The one case where the badge
            matters most — a modelled set — was the case it was hidden
            for on the screen most people read this on. */}
        {live ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-gold/50 bg-gold-fill/10 px-3 py-1 text-[11px] font-medium text-gold">
            <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
            Live comps
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <TriangleAlert aria-hidden className="size-3" strokeWidth={2.5} />
            Modelled
            {reasonChip(reason) ? (
              <span className="font-normal opacity-80">· {reasonChip(reason)}</span>
            ) : null}
          </span>
        )}
      </div>

      {/* Side by side from xl up, where the map takes 42% of the row
          and stays put while the table scrolls; stacked below that,
          each at full width, rather than squeezed into two columns
          neither could fill. */}
      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,42%)]">
        <div className="min-w-0">
          {/* Rows are the pins' twins: hovering one fills it the pins'
              red and lifts the pin; clicking docks that comp's card on
              the map. Styles for .comp-row live in globals.css. */}
          <DataTable
            columns={columns}
            rows={comps}
            rowKey={(c) => c.id}
            initialSort={{ key: "distance", dir: "asc" }}
            onRowHover={(row) => setHoveredId(row?.id ?? null)}
            onRowClick={(row) =>
              setSelectedId((prev) => (prev === row.id ? null : row.id))
            }
            rowClassName={(row) =>
              cn(
                "comp-row",
                (hoveredId === row.id || selectedId === row.id) && "is-hot",
                selectedId === row.id && "is-selected"
              )
            }
          />
          <p className="flex flex-wrap items-center gap-x-1 border-t border-border py-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              Comp average
              <InfoHint label="the comp average">{HINTS.compAverage}</InfoHint>
            </span>
            :{" "}
            <span className="font-medium text-foreground tabular">
              {fmtMoney(adr)}
            </span>{" "}
            ADR at{" "}
            <span className="font-medium text-foreground tabular">
              {fmtPct(marketOccupancy)}
            </span>{" "}
            occupancy — exactly the assumptions the projection uses.
          </p>
          {/* What was struck, and the way back. Said here rather than
              left to the comp count changing, because a figure that
              moved and a set that shrank are the same event and the
              reader should be able to undo it in one click. */}
          {struckCount > 0 ? (
            <p className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pb-3 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground tabular">{struckCount}</span>{" "}
                {struckCount === 1 ? "comp" : "comps"} removed from this reading.
              </span>
              {onRestore ? (
                <button
                  type="button"
                  onClick={onRestore}
                  className="inline-flex items-center gap-1 font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
                >
                  <RotateCcw aria-hidden className="size-3" />
                  Put them back
                </button>
              ) : null}
            </p>
          ) : null}
        </div>

        <CompsStreetMap
          comps={comps}
          subject={subject}
          subjectExact={exact}
          subjectLabel={`Your property — ${address}`}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          selectedId={selectedId}
          onSelect={setSelectedId}
          className="xl:sticky xl:top-24 xl:self-start"
        />
      </div>
    </section>
  );
}
