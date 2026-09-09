/**
 * One listing written twice, shown once.
 *
 * A feed carries the same property under two lines now and then: the
 * house and the house with its room number, a relist beside the
 * original, a unit the two sides of a join wrote differently. Two cards
 * with one street address, one rent and one floor plan read as a bug,
 * and a student counting deals counts the same one twice.
 *
 * NARROW ON PURPOSE. The failure that matters is hiding a real second
 * unit, so two rows collapse only when everything this can check says
 * they are one place: the same building (number and street, on
 * lib/live/address's key), the same town, the same rent, the same
 * bedroom count and the same stated size — and the two lines are the
 * same, or differ only by a unit label that one of them carries. Two
 * rows that each name a unit are two units, whatever else they share.
 * A row whose size the feed did not state is left alone. A different
 * rent or bedroom count is a different listing. Anything this cannot
 * prove stays on the grid.
 *
 * The kept row is the one that knows more — a listing page, a contact,
 * the unit label — and takes from the dropped one whatever it lacked.
 * Order is the feed's own.
 *
 * Client-safe: pure string work over rows the browser already holds.
 */

import { addressKey, buildingKey } from "./address";
import { zipOf } from "./zip";
import type { RentalListing } from "@/lib/mock/types";

interface Keyed {
  /** Number and street: the building. */
  building: string;
  /** The building plus the unit, when the line names one. */
  full: string;
  labeled: boolean;
  town: string;
  rent: number;
  beds: number;
  sqft: number;
}

function keyOf(row: RentalListing): Keyed | null {
  const building = buildingKey(row.address);
  const full = addressKey(row.address);
  if (!building || !full) return null;
  return {
    building,
    full,
    labeled: full !== building,
    // The ZIP when either the row or its address line says one; the
    // town otherwise. Two rows in one feed carry it the same way.
    town: zipOf(row) ?? row.city.trim().toLowerCase(),
    rent: row.rentMonthly,
    beds: row.bedrooms,
    sqft: row.sqft,
  };
}

/** Whether two rows of one building are one listing. */
function sameListing(a: Keyed, b: Keyed): boolean {
  if (a.rent !== b.rent || a.beds !== b.beds) return false;
  // Both sizes stated and equal. An unstated size proves nothing.
  if (!(a.sqft > 0 && b.sqft > 0 && a.sqft === b.sqft)) return false;
  // The same line, or one line the other plus a unit label. Two
  // different labels are two units.
  return a.full === b.full || !a.labeled || !b.labeled;
}

/** Which of two twins to show: the one that knows more. */
function rank(row: RentalListing, key: Keyed): number {
  return (row.sourceUrl ? 4 : 0) + (row.contact ? 2 : 0) + (key.labeled ? 1 : 0);
}

/** `keep`, with whatever `drop` had that it lacked. */
function merged(keep: RentalListing, drop: RentalListing): RentalListing {
  const features = Array.from(new Set([...keep.features, ...drop.features]));
  const known = keep.featuresKnown || drop.featuresKnown;
  return {
    ...keep,
    ...(keep.sourceUrl || !drop.sourceUrl ? {} : { sourceUrl: drop.sourceUrl }),
    ...(keep.contact || !drop.contact ? {} : { contact: drop.contact }),
    ...(keep.zip || !drop.zip ? {} : { zip: drop.zip }),
    ...(keep.priceTrend || !drop.priceTrend ? {} : { priceTrend: drop.priceTrend }),
    features,
    ...(known === undefined ? {} : { featuresKnown: known }),
  };
}

export function collapseDuplicateListings(
  rows: readonly RentalListing[]
): RentalListing[] {
  const out: RentalListing[] = [];
  const keys: (Keyed | null)[] = [];
  /** Indices into `out`, by building and town. */
  const byPlace = new Map<string, number[]>();

  for (const row of rows) {
    const key = keyOf(row);
    if (!key) {
      out.push(row);
      keys.push(null);
      continue;
    }
    const place = `${key.building}|${key.town}`;
    const seen = byPlace.get(place) ?? [];
    const twin = seen.find((i) => sameListing(keys[i]!, key));
    if (twin === undefined) {
      seen.push(out.length);
      byPlace.set(place, seen);
      out.push(row);
      keys.push(key);
      continue;
    }
    const held = out[twin];
    if (rank(row, key) > rank(held, keys[twin]!)) {
      out[twin] = merged(row, held);
      keys[twin] = key;
    } else {
      out[twin] = merged(held, row);
    }
  }
  return out;
}
