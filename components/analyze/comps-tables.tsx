"use client";

/**
 * Lease evidence: the real rentals listed near this property, always
 * visible beneath the projection and never behind a click.
 *
 * EVERY ROW IS A LISTING SOMEBODY CAN OPEN. This table used to be
 * generated — six invented addresses at a jittered median, with a
 * random distance and a status rotating through "Active listing",
 * "Pending application", "Leased 34 days ago" — under a heading that
 * said what landlords are asking. It read exactly like six leases you
 * could go and check, and not one of them existed.
 *
 * There is no status column now because there is nothing to say: the
 * feed returns what is listed, so every row is active. A market with no
 * rentals on file shows the reason rather than a table.
 *
 * (STR comps live in comps-explorer.tsx with the hover-synced map.)
 */

import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { fmtMiles, fmtMoney, fmtNum } from "@/lib/format";
import {
  EVIDENCE_RADIUS_MILES,
  allSameSize,
  medianRent,
  type LeaseComp,
} from "@/lib/analyze/lease-evidence";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoHint } from "@/components/primitives/info-hint";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";

/** A field the feed did not state. Never a zero. */
const NONE = <span className="text-muted-foreground/60">—</span>;

function columnsFor(marketSlug: string): DataTableColumn<LeaseComp>[] {
  return [
  {
    key: "address",
    header: "Address",
    cell: (c) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-sans font-medium text-foreground">
          {c.address}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {c.city}, {c.stateCode}
          {c.zip ? ` ${c.zip}` : ""}
        </span>
      </span>
    ),
    sortValue: (c) => c.address,
    className: "w-full min-w-48 max-w-0",
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
    cell: (c) => (c.sqft === null ? NONE : fmtNum(c.sqft)),
    sortValue: (c) => c.sqft ?? -1,
  },
  {
    key: "distance",
    header: "Distance",
    align: "right",
    cell: (c) => fmtMiles(c.distanceMiles),
    sortValue: (c) => c.distanceMiles,
  },
  {
    key: "listed",
    header: "Listed",
    align: "right",
    cell: (c) =>
      c.daysOnMarket === null ? (
        NONE
      ) : (
        <span className="text-muted-foreground">
          {c.daysOnMarket === 0 ? "Today" : `${fmtNum(c.daysOnMarket)}d ago`}
        </span>
      ),
    sortValue: (c) => c.daysOnMarket ?? Number.MAX_SAFE_INTEGER,
  },
  {
    key: "open",
    header: "",
    align: "right",
    /**
     * Into our own Deal Finder, not out to whoever listed it.
     *
     * The row IS a rental this product holds, so the place to open it
     * is the screen built to read one — its panel, with the short-let
     * projection on it — rather than the portal's page, which has
     * everything except the thing somebody came here for.
     */
    cell: (c) => (
      <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]">
        <Link href={openHref(c, marketSlug)}>
          Open
          <ArrowUpRight aria-hidden className="size-3" />
        </Link>
      </Button>
    ),
    className: "min-w-20",
    },
  ];
}

/**
 * Where a lease comp opens.
 *
 * The panel only exists once its search has landed, so the link has to
 * carry one: the row's own ZIP where it has one, and the market it sits
 * in otherwise. A bare ?listing= would arrive at an empty grid with an
 * id nothing on the page matches.
 */
function openHref(c: LeaseComp, marketSlug: string): string {
  const where = c.zip ? `zip=${c.zip}` : `market=${marketSlug}`;
  return `/deals?${where}&listing=${encodeURIComponent(c.id)}`;
}

export function LtrCompsTable({
  comps,
  bedrooms,
  marketSlug,
  marketName,
}: {
  comps: LeaseComp[];
  /** The property's size, so the heading can say whether the rows
   *  actually match it. */
  bedrooms: number;
  marketSlug: string;
  marketName: string;
}) {
  const median = medianRent(comps);
  const exact = allSameSize(comps, bedrooms);

  return (
    <section aria-label="Lease evidence">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {comps.length > 0
              ? `Lease evidence — ${comps.length} rentals listed nearby`
              : "Lease evidence"}
            <InfoHint label="lease evidence">
              Rentals listed within {EVIDENCE_RADIUS_MILES} miles of this
              address, closest in size first and then closest in distance.
              Every row is a live listing you can open — nothing here is
              modelled.
            </InfoHint>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {comps.length === 0
              ? "What landlords are asking for comparable units on a 12-month lease."
              : exact
                ? `What landlords are asking right now for ${bedrooms}-bed units near here.`
                : "What landlords are asking right now near here — the closest sizes to this unit."}
          </p>
        </div>
        <MetricLabel className="hidden shrink-0 sm:block">Lease comps</MetricLabel>
      </div>

      {comps.length > 0 ? (
        <>
          <DataTable
            columns={columnsFor(marketSlug)}
            rows={comps}
            rowKey={(c) => c.id}
            initialSort={{ key: "distance", dir: "asc" }}
          />
          <p className="border-t border-border py-3 text-xs text-muted-foreground">
            Median asking rent:{" "}
            <span className="font-medium text-foreground tabular">
              {median === null ? "—" : fmtMoney(median)}
            </span>{" "}
            across these {comps.length}. Negotiate down from there.
          </p>
        </>
      ) : (
        <div className="py-10">
          <EmptyState
            icon={Search}
            title="No rentals on file near this address"
            description={`Lease evidence is the real rentals listed around a property, and none have been pulled for ${marketName} yet. Search the market in the Deal Finder and they appear here.`}
            action={
              <Button asChild size="sm" className="gap-1.5">
                <Link href={`/deals?market=${marketSlug}`}>
                  Rentals in {marketName}
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </Link>
              </Button>
            }
          />
        </div>
      )}
    </section>
  );
}
