/**
 * Deal lists, kept in the browser.
 *
 * A hunter's saved rentals survive a refresh without an account: the
 * lists live in localStorage on this device only. When real accounts
 * land (Supabase), this module is the seam — swap read/write for
 * fetches and every caller stays put.
 *
 * Everything here is defensive by design. Stored JSON is user-editable
 * and can be stale from an older build, so a malformed blob must never
 * break the app: it's discarded and the default list comes back.
 */

import { MOCK_TODAY } from "@/lib/mock/seed";
import type { DealList, RentalListing } from "@/lib/mock/types";

export const DEAL_LISTS_KEY = "arbicore.deal-lists.v1";

/** Bounds so a runaway loop can't blow the ~5MB storage quota. */
const MAX_LISTS = 50;
const MAX_LISTINGS_PER_LIST = 500;

/** Everyone starts with one list, so "Add to list" is one click. */
export function defaultLists(): DealList[] {
  return [
    {
      id: "list-default",
      name: "My shortlist",
      createdAt: MOCK_TODAY,
      listings: [],
    },
  ];
}

function isListing(value: unknown): value is RentalListing {
  if (!value || typeof value !== "object") return false;
  const l = value as Partial<RentalListing>;
  return (
    typeof l.id === "string" &&
    typeof l.analysisId === "string" &&
    typeof l.address === "string" &&
    typeof l.marketSlug === "string" &&
    typeof l.rentMonthly === "number" &&
    typeof l.bedrooms === "number" &&
    typeof l.lat === "number" &&
    typeof l.lon === "number" &&
    Array.isArray(l.features)
  );
}

/** Parse stored JSON into lists, dropping anything that doesn't fit. */
export function parseLists(raw: string | null): DealList[] | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const lists: DealList[] = [];
  for (const entry of data.slice(0, MAX_LISTS)) {
    if (!entry || typeof entry !== "object") continue;
    const l = entry as Partial<DealList>;
    if (typeof l.id !== "string" || typeof l.name !== "string") continue;
    const listings = Array.isArray(l.listings)
      ? l.listings.filter(isListing).slice(0, MAX_LISTINGS_PER_LIST)
      : [];
    lists.push({
      id: l.id,
      name: l.name,
      createdAt: typeof l.createdAt === "string" ? l.createdAt : MOCK_TODAY,
      listings,
    });
  }
  return lists.length > 0 ? lists : null;
}

/** Read this device's lists, or null when there's nothing usable. */
export function readLists(storage: Pick<Storage, "getItem">): DealList[] | null {
  try {
    return parseLists(storage.getItem(DEAL_LISTS_KEY));
  } catch {
    // Private mode and blocked-storage settings both throw on access.
    return null;
  }
}

/** Persist lists. Silently no-ops when storage is unavailable or full —
 *  losing a save is never worth crashing a browsing session. */
export function writeLists(
  storage: Pick<Storage, "setItem">,
  lists: DealList[]
): boolean {
  try {
    const trimmed = lists.slice(0, MAX_LISTS).map((l) => ({
      ...l,
      listings: l.listings.slice(0, MAX_LISTINGS_PER_LIST),
    }));
    storage.setItem(DEAL_LISTS_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}
