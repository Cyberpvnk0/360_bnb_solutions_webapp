/**
 * Where a comp can be opened.
 *
 * Fresh comps carry `listingUrl` from the mapper. Comps bought before
 * that field existed sit in the store for a month with only their id —
 * and the id is the page: a live comp's id is "sc-live-<platform id>",
 * and the platform's room URL is built from nothing else. So the link
 * is derived here, at render, for both.
 *
 * NEVER FROM A ROUNDED ID. A comp whose id passed through a double
 * (see lib/live/listing-id) names a listing that does not exist, and
 * the card's "open this area" fallback — a real map of real inventory
 * — beats a link to an error page. Checked here rather than only in
 * the mapper because stored comps keep whatever link they were stored
 * with.
 */

import type { StrComp } from "@/lib/mock/types";
import { looksRoundedId, urlIdLooksRounded } from "./listing-id";

export function compListingUrl(
  comp: Pick<StrComp, "id" | "listingUrl" | "active" | "linkWithheld">
): string | null {
  // The feed said this one is no longer up: its page is an error.
  if (comp.active === false) return null;
  // The mapper withheld the link on purpose — checked BEFORE the id
  // fallback below, which would otherwise put it straight back.
  if (comp.linkWithheld) return null;
  if (comp.listingUrl) {
    return urlIdLooksRounded(comp.listingUrl) ? null : comp.listingUrl;
  }
  const m = /^sc-live-(\d{5,})$/.exec(comp.id);
  if (!m || looksRoundedId(m[1])) return null;
  return `https://www.airbnb.com/rooms/${m[1]}`;
}

/**
 * Why a comp has no link, in the reader's words — or null when it has
 * one, or when it never had an id to build one from.
 *
 * Said out loud rather than left as a missing icon: a comp with no
 * link beside fifteen that have one reads as a bug, and the reason is
 * a fact about the listing worth knowing before anyone rings a
 * landlord about the street it is on.
 */
export function compLinkNote(
  comp: Pick<StrComp, "linkWithheld">
): string | null {
  return comp.linkWithheld === "calendar-closed"
    ? "No open or booked night in the last 90 days — may no longer be listed"
    : null;
}
