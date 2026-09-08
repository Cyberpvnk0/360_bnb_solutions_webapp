/**
 * Deal lists as this browser used to keep them.
 *
 * Lists belong to the account now (deal_lists / deal_list_items, loaded
 * through lib/db/user-data). This module remains for two jobs: reading
 * what an earlier build left in localStorage so it can be moved up to
 * the account once, and the listing-shape check both paths share.
 *
 * Everything here is defensive by design. Stored JSON is user-editable
 * and can be stale from an older build, so a malformed blob must never
 * break the app: it is discarded.
 */

import type { DealList, RentalListing } from "@/lib/mock/types";

const today = () => new Date().toISOString().slice(0, 10);

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
      createdAt: today(),
      listings: [],
    },
  ];
}

export function isListing(value: unknown): value is RentalListing {
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
      createdAt: typeof l.createdAt === "string" ? l.createdAt : today(),
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

/** Overwrite this device's stored lists — used to clear them once they
 *  have been moved to the account. Silently no-ops when storage is
 *  unavailable. */
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
