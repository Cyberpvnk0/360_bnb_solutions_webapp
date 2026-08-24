"use client";

/**
 * Live comps, two ways at once: the ranked table and the street map,
 * hover-synced in both directions. The projection's assumptions are the
 * averages of exactly these rows — stated in the footer.
 */

import * as React from "react";
import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions } from "@/lib/calc/comps";
import { fmtMiles, fmtMoney, fmtPct } from "@/lib/format";
import type { StrComp } from "@/lib/mock/types";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { MetricLabel } from "@/components/primitives/metric-label";
import { CompsStreetMap, subjectPoint } from "./comps-street-map";

const STR_COLUMNS: DataTableColumn<StrComp>[] = [
  {
    key: "name",
    header: "Listing",
    cell: (c) => (
      <span className="font-sans font-medium text-foreground">{c.name}</span>
    ),
    sortValue: (c) => c.name,
    className: "max-w-56 truncate",
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
    header: "Annual revenue",
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

export function CompsExplorer({
  comps,
  analysisId,
  address,
  marketCenter,
  live = false,
}: {
  comps: StrComp[];
  analysisId: string;
  address: string;
  marketCenter: { lat: number; lon: number } | null;
  /** True when these came from the live STR feed rather than the
   *  seeded preview set — the reader deserves to know which. */
  live?: boolean;
}) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const { adr, marketOccupancy } = deriveMarketAssumptions(comps);
  // Anchor the map near the market center; Orlando only as a last-resort
  // fallback for an analysis whose market record is missing.
  const subject = subjectPoint(
    marketCenter ?? { lat: 28.54, lon: -81.38 },
    analysisId
  );

  return (
    <section aria-label="Short-term rental comps">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Live comps — {comps.length} short-term rentals nearby
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

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <DataTable
            columns={STR_COLUMNS}
            rows={comps}
            rowKey={(c) => c.id}
            initialSort={{ key: "distance", dir: "asc" }}
            onRowHover={(row) => setHoveredId(row?.id ?? null)}
            rowClassName={(row) =>
              hoveredId === row.id ? "bg-secondary/60" : undefined
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
          subjectLabel={`Your property — ${address}`}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          className="lg:sticky lg:top-24 lg:self-start"
        />
      </div>
    </section>
  );
}
