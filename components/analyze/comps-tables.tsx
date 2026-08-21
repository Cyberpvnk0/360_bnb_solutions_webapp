"use client";

/**
 * Lease evidence: the long-term rental comps behind the rent estimate,
 * always visible beneath the projection, never behind a click. The
 * footer states the exact figure the calculator starts from.
 * (STR comps live in comps-explorer.tsx with the hover-synced map.)
 */

import { estimateRentFromComps } from "@/lib/calc/comps";
import { fmtMiles, fmtMoney } from "@/lib/format";
import type { LtrComp } from "@/lib/mock/types";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { MetricLabel } from "@/components/primitives/metric-label";

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
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
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
      <p className="border-t border-border py-3 text-xs text-muted-foreground">
        Median asking rent:{" "}
        <span className="font-medium text-foreground tabular">{fmtMoney(median)}</span>{" "}
        — the calculator&apos;s starting lease. Negotiate down from there.
      </p>
    </section>
  );
}
