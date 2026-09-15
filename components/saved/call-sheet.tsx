"use client";

/**
 * Working down a saved list, one landlord at a time.
 *
 * The whole reason /saved exists. A hunter shortlists eight rentals in
 * the Deal Finder in ten minutes, and then has to ring eight landlords
 * — which before this screen meant opening each property, hunting for
 * the number, dialling it, closing the panel, and remembering which of
 * the eight they had already done. The remembering is the part that
 * broke: by the fourth call nobody knows whether the second one went
 * to voicemail.
 *
 * So this shows exactly ONE property, with the number as the largest
 * thing on the card, four buttons for how it went, a box for what was
 * said, and a next. Nothing else is on screen, because everything else
 * is a reason to stop calling.
 *
 * ONE PROPERTY, ONE DECISION, LOGGED BEFORE IT MOVES. The queue can be
 * left at any point and picked up where it stopped, because what has
 * been rung is written down rather than held in the order of a list.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Mail,
  Phone,
  PhoneOff,
  Search,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtWhen } from "@/lib/format";
import { analyzeHref } from "@/lib/live/analyze-href";
import { webLookupHref } from "@/lib/live/listing-links";
import type { CallOutcome, DealList, DealListItem } from "@/lib/mock/types";
import {
  band,
  callQueue,
  MAX_NOTE,
  OUTCOMES,
  outcomeLabel,
  queueStats,
  telHref,
} from "@/lib/saved/call-queue";
import { useSession } from "@/components/providers/session-provider";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import {
  useListingContact,
  withKnownContact,
} from "@/components/deals/use-listing-contact";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { placeLine } from "./place-line";
import { cn } from "@/lib/utils";

/** The list the queue belongs to, so the cards below can write a
 *  found number back without threading the id through each of them. */
const QueueListId = React.createContext<string | null>(null);

/**
 * Who to call, at the size somebody reads it from a phone held in the
 * other hand.
 *
 * The number is a link on every device, not only the small ones: a
 * desktop with a softphone dials it, and a desktop without one at
 * least lets it be copied in one gesture rather than selected by
 * dragging across a line of small grey text.
 */
