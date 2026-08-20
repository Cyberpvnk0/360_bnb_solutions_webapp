"use client";

/**
 * The evidence layer: comps are always visible directly beneath the
 * projected numbers, never behind a click. The footer of each table states
 * the exact figure the projection uses, derived from these same rows.
 */

import { annualRevenueFromAdr } from "@/lib/calc/arbitrage";
import { deriveMarketAssumptions, estimateRentFromComps } from "@/lib/calc/comps";
import { fmtMiles, fmtMoney, fmtPct } from "@/lib/format";
import type { LtrComp, StrComp } from "@/lib/mock/types";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { MetricLabel } from "@/components/primitives/metric-label";

const STR_COLUMNS: DataTableColumn<StrComp>[] = [
  {
    key: "name",
    header: "Listing",
    cell: (c) => (
      <span className="font-sans font-medium text-foreground">{c.name}</span>
    ),
    sortValue: (c) => c.name,
    className: "max-w-64 truncate",
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

export function StrCompsTable({ comps }: { comps: StrComp[] }) {
  const { adr, marketOccupancy } = deriveMarketAssumptions(comps);
  return (
    <section aria-label="Short-term rental comps">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Revenue evidence — {comps.length} nearby short-term rentals
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The projection above is computed from these listings, nothing else.
          </p>
        </div>
        <MetricLabel className="hidden shrink-0 sm:block">STR comps</MetricLabel>
      </div>
      <DataTable
        columns={STR_COLUMNS}
        rows={comps}
        rowKey={(c) => c.id}
        initialSort={{ key: "distance", dir: "asc" }}
      />
      <p className="border-t border-border py-2 text-xs text-muted-foreground">
        Comp average:{" "}
        <span className="font-medium text-foreground tabular">{fmtMoney(adr)}</span>{" "}
        ADR at{" "}
        <span className="font-medium text-foreground tabular">
          {fmtPct(marketOccupancy)}
        </span>{" "}
        occupancy — exactly the assumptions the projection uses.
      </p>
    </section>
  );
}

const LTR_COLUMNS: DataTableColumn<LtrComp>[] = [
  {
    key: "address",
    header: "Address",
    cell: (c) => (
      <span className="font-sans font-medium text-foreground">{c.address}</span>
    ),
    sortValue: (c) => c.address,
    className: "max-w-72 truncate",
  },
  {
    key: "beds",
    header: "Beds / Baths",
    align: "right",
    cell: (c) => `${c.bedrooms} / ${c.bathrooms}`,
    sortValue: (c) => c.bedrooms,
  },
  {
    key: "rent",
    header: "Asking rent",
    align: "right",
    cell: (c) => fmtMoney(c.rent),
    sortValue: (c) => c.rent,
  },
  {
    key: "sqft",
    header: "Sq ft",
    align: "right",
    cell: (c) => c.sqft.toLocaleString("en-US"),
    sortValue: (c) => c.sqft,
  },
  {
    key: "distance",
    header: "Distance",
    align: "right",
    cell: (c) => fmtMiles(c.distanceMiles),
    sortValue: (c) => c.distanceMiles,
  },
  {
    key: "status",
    header: "Status",
    cell: (c) => <span className="text-muted-foreground">{c.status}</span>,
  },
];

export function LtrCompsTable({ comps }: { comps: LtrComp[] }) {
  const median = estimateRentFromComps(comps);
  return (
    <section aria-label="Long-term rental comps">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Lease evidence — {comps.length} long-term rentals nearby
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What landlords are asking for comparable units on a 12-month lease.
          </p>
        </div>
        <MetricLabel className="hidden shrink-0 sm:block">Lease comps</MetricLabel>
      </div>
      <DataTable
        columns={LTR_COLUMNS}
        rows={comps}
        rowKey={(c) => c.id}
        initialSort={{ key: "distance", dir: "asc" }}
      />
      <p className="border-t border-border py-2 text-xs text-muted-foreground">
        Median asking rent:{" "}
        <span className="font-medium text-foreground tabular">{fmtMoney(median)}</span>{" "}
        — the calculator&apos;s starting lease. Negotiate down from there.
      </p>
    </section>
  );
}
