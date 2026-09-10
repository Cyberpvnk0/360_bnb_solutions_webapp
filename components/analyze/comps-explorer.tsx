"use client";

/**
 * Live comps, two ways at once: the ranked table and the street map,
 * hover-synced in both directions. The projection's assumptions are the
 * averages of exactly these rows — stated in the footer.
 */

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { compListingUrl } from "@/lib/live/comp-links";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { fmtMiles, fmtMoney, fmtPct } from "@/lib/format";
import type { StrComp } from "@/lib/mock/types";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { MetricLabel } from "@/components/primitives/metric-label";
import { CompsStreetMap } from "./comps-street-map";
import { cn } from "@/lib/utils";

const STR_COLUMNS: DataTableColumn<StrComp>[] = [
  {
    key: "name",
    header: "Listing",
    cell: (c) => {
      const page = compListingUrl(c);
      return (
        <span className="inline-flex max-w-full items-center gap-1.5">
          <span className="truncate font-sans font-medium text-foreground">{c.name}</span>
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
];

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

export function CompsExplorer({
  comps,
  address,
  propertyPoint = null,
  marketCenter,
  live = false,
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
}) {
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
          <h2 className="text-sm font-semibold text-foreground">
            Live comps — {comps.length} short-term rentals {reachLabel(comps)}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The projection above is computed from these listings, nothing else.
          </p>
        </div>
        {live ? (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-gold/50 bg-gold-fill/10 px-3 py-1 text-[11px] font-medium text-gold sm:flex">
            <span aria-hidden className="size-1.5 rounded-full bg-gold-fill" />
            Live comps
          </span>
        ) : (
          <MetricLabel className="hidden shrink-0 sm:block">
            Preview comps
          </MetricLabel>
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
            columns={STR_COLUMNS}
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
          <p className="border-t border-border py-3 text-xs text-muted-foreground">
            Comp average:{" "}
            <span className="font-medium text-foreground tabular">
              {fmtMoney(adr)}
            </span>{" "}
            ADR at{" "}
            <span className="font-medium text-foreground tabular">
              {fmtPct(marketOccupancy)}
            </span>{" "}
            occupancy — exactly the assumptions the projection uses.
          </p>
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
