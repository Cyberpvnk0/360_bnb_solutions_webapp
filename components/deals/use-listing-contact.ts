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

export type ContactStatus =
  | "idle"
  | "loading"
  | "found"
  | "none"
  | "unreadable"
  /** The portal does not know this address, so there is no page to read. */
  | "no-page";

export interface ContactLookup {
  status: ContactStatus;
  contact: ListingContact | null;
  /** The listing page, when this lookup had to find it from the
   *  address — so the panel can link to it too. */
  page: string | null;
}

/** Session cache: one settled answer per listing page or address. */
const answers = new Map<string, ContactLookup>();
/** In-flight, so two panels opening the same row share one request. */
const pending = new Map<string, Promise<ContactLookup>>();

/** What to ask for: a page we hold, or the address to find one by. */
interface Target {
  key: string;
  query: URLSearchParams;
}

function targetFor(listing: RentalListing): Target | null {
  if (listing.sourceUrl) {
    return { key: listing.sourceUrl, query: new URLSearchParams({ url: listing.sourceUrl }) };
  }
  // A live row without a page on file: find the page by address. A
  // preview row has a made-up address and nothing to find.
  if (!listing.id.startsWith("live--")) return null;
  return {
    key: `addr:${listing.id}`,
    query: new URLSearchParams({
      address: listing.address,
      city: listing.city,
      state: listing.stateCode,
      ...(listing.zip ? { zip: listing.zip } : {}),
    }),
  };
}

async function lookup(target: Target): Promise<ContactLookup> {
  const cached = answers.get(target.key);
  if (cached) return cached;
  const running = pending.get(target.key);
  if (running) return running;

  const request = (async (): Promise<ContactLookup> => {
    try {
      const res = await fetch(`/api/listing-contact?${target.query}`);
      const body: unknown = await res.json().catch(() => null);
      const data = body as {
        ok?: boolean;
        contact?: ListingContact | null;
        blocked?: boolean;
        page?: string | null;
      } | null;
      if (!res.ok || !data?.ok) return { status: "unreadable", contact: null, page: null };
      const page = typeof data.page === "string" ? data.page : null;
      if (data.contact) return { status: "found", contact: data.contact, page };
      // Looked up by address and no page came back. `blocked` says
      // whether the portal answered "no such page" or never answered
      // at all — different from a page that loaded and published
      // nothing, and from one we never got to see.
      if (!target.query.has("url") && data.page === null) {
        return {
          status: data.blocked ? "unreadable" : "no-page",
          contact: null,
          page: null,
        };
      }
      return { status: data.blocked ? "unreadable" : "none", contact: null, page };
    } catch {
      return { status: "unreadable", contact: null, page: null };
    }
  })();
  pending.set(target.key, request);
  const settled = await request;
  pending.delete(target.key);
  answers.set(target.key, settled);
  return settled;
}

const IDLE: ContactLookup = { status: "idle", contact: null, page: null };
const LOADING: ContactLookup = { status: "loading", contact: null, page: null };

/**
 * Look up `listing`, or nothing at all.
 *
 * Pass `enabled` false while the panel is closed — the lookup costs
 * money and a property nobody opened must not spend any. A row that
 * already carries a contact from its feed stays idle; a live row with
 * no listing page on file is looked up by its address.
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
  const target = enabled && listing && !listing.contact ? targetFor(listing) : null;
  const key = target?.key ?? null;
  const [, settled] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!target || answers.has(target.key)) return;
    let live = true;
    void lookup(target).then(() => {
      // The panel may have moved on to another property by now; the
      // answer is in the cache either way, and the render below reads
      // whichever key is current rather than this one.
      if (live) settled();
    });
    return () => {
      live = false;
    };
    // The target is rebuilt each render; its key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return IDLE;
  return answers.get(key) ?? LOADING;
}

/** Tests only. */
export function resetListingContactCache(): void {
  answers.clear();
  pending.clear();
}
