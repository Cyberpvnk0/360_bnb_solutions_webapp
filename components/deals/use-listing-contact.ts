"use client";

/**
 * The lister's details, fetched when somebody actually opens a property.
 *
 * The market feed does not carry them and the portal's search rows do
 * not either — the contact lives on the listing's own page, and reading
 * a page is a billed scrape. So this runs on OPEN, for one property,
 * rather than over a market's five hundred rows: almost nobody rings
 * five hundred landlords, and paying to find out who they are would be
 * the largest line on the bill.
 *
 * Answers are kept for the session, keyed by the listing page, so
 * flicking back and forth between two properties asks once each. A
 * failure is kept too — an in-flight request that failed must not be
 * retried on every re-render, which is how one broken page turns into a
 * hundred requests.
 *
 * THREE OUTCOMES, NEVER TWO. A contact, "this listing publishes none",
 * and "we could not read the page" are different facts and the panel
 * says which: unknown is not none, and a blank where a number should be
 * is the one place that distinction gets somebody to stop calling.
 */

import * as React from "react";
import type { ListingContact, RentalListing } from "@/lib/mock/types";

export type ContactStatus = "idle" | "loading" | "found" | "none" | "unreadable";

export interface ContactLookup {
  status: ContactStatus;
  contact: ListingContact | null;
}

/** Session cache: one settled answer per listing page. */
const answers = new Map<string, ContactLookup>();
/** In-flight, so two panels opening the same row share one request. */
const pending = new Map<string, Promise<ContactLookup>>();

async function lookup(url: string): Promise<ContactLookup> {
  const cached = answers.get(url);
  if (cached) return cached;
  const running = pending.get(url);
  if (running) return running;

  const request = (async (): Promise<ContactLookup> => {
    try {
      const res = await fetch(
        `/api/listing-contact?url=${encodeURIComponent(url)}`
      );
      const body: unknown = await res.json().catch(() => null);
      const data = body as {
        ok?: boolean;
        contact?: ListingContact | null;
        blocked?: boolean;
      } | null;
      if (!res.ok || !data?.ok) return { status: "unreadable", contact: null };
      if (data.contact) return { status: "found", contact: data.contact };
      // The page loaded and published nothing, versus we never saw it.
      return {
        status: data.blocked ? "unreadable" : "none",
        contact: null,
      };
    } catch {
      return { status: "unreadable", contact: null };
    }
  })();

  pending.set(url, request);
  const settled = await request;
  pending.delete(url);
  answers.set(url, settled);
  return settled;
}

const IDLE: ContactLookup = { status: "idle", contact: null };
const LOADING: ContactLookup = { status: "loading", contact: null };

/**
 * Look up `listing`, or nothing at all.
 *
 * Pass `enabled` false while the panel is closed — the lookup costs
 * money and a property nobody opened must not spend any. A row that
 * already carries a contact from its feed, or has no listing page to
 * read, stays idle.
 *
 * THE ANSWER IS DERIVED, NOT STORED. What this returns is read out of
 * the session cache during render; the effect exists only to start a
 * request that is not there yet and to ask for one more render when it
 * lands. Holding a copy in component state would mean two places that
 * can disagree — and the way they disagree is one property's number
 * rendering under another property's address.
 */
export function useListingContact(
  listing: RentalListing | null,
  enabled: boolean
): ContactLookup {
  const url =
    enabled && listing && !listing.contact && listing.sourceUrl
      ? listing.sourceUrl
      : null;

  const [, settled] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!url || answers.has(url)) return;
    let live = true;
    void lookup(url).then(() => {
      // The panel may have moved on to another property by now; the
      // answer is in the cache either way, and the render below reads
      // whichever URL is current rather than this one.
      if (live) settled();
    });
    return () => {
      live = false;
    };
  }, [url]);

  if (!url) return IDLE;
  return answers.get(url) ?? LOADING;
}

/** Tests only. */
export function resetListingContactCache(): void {
  answers.clear();
  pending.clear();
}
