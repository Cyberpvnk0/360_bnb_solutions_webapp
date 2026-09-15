"use client";

/**
 * The saved lists, as call lists.
 *
 * This pane used to be an inventory: twenty rows of address, size and
 * rent, each with a link back to the analyzer. Perfectly accurate and
 * no use at all for the thing people actually do with a shortlist,
 * which is ring the landlord behind every row and write down what was
 * said. There was nowhere for a phone number to show, nowhere for a
 * call to be recorded, and — worse — nothing to tell a hunter which of
 * the twenty they had already done, so the second pass down the list
 * looked exactly like the first.
 *
 * Now the row carries the number, the last outcome and the note, and
 * the header carries the one control that matters: start calling. The
 * numbers are the same numbers; what changed is that the list can be
 * WORKED rather than only read.
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
  Phone,
  PhoneCall,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "@/lib/export/csv";
import { fmtDate, fmtMoney, fmtNum, fmtWhen } from "@/lib/format";
import { analyzeHref } from "@/lib/live/analyze-href";
import type { DealList, DealListItem, RentalListing } from "@/lib/mock/types";
import {
  callQueue,
  outcomeLabel,
  queueStats,
  telHref,
} from "@/lib/saved/call-queue";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CallSheet } from "./call-sheet";
import { marketName, placeLine } from "./place-line";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<RentalListing["propertyType"], string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhome: "Townhome",
};

/**
 * The export, with the call log in it.
 *
 * A hunter who works a list for a week has something worth keeping by
 * the end of it, and it is not the asking rents — it is which numbers
 * were dead, who picked up and what they said. Leaving that out of the
 * CSV would mean the one artefact of the week's work stayed locked in
 * the app.
 */
const COLUMNS: CsvColumn<DealListItem>[] = [
  { header: "Address", value: (i) => i.listing.address },
  { header: "City", value: (i) => i.listing.city },
  { header: "State", value: (i) => i.listing.stateCode },
  { header: "Market", value: (i) => marketName(i.listing.marketSlug) ?? "" },
  { header: "Type", value: (i) => TYPE_LABEL[i.listing.propertyType] },
  { header: "Bedrooms", value: (i) => i.listing.bedrooms },
  { header: "Bathrooms", value: (i) => i.listing.bathrooms },
  { header: "Sq ft", value: (i) => i.listing.sqft || "" },
  { header: "Asking rent / mo ($)", value: (i) => i.listing.rentMonthly },
  { header: "Contact", value: (i) => i.listing.contact?.name ?? "" },
  { header: "Contact phone", value: (i) => i.listing.contact?.phone ?? "" },
  { header: "Contact email", value: (i) => i.listing.contact?.email ?? "" },
  { header: "Call outcome", value: (i) => (i.call.outcome ? outcomeLabel(i.call.outcome) : "") },
  { header: "Call attempts", value: (i) => i.call.attempts || "" },
  { header: "Last called", value: (i) => i.call.lastCalledAt ?? "" },
  { header: "Call notes", value: (i) => i.call.note },
  { header: "Listing page", value: (i) => i.listing.sourceUrl ?? "" },
];

/**
 * How far down the list somebody is, as a bar.
 *
 * One line of text could say "7 of 12 called", and does say it beside
 * this. The bar is here because a list being nearly finished is the
 * thing that gets the last five calls made, and a number does not
 * carry that the way a nearly-full track does.
 */
