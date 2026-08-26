/**
 * One street address, reduced to a key two vendors can agree on.
 *
 * The rentals feed and the photo source share no identifiers — only
 * buildings — so matching a picture to a row means deciding that
 * "1204 Glencoe Street, Tampa, FL 33602" and "1204 Glencoe St" are the
 * same place, and that unit 1 and unit 2 are not.
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

/** A comma-separated part that belongs to the street, not the city:
 *  "Apt 902", "#4B", "Unit 12". */
const UNIT_PART = /^(?:#|(?:apartment|apt|unit|ste|suite)\b\.?)\s*[\w-]+$/i;

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
  // Commas separate street from city; a unit can fall on either side.
  const parts = address.split(",").map((p) => p.trim());
  const street: string[] = [];
  for (const [i, part] of parts.entries()) {
    if (part === "") continue;
    if (i === 0 || UNIT_PART.test(part)) street.push(part);
    else break;
  }

  let cleaned = street
    .join(" ")
    .toLowerCase()
    .replace(/[.#]/g, " ")
    // "N.W." arrives here as "n w"; rejoin it before the table below
    // turns each half into a separate token.
    .replace(/\b([ns])\s+([ew])\b/g, "$1$2");
  for (const [pattern, short] of SUFFIXES) cleaned = cleaned.replace(pattern, short);
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const number = cleaned.match(/^\d+/)?.[0];
  if (!number) return null;

  const rest = cleaned
    .slice(number.length)
    // The unit NUMBER distinguishes units; the word in front of it does
    // not, and "#902" strips to a bare number while "Apt 902" doesn't.
    .replace(/\bunit\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (rest.length < 3) return null;
  return `${number} ${rest}`;
}

/**
 * The same address with the unit dropped — the building, not the flat.
 *
 * The two sources disagree about granularity, not just spelling. One
 * lists every unit in a block separately; the other photographs the
 * block once. Keyed strictly, "9256 7th Ave Unit 4" matches nothing,
 * and every apartment in the city goes without a picture — which is
 * most of them.
 *
 * Only an EXPLICIT unit is removed: "Apt 4", "#12B", "Unit 3". A bare
 * trailing number is left alone, because "1000 Highway 41" is not
 * unit 41 of Highway, and merging it with Highway 9 would put one
 * building's photo on another's row.
 *
 * A fallback behind the exact key, and an honest one: the photo really
 * is that building. It is not that unit's kitchen, which is why an
 * exact match always wins.
 */
export function buildingKey(address: string): string | null {
  const withoutUnit = address.replace(
    // The word boundary belongs to the spelled-out forms only: there is
    // no boundary between a space and a "#", so \b# never matches.
    /(?:,\s*)?(?:#|\b(?:apartment|apt|unit|ste|suite)\b\.?)\s*[\w-]+/gi,
    " "
  );
  return addressKey(withoutUnit);
}
