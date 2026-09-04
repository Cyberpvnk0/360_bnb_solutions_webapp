/**
 * One street address, reduced to a key two vendors can agree on.
 *
 * The rentals feed and the listing site share no identifiers — only
 * buildings — so putting a row together with its listing page means
 * deciding that "1204 Glencoe Street, Tampa, FL 33602" and "1204
 * Glencoe St" are the same place, and that unit 1 and unit 2 are not.
 *
 * This module was deleted once, when the thing being matched was a
 * photograph and the answer to photographs became "link, never copy".
 * It is back because the same join answers two questions that are not
 * about copying at all: WHICH page on the listing site is this exact
 * property, and WHO does the listing say to call. A wrong match is
 * still the failure that matters — a stranger's phone number under
 * somebody's address reads as fact — so the keys stay strict and a
 * near-miss stays unmatched.
 *
 * Pure string work, in its own module so the browser can key the rows
 * it already has without pulling a server module in behind it.
 */

/** Longhand → the short form both vendors reduce to. */
const SUFFIXES: [RegExp, string][] = [
  [/\b(street|st)\b/g, "st"],
  [/\b(avenue|ave)\b/g, "ave"],
  [/\b(road|rd)\b/g, "rd"],
  [/\b(drive|dr)\b/g, "dr"],
  [/\b(lane|ln)\b/g, "ln"],
  [/\b(court|ct)\b/g, "ct"],
  [/\b(boulevard|blvd)\b/g, "blvd"],
  [/\b(terrace|ter)\b/g, "ter"],
  [/\b(place|pl)\b/g, "pl"],
  [/\b(circle|cir)\b/g, "cir"],
  [/\b(parkway|pkwy)\b/g, "pkwy"],
  [/\b(highway|hwy)\b/g, "hwy"],
  [/\b(trail|trl)\b/g, "trl"],
  [/\b(expressway|expy)\b/g, "expy"],
  [/\b(square|sq)\b/g, "sq"],
  [/\b(crossing|xing)\b/g, "xing"],
  [/\b(point|pt)\b/g, "pt"],
  [/\b(mount|mt)\b/g, "mt"],
  // Written into street NAMES, not just suffixes — "St Johns Ave" is
  // Saint Johns, and one vendor spells it out. Folding saint into "st"
  // is safe because "Main Street" has already become "main st" by the
  // time anything compares.
  [/\b(saint)\b/g, "st"],
  [/\b(fort|ft)\b/g, "ft"],
  [/\b(apartment|apt|unit|ste|suite)\b/g, "unit"],
  // Directionals, spelled out on one side and lettered on the other.
  // "9256 7th Ave S" and "9256 7th Avenue South" are the same building,
  // and without these they were two different keys — which on a grid of
  // numbered streets is a large share of every city.
  [/\b(northeast|ne)\b/g, "ne"],
  [/\b(northwest|nw)\b/g, "nw"],
  [/\b(southeast|se)\b/g, "se"],
  [/\b(southwest|sw)\b/g, "sw"],
  [/\b(north|n)\b/g, "n"],
  [/\b(south|s)\b/g, "s"],
  [/\b(east|e)\b/g, "e"],
  [/\b(west|w)\b/g, "w"],
];

const DIRECTIONALS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

/**
 * Move any directional to the end, in a fixed order.
 *
 * The two sources disagree about where it goes, and so does each source
 * with itself: one Jacksonville probe returned "1530 21st st w" and
 * "92 w 55th st" from the SAME feed. "1530 W 21st St" and "1530 21st St
 * W" are one street, and as keys they never met.
 *
 * The directional is moved, never dropped — West 21st and East 21st are
 * different streets, and a key that forgot which would put one
 * building's photo on another's row.
 */
function canonicaliseDirectionals(street: string): string {
  const tokens = street.split(" ").filter(Boolean);
  const heading = tokens.filter((t) => DIRECTIONALS.has(t));
  if (heading.length === 0) return street;
  const rest = tokens.filter((t) => !DIRECTIONALS.has(t));
  // A street that is ONLY a directional ("100 West") has nothing left to
  // name it, so leave it as it came.
  if (rest.length === 0) return street;
  return [...rest, ...heading.sort()].join(" ");
}

/** A comma-separated part that belongs to the street, not the city:
 *  "Apt 902", "#4B", "Unit 12". */
