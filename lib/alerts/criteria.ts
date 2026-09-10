/**
 * What a new rental has to be, for an alert to say so.
 *
 * The Deal Finder's own filters, frozen: furnished or not, exact
 * bedroom and bathroom counts, the home types, and a rent band. An
 * alert is set from the filters on screen, so what a person sees is
 * what they will be told about. Kept as JSON on the row, read back
 * defensively, matched with the same rules the grid uses
 * (components/deals/deals-explorer, matchesFilters) minus the market
 * query, which the alert's scope already settles.
 */

import type { PropertyType, RentalListing } from "@/lib/mock/types";

export const PROPERTY_TYPES: PropertyType[] = ["apartment", "house", "condo", "townhome"];

export interface AlertCriteria {
  furnishedOnly: boolean;
  /** Exact counts; empty is any. 5 means five or more. */
  beds: number[];
  baths: number[];
  /** Empty is every type. */
  types: PropertyType[];
  rentMin: number | null;
  rentMax: number | null;
}

/** The Deal Finder's filter shape, as far as an alert reads it. */
export interface FilterLike {
  furnishedOnly: boolean;
  beds: number[];
  baths: number[];
  types: PropertyType[];
  rentMin: number;
  rentMax: number;
}

const counts = (v: unknown): number[] =>
  Array.isArray(v)
    ? Array.from(new Set(v.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 5))).sort((a, b) => a - b)
    : [];

const isType = (v: unknown): v is PropertyType => typeof v === "string" && (PROPERTY_TYPES as string[]).includes(v);

/** The alert's criteria from the filters on screen. A slider at its
 *  end is no bound, and every type checked is no type filter. */
export function criteriaFromFilters(f: FilterLike, defaults: FilterLike): AlertCriteria {
  const types = f.types.filter(isType);
  return {
    furnishedOnly: Boolean(f.furnishedOnly),
    beds: counts(f.beds),
    baths: counts(f.baths),
    types: types.length === 0 || types.length >= PROPERTY_TYPES.length ? [] : types,
    rentMin: f.rentMin > defaults.rentMin ? f.rentMin : null,
    rentMax: f.rentMax < defaults.rentMax ? f.rentMax : null,
  };
}

/** Criteria off a row, whatever an older build wrote there. */
export function readCriteria(raw: unknown): AlertCriteria {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  return {
    furnishedOnly: r.furnishedOnly === true,
    beds: counts(r.beds),
    baths: counts(r.baths),
    types: Array.isArray(r.types) ? r.types.filter(isType) : [],
    rentMin: money(r.rentMin),
    rentMax: money(r.rentMax),
  };
}

export function matchesCriteria(l: RentalListing, c: AlertCriteria): boolean {
  if (c.rentMin !== null && l.rentMonthly < c.rentMin) return false;
  if (c.rentMax !== null && l.rentMonthly > c.rentMax) return false;
  if (c.beds.length > 0 && !c.beds.includes(Math.min(5, l.bedrooms))) return false;
  if (c.baths.length > 0 && !c.baths.includes(Math.min(5, Math.floor(l.bathrooms)))) return false;
  if (c.types.length > 0 && !c.types.includes(l.propertyType)) return false;
  // Unknown amenities never exclude: absence of data is not absence.
  if (c.furnishedOnly && l.featuresKnown !== false && !l.features.includes("Furnished")) return false;
  return true;
}

const TYPE_LABEL: Record<PropertyType, string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhome: "Townhome",
};

/** A run of counts as people say them: "1–2 bd", "3 bd", "5+ bd". */
function countsLabel(list: number[], unit: string): string {
  if (list.length === 0) return "";
  const contiguous = list.every((n, i) => i === 0 || n === list[i - 1] + 1);
  const top = (n: number) => (n === 5 ? "5+" : String(n));
  if (list.length === 1) return `${top(list[0])} ${unit}`;
  if (contiguous) return `${list[0]}–${top(list[list.length - 1])} ${unit}`;
  return `${list.map(top).join(", ")} ${unit}`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The criteria in a line: "Furnished · 1–2 bd · $1,000 to $2,000 · House, Condo". */
export function describeCriteria(c: AlertCriteria): string {
  const parts: string[] = [];
  if (c.furnishedOnly) parts.push("Furnished");
  const beds = countsLabel(c.beds, "bd");
  if (beds) parts.push(beds);
  const baths = countsLabel(c.baths, "ba");
  if (baths) parts.push(baths);
  if (c.rentMin !== null && c.rentMax !== null) parts.push(`${money(c.rentMin)} to ${money(c.rentMax)}`);
  else if (c.rentMin !== null) parts.push(`${money(c.rentMin)} and up`);
  else if (c.rentMax !== null) parts.push(`up to ${money(c.rentMax)}`);
  if (c.types.length > 0) parts.push(c.types.map((t) => TYPE_LABEL[t]).join(", "));
  return parts.length > 0 ? parts.join(" · ") : "Any rental";
}
