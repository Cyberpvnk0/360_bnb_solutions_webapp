/**
 * Where a comp can be opened.
 *
 * Fresh comps carry `listingUrl` from the mapper. Comps bought before
 * that field existed sit in the store for a month with only their id —
 * and the id is the page: a live comp's id is "sc-live-<platform id>",
 * and the platform's room URL is built from nothing else. So the link
 * is derived here, at render, for both.
 */

import type { StrComp } from "@/lib/mock/types";

export function compListingUrl(comp: Pick<StrComp, "id" | "listingUrl">): string | null {
  if (comp.listingUrl) return comp.listingUrl;
  const m = /^sc-live-(\d{5,})$/.exec(comp.id);
  return m ? `https://www.airbnb.com/rooms/${m[1]}` : null;
}