function CallCard({ item }: { item: DealListItem }) {
  const { updateSavedListing } = useSession();
  const contact = item.listing.contact;
  const dial = telHref(contact?.phone);
  return (
    <div className="rounded-sm border border-border bg-secondary/40 p-4 sm:p-5">
      <MetricLabel>{contact?.role ?? "Who to call"}</MetricLabel>
      {contact?.name || contact?.company ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-foreground">
          <User aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {contact.name ? <span className="font-medium">{contact.name}</span> : null}
            {contact.company ? (
              <span className={contact.name ? "text-muted-foreground" : "font-medium"}>
                {contact.name ? " · " : ""}
                {contact.company}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}

      {dial ? (
        <a
          href={dial}
          className="mt-3 flex items-center gap-3 rounded-sm border border-gold/40 bg-gold-fill/10 px-4 py-3 transition-colors duration-150 hover:bg-gold-fill/15"
        >
          <Phone aria-hidden className="size-5 shrink-0 text-gold" />
          <span className="font-display text-2xl font-semibold tracking-tight tabular text-foreground">
            {contact?.phone}
          </span>
        </a>
      ) : (
        <FindTheNumber item={item} onFound={updateSavedListing} />
      )}

      {contact?.email ? (
        <a
          href={`mailto:${contact.email}`}
          className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-gold"
        >
          <Mail aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{contact.email}</span>
        </a>
      ) : null}
    </div>
  );
}

/**
 * A saved rental with nobody to ring.
 *
 * Reading the listing's page for a contact is billed, so it does not
 * happen because somebody opened the queue: twenty properties would be
 * twenty page reads, most of them for landlords nobody gets to before
 * lunch. It happens when this button is pressed, for this property,
 * and the answer is written back onto the saved row so the next pass
 * down the list does not pay for it again.
 */
function FindTheNumber({
  item,
  onFound,
}: {
  item: DealListItem;
  onFound: (listId: string, listing: DealListItem["listing"]) => void;
}) {
  const [asked, setAsked] = React.useState(false);
  const looked = useListingContact(item.listing, asked);
  const listId = React.useContext(QueueListId);

  // Writing during render is what a ref guards against: the answer
  // lands in a module cache the hook reads back, so without this the
  // same result is persisted on every subsequent render.
  const kept = React.useRef(false);
  React.useEffect(() => {
    if (kept.current || !looked.contact || !listId) return;
    kept.current = true;
    onFound(listId, withKnownContact(item.listing, looked.contact, looked.page));
  }, [looked.contact, looked.page, item.listing, listId, onFound]);

  const web = webLookupHref(item.listing);

  if (looked.status === "loading") {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <svg viewBox="0 0 48 48" className="working-ring size-3.5 shrink-0" aria-hidden>
          <circle className="track" cx="24" cy="24" r="20" />
          <circle className="arc" cx="24" cy="24" r="20" />
        </svg>
        Reading the listing for who to call…
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <PhoneOff aria-hidden className="size-3.5 shrink-0" />
        {!asked
          ? "No number saved with this one."
          : looked.status === "found"
            ? "Found it — reopen this card."
            : looked.status === "none"
              ? "This listing's page publishes no number."
              : looked.status === "no-page"
                ? "This property isn't on the listing site contacts are read from."
                : "Couldn't read this listing's page just now."}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {!asked ? (
          <Button size="sm" variant="secondary" onClick={() => setAsked(true)} className="gap-1.5">
            <Search aria-hidden className="size-3.5" />
            Find the number
          </Button>
        ) : null}
        {web ? (
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={web} target="_blank" rel="noopener noreferrer">
              Web lookup
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What to do once somebody has actually been spoken to.
 *
 * SUGGESTED, NEVER DONE. Putting the property in the pipeline means
 * running the numbers, which costs a credit — so a good call must not
 * quietly spend one. And filing a landlord is a judgement: the person
 * who answered may have been a leasing desk with no say over anything.
 * Both are offered, on the card, one tap away, and neither happens by
 * itself.
 */
function AfterSpeaking({ item }: { item: DealListItem }) {
  const { addLandlord, landlords } = useSession();
  const contact = item.listing.contact;
  const digits = (v: string | undefined) => (v ?? "").replace(/\D/g, "");
  const already =
    contact?.phone && landlords.some((l) => digits(l.phone) === digits(contact.phone));

  const file = () => {
    if (!contact) return;
    addLandlord({
      name: contact.name || contact.company || "Listing contact",
      company: contact.company,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      unitsControlled: 0,
      // What "we have not asked yet" already means everywhere else —
      // the same default the Add landlord dialog opens on. Claiming
      // "yes" off a call about a lease would be an invention, and the
      // type has no fourth value to mean unknown.
      allowsStr: "negotiable",
      notes: item.call.note,
      lastContacted: item.call.lastCalledAt ?? new Date().toISOString(),
    });
    toast.success("Filed in your landlord book");
  };

  return (
    <div className="mt-4 rounded-sm border border-gold/35 bg-gold-fill/8 p-4">
      <MetricLabel>You spoke to them</MetricLabel>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Two things worth doing while it&apos;s fresh — neither happens on its own.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary" className="gap-1.5">
          <Link href={analyzeHref(item.listing)} target="_blank" rel="noopener">
            Run the numbers
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        </Button>
        {contact && (contact.phone || contact.email) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={file}
            disabled={Boolean(already)}
            className="gap-1.5"
          >
            {already ? <Check aria-hidden className="size-3.5" /> : null}
            {already ? "In your landlord book" : "Add to landlord book"}
          </Button>
        ) : null}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        Running the numbers is what puts a property in the pipeline — it spends a
        credit, so it&apos;s your call, not ours.
      </p>
    </div>
  );
}

/** One property's facts, above the phone number. */
function PropertyLine({ item }: { item: DealListItem }) {
  const l = item.listing;
  return (
    <div>
      <h3 className="font-display text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
        {l.address}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{placeLine(l)}</p>
      <p className="mt-2 text-sm text-foreground tabular">
        <span className="font-semibold">{fmtMoney(l.rentMonthly)}</span>
        <span className="text-muted-foreground">/mo</span>
        <span className="text-muted-foreground">
          {" · "}
          {l.bedrooms} bd · {l.bathrooms} ba
          {l.sqft ? ` · ${fmtNum(l.sqft)} sf` : ""}
        </span>
      </p>
    </div>
  );
}

export function CallSheet({
  list,
  open,
  startAt = null,
  onOpenChange,
}: {
  list: DealList;
  open: boolean;
  /** Which property to open on — a row's own Call button names one.
   *  Read once per opening; after that the queue decides. */
  startAt?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { logCall } = useSession();
  const queue = React.useMemo(() => callQueue(list.items), [list.items]);
  const stats = React.useMemo(() => queueStats(list.items), [list.items]);

  /**
   * Which property is on screen, BY ID rather than by index.
   *
   * Logging a call re-sorts the queue underneath — a "no answer" moves
   * its property from the front band to the middle of the next one. An
   * index would then point at whatever slid into that slot, which is
   * the bug where a hunter logs a call against the property after the
   * one they rang. The id is stable through every re-sort.
   */
  const [atId, setAtId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  // Each opening starts where it was asked to. Without this, pressing
  // Call on the tenth row after a session that ended on the second
  // would reopen on the second.
  const [wasOpen, setWasOpen] = React.useState(open);
  // Opening on a named row means "show me this one" even when it is
  // finished; opening on the queue means "give me the next call".
  const [reviewing, setReviewing] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAtId(startAt);
      setReviewing(startAt !== null);
    }
  }
  /** Set when the call now on screen was logged from this sheet, so
   *  the follow-ups appear for a call just made rather than for every
   *  property that was ever spoken to. */
  const [justLogged, setJustLogged] = React.useState<string | null>(null);

  // The first card, and the one to fall back to when the current
  // property leaves the list. Derived rather than stored: state that
  // can disagree with the queue is how somebody ends up logging calls
  // into a void.
  const current =
    queue.find((i) => i.listing.id === atId) ?? queue[0] ?? null;
  const position = current
    ? queue.findIndex((i) => i.listing.id === current.listing.id) + 1
    : 0;

  // The note field follows the property, and carries what was written
  // about it last time — a second call to the same landlord starts
  // from what the first one learned, not from a blank box.
  const shown = current?.listing.id ?? null;
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  if (shown !== noteFor) {
    setNoteFor(shown);
    setNote(current?.call.note ?? "");
  }

  /** Step through the queue as it stands — for browsing, not working.
   *  Finished properties are on the way, which is the point of Back. */
  const step = (delta: number) => {
    if (!current) return;
    const i = queue.findIndex((x) => x.listing.id === current.listing.id);
    const next = queue[i + delta];
    setJustLogged(null);
    if (next) {
      setAtId(next.listing.id);
      setReviewing(true);
    }
  };

  /**
   * On to the next property that still needs a call.
   *
   * NOT the next one in the queue. After a call is logged the queue
   * re-sorts around it, and the property sitting where the finished
   * one used to be is very often another finished one — stepping
   * blindly forward walked a hunter straight into the done band with
   * three landlords still un-rung behind them.
   */
  const advance = (skipId: string) => {
    setJustLogged(null);
    const next = queue.find(
      (x) => x.listing.id !== skipId && band(x.call) !== "done"
    );
    setAtId(next?.listing.id ?? null);
    setReviewing(false);
  };

  const log = (outcome: CallOutcome) => {
    if (!current) return;
    logCall(list.id, current.listing.id, outcome, note);
    if (outcome === "spoke") {
      // Stay put, so the two follow-ups can be used while the call is
      // still fresh. "Next property" below moves on.
      setJustLogged(current.listing.id);
      setReviewing(true);
      return;
    }
    advance(current.listing.id);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <SheetHeader className="gap-1 border-b border-border px-5 py-4">
          <SheetTitle className="text-base">Calling · {list.name}</SheetTitle>
          <SheetDescription className="tabular">
            {stats.left === 0
              ? `All ${fmtNum(stats.total)} worked through`
              : `${fmtNum(position)} of ${fmtNum(queue.length)} · ${fmtNum(stats.left)} left to call`}
          </SheetDescription>
        </SheetHeader>

        {!current ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-secondary">
              <Phone aria-hidden className="size-5 text-muted-foreground" />
            </span>
            <p className="text-sm font-medium text-foreground">Nothing in this list yet</p>
            <p className="text-sm text-muted-foreground">
              Shortlist rentals in the Deal Finder and they queue up here.
            </p>
          </div>
        ) : stats.left === 0 && !reviewing ? (
          /* Worked through. Said plainly rather than by showing the
             first finished property again, which reads as a queue that
             never ends. */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-gold-fill/15">
              <Check aria-hidden className="size-5 text-gold" />
            </span>
            <p className="text-sm font-medium text-foreground">
              Every one called
            </p>
            <p className="text-sm text-muted-foreground">
              {fmtNum(stats.done)} of {fmtNum(stats.total)} worked through. Nothing
              left waiting on a call in this list.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => {
                setAtId(queue[0]?.listing.id ?? null);
                setReviewing(true);
              }}
            >
              Look back through them
            </Button>
          </div>
        ) : (
          <QueueListId.Provider value={list.id}>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <PropertyLine item={current} />
                {current.call.outcome ? (
                  <StatusChip tone={current.call.outcome === "spoke" ? "gold" : "neutral"}>
                    {outcomeLabel(current.call.outcome)}
                  </StatusChip>
                ) : null}
              </div>

              {current.call.attempts > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {current.call.attempts === 1
                    ? "Tried once"
                    : `Tried ${fmtNum(current.call.attempts)} times`}
                  {current.call.lastCalledAt
                    ? ` · last ${fmtWhen(current.call.lastCalledAt).toLowerCase()}`
                    : null}
                </p>
              ) : null}

              <div className="mt-4">
                <CallCard item={current} />
              </div>

              <div className="mt-5">
                <MetricLabel>How did it go?</MetricLabel>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => log(o.id)}
                      className={cn(
                        // Tall enough to hit one-handed with a phone
                        // against the other ear — this is the control
                        // that gets used while the call is ending.
                        "flex h-12 items-center justify-center rounded-sm border px-3 text-sm font-medium transition-colors duration-150",
                        current.call.outcome === o.id
                          ? "border-gold/50 bg-gold-fill/12 text-gold"
                          : "border-border bg-card text-foreground hover:bg-secondary"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="call-note"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                >
                  What they said
                </label>
                <Textarea
                  id="call-note"
                  value={note}
                  maxLength={MAX_NOTE}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Open to a 12-month term, wants to meet Thursday…"
                  className="mt-2 min-h-24 resize-y"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Saved with whichever outcome you pick above.
                </p>
              </div>

              {justLogged === current.listing.id ? <AfterSpeaking item={current} /> : null}

              <div className="mt-6 flex items-center justify-between gap-2 border-t border-border pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => step(-1)}
                  disabled={position <= 1}
                  className="text-muted-foreground"
                >
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() =>
                    justLogged === current.listing.id
                      ? advance(current.listing.id)
                      : step(1)
                  }
                  disabled={justLogged !== current.listing.id && position >= queue.length}
                >
                  {justLogged === current.listing.id ? "Next property" : "Skip for now"}
                  <ChevronRight aria-hidden className="size-3.5" />
                </Button>
              </div>
            </div>
          </QueueListId.Provider>
        )}
      </SheetContent>
    </Sheet>
  );
}
