"use client";

/**
 * Who to call about a property.
 *
 * One block for the listing overlay and the analyzer, so the two never
 * say different things about one address: the lister's name, number
 * and email as rows a column can scan; while the listing's page is
 * being read, those rows as placeholders with a highlight sweeping
 * where the details will land; and when the page gave no number, the
 * two ways on — a deep lookup of public records for the owner, and a
 * web search for the rental, typed out.
 *
 * THREE OUTCOMES, NEVER TWO. "This listing publishes none", "the page
 * could not be read" and "there is no listing behind this address" are
 * different facts, and the line says which. Sending somebody away from
 * a number that exists is the failure that matters here.
 *
 * The wait is drawn as a sweep rather than a fill: there is no
 * measured progress to a page read, and a bar that filled on a timer
 * would be a fiction that happened to end when the page did.
 */

import * as React from "react";
import { ArrowUpRight, Mail, Phone, User } from "lucide-react";
import { hasOwnListingPage, webLookupHref } from "@/lib/live/listing-links";
import type { RentalListing } from "@/lib/mock/types";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { PhoneLookup } from "./phone-lookup";
import type { ContactLookup, ContactStatus } from "./use-listing-contact";
import { cn } from "@/lib/utils";

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

/** The rows laid out across the panel, stacked on a phone. */
const ROWS = "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7";

/**
 * The rows before they are known.
 *
 * Three placeholders the shape of a name, a number and an email, a
 * gold highlight sweeping each a beat after the last, and a ring
 * turning beside one line that says what is happening — the same ring
 * the result page waits with. Static under reduced motion.
 */
function ContactPending() {
  return (
    <div role="status" className="mt-3">
      <div aria-hidden className={ROWS}>
        {[8.5, 6.5, 10].map((rem, i) => (
          <span
            key={rem}
            className="flex items-center gap-2.5"
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className="contact-shimmer size-6 shrink-0 rounded-full" />
            <span
              className="contact-shimmer h-2.5 rounded-full"
              style={{ width: `${rem}rem` }}
            />
          </span>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <svg viewBox="0 0 48 48" className="working-ring size-3.5 shrink-0" aria-hidden>
          <circle className="track" cx="24" cy="24" r="20" />
          <circle className="arc" cx="24" cy="24" r="20" />
        </svg>
        Reading the listing for who to call…
      </p>
    </div>
  );
}

/**
 * Why there is nobody to show — three different facts that must not
 * read the same. "Couldn't read it" is not "there is none", and a
 * typed address with no listing behind it is neither.
 */
function noContactLine(real: boolean, status: ContactStatus, pageToOpen: boolean): string {
  if (!real) return "Preview inventory carries no contact details.";
  const line =
    status === "unreadable"
      ? "Couldn't read this listing's page just now."
      : status === "no-page"
        ? "This property isn't on the listing site contacts are read from."
        : status === "none"
          ? "This listing's page publishes no contact details."
          : "No rental listing on file for this address.";
  return pageToOpen && status !== "none"
    ? `${line} The listing page behind View photos may have them.`
    : line;
}

export function ContactDetails({
  listing,
  looked,
  real,
  className,
}: {
  listing: RentalListing;
  /** The page read, from useListingContact — idle for a row that
   *  already carries its contact, or has no page to read. */
  looked: ContactLookup;
  /** A real address — a live row or a typed one — as opposed to
   *  preview inventory, whose contacts are reserved numbers. */
  real: boolean;
  className?: string;
}) {
  // The feed's own contact when the row has one, otherwise the page's.
  const contact = listing.contact ?? looked.contact;
  // The page the lookup found, when the row arrived without one.
  const page = listing.sourceUrl ?? looked.page ?? undefined;
  const loading = looked.status === "loading";
  // Only when the listing site gave no number — none on file, a page
  // that could not be read, one that publishes none, or a contact
  // with a name and no line. Two ways on from there: a deep lookup of
  // public records for the owner's number (credits, charged only when
  // one comes back), and a web search for the rental, typed out.
  const waysOn = real && !contact?.phone && !loading;
  const webHref = waysOn ? webLookupHref(listing) : null;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <MetricLabel>{contact?.role ?? "Contact"}</MetricLabel>
        {!real ? <StatusChip tone="neutral">Preview</StatusChip> : null}
      </div>

      {contact ? (
        <div
          className={cn(
            "mt-3",
            ROWS,
            // Read off the page just now: the rows take the place of
            // the placeholders rather than snapping in.
            looked.status === "found" && "animate-in fade-in slide-in-from-bottom-1 duration-300"
          )}
        >
          {/* A page routinely gives a number and no name. Show the row
              only when there is somebody to name — an empty one reads
              as a name we failed to load. */}
          {contact.name || contact.company ? (
            <ContactRow icon={User}>
              {contact.name ? <span className="font-medium">{contact.name}</span> : null}
              {contact.company ? (
                <span className={contact.name ? "text-muted-foreground" : "font-medium"}>
                  {contact.name ? " · " : ""}
                  {contact.company}
                </span>
              ) : null}
            </ContactRow>
          ) : null}
          {contact.phone ? (
            <ContactRow icon={Phone} href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
              <span className="tabular">{contact.phone}</span>
            </ContactRow>
          ) : null}
          {contact.email ? (
            <ContactRow icon={Mail} href={`mailto:${contact.email}`}>
              {contact.email}
            </ContactRow>
          ) : null}
        </div>
      ) : loading ? (
        <ContactPending />
      ) : (
        <p
          className={cn(
            "mt-2.5 text-sm leading-relaxed text-muted-foreground",
            looked.status !== "idle" && "animate-in fade-in duration-300"
          )}
        >
          {noContactLine(
            real,
            looked.status,
            hasOwnListingPage({ ...listing, sourceUrl: page })
          )}
        </p>
      )}

      {waysOn ? (
        <div className="mt-3 flex flex-col gap-3">
          <PhoneLookup listing={listing} />
          {webHref ? (
            <a
              href={webHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Searches the web for this rental, where a contact is often posted"
              className="inline-flex h-8 w-fit items-center gap-1 rounded-sm border border-border px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary/60"
            >
              Web lookup
              <ArrowUpRight aria-hidden className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