function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className="h-0.5 w-full bg-border"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${done} of ${total} worked through`}
    >
      <div
        className="h-full bg-gold transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** What the last call said, in a chip. Gold once somebody has actually
 *  been reached; muted red with its icon for a number that is dead. */
function OutcomeChip({ item }: { item: DealListItem }) {
  const o = item.call.outcome;
  if (!o) return null;
  return (
    <StatusChip tone={o === "spoke" ? "gold" : o === "wrong-number" ? "neg" : "neutral"}>
      {outcomeLabel(o)}
    </StatusChip>
  );
}

function ListRow({
  item,
  list,
  onCall,
}: {
  item: DealListItem;
  list: DealList;
  onCall: (listingId: string) => void;
}) {
  const { toggleListMembership } = useSession();
  const l = item.listing;
  const dial = telHref(l.contact?.phone);
  const done = item.call.outcome === "spoke" || item.call.outcome === "wrong-number";

  return (
    <li className={cn("px-5 py-3.5 sm:px-6", done && "bg-secondary/30")}>
      {/* Stacked below sm, side by side above it. On one line at phone
          width the address truncated to "9 Bayard Point Co…" and the
          phone number had to be hidden outright — on the device people
          actually dial from. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <div className="w-full min-w-0 sm:flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p
              className={cn(
                "truncate text-sm font-medium",
                done ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {l.address}
            </p>
            <OutcomeChip item={item} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground tabular">
            {placeLine(l)} · {l.bedrooms} bd · {l.bathrooms} ba ·{" "}
            <span className="font-medium text-foreground">{fmtMoney(l.rentMonthly)}</span>/mo
          </p>
        </div>

        {/* The number, on the row. The whole point of the rework: a
            hunter should not have to open anything to see who to ring. */}
        <div className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto">
          {dial ? (
            <a
              href={dial}
              aria-label={`Call ${l.contact?.phone} about ${l.address}`}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs font-medium tabular text-foreground transition-colors duration-150 hover:border-gold/50 hover:text-gold sm:flex-none"
            >
              <Phone aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{l.contact?.phone}</span>
            </a>
          ) : null}
          <Button
            size="sm"
            variant={item.call.outcome ? "outline" : "secondary"}
            className="gap-1.5"
            onClick={() => onCall(l.id)}
          >
            <PhoneCall aria-hidden className="size-3.5" />
            {item.call.outcome ? "Log" : "Call"}
          </Button>
          <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
            <Link href={analyzeHref(l)} target="_blank" rel="noopener">
              Analyze
            </Link>
          </Button>
          <button
            type="button"
            aria-label={`Remove ${l.address} from ${list.name}`}
            onClick={() => toggleListMembership(list.id, l)}
            className="rounded-sm p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {/* What was said, under the address where it reads as a note on
          this property rather than as another column of data. */}
      {item.call.note || item.call.attempts > 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {item.call.attempts > 1 ? (
            <span className="tabular">{fmtNum(item.call.attempts)} tries · </span>
          ) : null}
          {item.call.lastCalledAt ? (
            <span className="tabular">{fmtWhen(item.call.lastCalledAt)}</span>
          ) : null}
          {item.call.note ? (
            <>
              {item.call.lastCalledAt ? " — " : null}
              <span className="text-foreground">{item.call.note}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

function ListCard({ list }: { list: DealList }) {
  const { renameList, deleteList, tier, openUpgrade, recordExport } = useSession();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(list.name);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [calling, setCalling] = React.useState(false);
  const [startAt, setStartAt] = React.useState<string | null>(null);

  const stats = queueStats(list.items);
  // Shown in the queue's order rather than the order things were
  // saved, so the pane and the sheet agree on what comes next. Nothing
  // disappears — the finished ones sink, they do not hide.
  const rows = React.useMemo(() => callQueue(list.items), [list.items]);

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
    downloadCsv(csvFileName(`list-${list.name}`), toCsv(list.items, COLUMNS));
    recordExport(`${fmtNum(list.items.length)} rentals from ${list.name}`, "/saved");
    toast.success(`Exported ${fmtNum(list.items.length)} rentals`);
  };

  const openQueue = (listingId: string | null) => {
    setStartAt(listingId);
    setCalling(true);
  };

  return (
    <section className="overflow-hidden rounded-sm border border-border bg-card elev-card">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
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
            {/* Rentals, then the figure that decides what to do next.
                The count alone never got anybody to pick up a phone. */}
            <span className="shrink-0 text-xs text-muted-foreground tabular">
              {fmtNum(stats.total)} {stats.total === 1 ? "rental" : "rentals"}
              {stats.total > 0 ? (
                <>
                  {" · "}
                  {stats.left === 0 ? (
                    <span className="text-gold">all called</span>
                  ) : (
                    <span className="font-medium text-foreground">
                      {fmtNum(stats.left)} to call
                    </span>
                  )}
                </>
              ) : list.createdAt ? (
                <> · since {fmtDate(list.createdAt)}</>
              ) : null}
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
          {/* Full width on a phone: it is the one thing this card is
              for, and sharing a line with three others pushed the
              delete button onto a row of its own. */}
          {stats.left > 0 ? (
            <Button
              size="sm"
              className="w-full gap-1.5 sm:w-auto"
              onClick={() => openQueue(null)}
            >
              <PhoneCall aria-hidden className="size-3.5" />
              Start calling
            </Button>
          ) : stats.total > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 sm:w-auto"
              onClick={() => openQueue(null)}
            >
              <PhoneCall aria-hidden className="size-3.5" />
              Review calls
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            {/* One span per width rather than a prefix beside a bare
                text node: the button is a flex row, so its own gap
                fell between "Open in" and "Deal Finder". */}
            <Link href={`/deals?list=${encodeURIComponent(list.id)}`}>
              <span className="hidden sm:inline">Open in Deal Finder</span>
              <span className="sm:hidden">Deal Finder</span>
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={exportList}
            disabled={stats.total === 0}
          >
            <FileDown aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
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
                {stats.total === 0
                  ? "Delete list"
                  : `Delete list and ${fmtNum(stats.total)} saved`}
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

      {stats.total > 0 ? <Progress done={stats.done} total={stats.total} /> : null}

      {stats.total === 0 ? (
        <p className="border-t border-border px-5 py-5 text-sm text-muted-foreground sm:px-6">
          Nothing saved here yet. In the Deal Finder, open a rental and choose{" "}
          <span className="font-medium text-foreground">Add to list</span>.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((item) => (
            <ListRow key={item.listing.id} item={item} list={list} onCall={openQueue} />
          ))}
        </ul>
      )}

      <CallSheet
        list={list}
        open={calling}
        startAt={startAt}
        onOpenChange={setCalling}
      />
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
        <Button type="submit" size="sm" variant="secondary" disabled={!newName.trim()}>
          Create list
        </Button>
      </form>

      {lists.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No lists yet"
          description="Shortlist rentals from the Deal Finder with Add to list, then work down the list calling the landlords behind them."
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