const UNIT_PART = /^(?:#|(?:apartment|apt|unit|ste|suite)\b\.?)\s*([\w-]+)$/i;

/** The same, sitting on the end of the street line rather than in its
 *  own comma-separated part. */
const INLINE_UNIT = /\s+(?:#\s*|(?:apartment|apt|unit|ste|suite)\b\.?\s*)([\w-]+)\s*$/i;

/**
 * The comparable form of an address, or null when there isn't one.
 *
 * The city, state and ZIP are dropped rather than parsed around: one
 * vendor writes the full postal address and the other often writes only
 * the street, so anything that keeps the tail can only match when both
 * happen to include it. An earlier cut split on the literal string
 * "jacksonville" — correct for the market it was written against and
 * quietly wrong for the other 386, which is why every row outside that
 * one city kept its sketch.
 */
export function addressKey(address: string): string | null {
  const parsed = parseAddress(address);
  if (parsed === null) return null;
  // The unit is appended, never left inline. Stripping the word "Apt"
  // and leaving its value in the street turned "1000 Main St Apt N"
  // into "1000 main st n" — the same key as "1000 Main St N", a
  // different building. A wrong photo is worse than no photo.
  return parsed.unit === null
    ? parsed.street
    : `${parsed.street} #${parsed.unit}`;
}

/**
 * The same address with the unit dropped — the building, not the flat.
 *
 * The two sources disagree about granularity, not just spelling. One
 * lists every unit in a block separately; the other photographs the
 * block once. Keyed strictly, "9256 7th Ave Unit 4" matches nothing,
 * and every apartment in the city goes without a picture.
 *
 * A fallback behind the exact key, and an honest one: the photo really
 * is that building. It is not that unit's kitchen, which is why an
 * exact match always wins.
 */
export function buildingKey(address: string): string | null {
  return parseAddress(address)?.street ?? null;
}

interface ParsedAddress {
  /** "1530 21st st w" — number, street, directional last. */
  street: string;
  /** The unit's own designation, or null. Never folded into street. */
  unit: string | null;
}

/**
 * The postal part of a listing's address line.
 *
 * Apartment listings arrive as "Community Name | 5000 Big Island Dr".
 * The building's marketing name is not an address: it matches nothing
 * on the other side of a join, and it reads as noise on a card — and
 * because plenty of them start with a digit ("5 Thousand Town"), a
 * leading-number check waves the whole string through as if it were a
 * street. Take the street.
 */
export function streetPartOf(address: string): string {
  if (!address.includes("|")) return address;
  return (
    address
      .split("|")
      .map((p) => p.trim())
      .filter((p) => /^\d/.test(p))
      .pop() ?? address.split("|").pop()!.trim()
  );
}

function parseAddress(address: string): ParsedAddress | null {
  // Commas separate street from city; a unit can fall on either side.
  const parts = streetPartOf(address).split(",").map((p) => p.trim());
  const streetParts: string[] = [];
  let unit: string | null = null;
  for (const [i, part] of parts.entries()) {
    if (part === "") continue;
    const asUnit = part.match(UNIT_PART);
    if (asUnit) {
      unit ??= asUnit[1];
    } else if (i === 0) {
      streetParts.push(part);
    } else {
      break;
    }
  }

  // A unit can also sit inline: "900 Main St Apt 5", "900 Main St #5".
  let street = streetParts.join(" ");
  const inline = street.match(INLINE_UNIT);
  if (inline) {
    unit ??= inline[1];
    street = street.slice(0, inline.index).trim();
  }

  street = normaliseStreet(street);
  const number = street.match(/^\d+/)?.[0];
  if (!number) return null;
  if (street.slice(number.length).trim().length < 3) return null;
  return { street, unit: unit === null ? null : unit.toLowerCase().replace(/[^a-z0-9]/g, "") };
}

function normaliseStreet(raw: string): string {
  let cleaned = raw
    .toLowerCase()
    .replace(/[.#]/g, " ")
    // "N.W." arrives here as "n w"; rejoin it before the table below
    // turns each half into a separate token.
    .replace(/\b([ns])\s+([ew])\b/g, "$1$2");
  for (const [pattern, short] of SUFFIXES) cleaned = cleaned.replace(pattern, short);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const number = cleaned.match(/^\d+/)?.[0] ?? "";
  const rest = canonicaliseDirectionals(cleaned.slice(number.length).trim());
  return `${number} ${rest}`.trim();
}
