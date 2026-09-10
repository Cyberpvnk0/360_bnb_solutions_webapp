"use client";

/**
 * The rental lists, in full. Deal Finder shows a list as a chip that
 * filters the grid; this is where a list is read as a list — every
 * saved rental with its rent, size and market, a way back to its
 * numbers, and the list's own controls: rename, export, delete.
 *
 * Rows are the rental AS IT WAS SAVED. The live feed rolls daily and a
 * listing can be gone next week; the snapshot is what the person
 * shortlisted, and the analyzer link re-runs it at that rent.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  FileDown,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "@/lib/export/csv";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { analyzeHref } from "@/lib/live/analyze-href";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { DealList, RentalListing } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<RentalListing["propertyType"], string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhome: "Townhome",
};

function marketName(slug: string): string {
  const m = MARKET_BY_SLUG.get(slug);
  return m ? `${m.name}, ${m.stateCode}` : slug;
}

/** The unit's town, and the market it sits in when that is somewhere
 *  else — "Jacksonville, FL · Jacksonville, FL" said nothing twice. */
function placeLine(l: RentalListing): string {
  const town = `${l.city}, ${l.stateCode}`;
  const market = marketName(l.marketSlug);
  return market.toLowerCase() === town.toLowerCase() ? town : `${town} · ${market}`;
}

const COLUMNS: CsvColumn<RentalListing>[] = [
  { header: "Address", value: (l) => l.address },
  { header: "City", value: (l) => l.city },
  { header: "State", value: (l) => l.stateCode },
  { header: "Market", value: (l) => marketName(l.marketSlug) },
  { header: "Type", value: (l) => TYPE_LABEL[l.propertyType] },
  { header: "Bedrooms", value: (l) => l.bedrooms },
  { header: "Bathrooms", value: (l) => l.bathrooms },
  { header: "Sq ft", value: (l) => l.sqft || "" },
  { header: "Asking rent / mo ($)", value: (l) => l.rentMonthly },
  { header: "Contact", value: (l) => l.contact?.name ?? "" },
  { header: "Contact phone", value: (l) => l.contact?.phone ?? "" },
  { header: "Contact email", value: (l) => l.contact?.email ?? "" },
  { header: "Listing page", value: (l) => l.sourceUrl ?? "" },
];

function ListCard({ list }: { list: DealList }) {
  const { renameList, deleteList, toggleListMembership, tier, openUpgrade, recordExport } =
    useSession();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(list.name);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== list.name) renameList(list.id, next);
    else setDraft(list.name);
    setEditing(false);
  };

  const exportList = () => {
    if (!tier.csvExport) {
      openUpgrade({ reason: "export" });
      return;
    }
    downloadCsv(csvFileName(`list-${list.name}`), toCsv(list.listings, COLUMNS));
    recordExport(`${fmtNum(list.listings.length)} rentals from ${list.name}`, "/saved");
    toast.success(`Exported ${fmtNum(list.listings.length)} rentals`);
  };

  return (
    <section className="overflow-hidden rounded-sm border border-border bg-card elev-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        {editing ? (
          <form
            className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              commitRename();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(list.name);
                  setEditing(false);
                }
              }}
              aria-label="List name"
              autoFocus
              className="h-8 max-w-xs"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              aria-label="Save name"
              disabled={!draft.trim()}
            >
              <Check aria-hidden className="size-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Cancel rename"
              onClick={() => {
                setDraft(list.name);
                setEditing(false);
              }}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </form>
        ) : (
          <div className="flex w-full min-w-0 items-baseline gap-3 sm:w-auto sm:flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{list.name}</h2>
            <span className="shrink-0 text-xs text-muted-foreground tabular">
              {fmtNum(list.listings.length)} {list.listings.length === 1 ? "rental" : "rentals"}
              {list.createdAt ? <> · since {fmtDate(list.createdAt)}</> : null}
            </span>
            <button
              type="button"
              aria-label={`Rename ${list.name}`}
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              <Pencil aria-hidden className="size-3.5" />
            </button>
          </div>
        )}

        {/* Its own row on a phone: beside the name there was no room,
            and the buttons were drawn over the count. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/deals?list=${encodeURIComponent(list.id)}`}>
              <span className="hidden sm:inline">Open in&nbsp;</span>Deal Finder
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={exportList}
            disabled={list.listings.length === 0}
          >
            <FileDown aria-hidden className="size-3.5" />
            Export CSV
          </Button>
          {confirmDelete ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  deleteList(list.id);
                  toast(`Deleted ${list.name}`);
                }}
              >
                {list.listings.length === 0
                  ? "Delete list"
                  : `Delete list and ${fmtNum(list.listings.length)} saved`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${list.name}`}
              onClick={() => setConfirmDelete(true)}
              className="text-muted-foreground"
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {list.listings.length === 0 ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">
          Nothing saved here yet. In the Deal Finder, open a rental and choose{" "}
          <span className="font-medium text-foreground">Add to list</span>.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {list.listings.map((l) => (
            <li
              key={l.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-6 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{l.address}</p>
                <p className="truncate text-xs text-muted-foreground">{placeLine(l)}</p>
              </div>
              <p className="hidden text-xs text-muted-foreground tabular sm:block">
                {l.bedrooms} bd · {l.bathrooms} ba
                {l.sqft ? <> · {fmtNum(l.sqft)} sf</> : null}
              </p>
              <p className="hidden text-sm font-semibold text-foreground tabular sm:block">
                {fmtMoney(l.rentMonthly)}
                <span className="text-xs font-normal text-muted-foreground">/mo</span>
              </p>
              <div className="flex items-center gap-1.5">
                <Button asChild size="sm" variant="secondary" className="gap-1">
                  <Link href={analyzeHref(l)} target="_blank" rel="noopener">
                    Analyze
                  </Link>
                </Button>
                <button
                  type="button"
                  aria-label={`Remove ${l.address} from ${list.name}`}
                  onClick={() => toggleListMembership(list.id, l)}
                  className={cn(
                    "rounded-sm p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ListsTab() {
  const { ready, lists, createList } = useSession();
  const [newName, setNewName] = React.useState("");

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    createList(name);
    setNewName("");
  };

  if (!ready) {
    return <div className="h-40 animate-pulse rounded-sm border border-border bg-card" />;
  }

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New list name…"
          aria-label="New list name"
          className="h-9 w-full sm:w-72"
        />
        <Button type="submit" size="sm" disabled={!newName.trim()}>
          Create list
        </Button>
      </form>

      {lists.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No lists yet"
          description="Shortlist rentals from the Deal Finder with Add to list, and they collect here."
          action={
            <Button asChild>
              <Link href="/deals">Open the Deal Finder</Link>
            </Button>
          }
        />
      ) : (
        lists.map((list) => <ListCard key={list.id} list={list} />)
      )}
    </div>
  );
}
