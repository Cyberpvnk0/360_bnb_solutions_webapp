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

  let cleaned = street.join(" ").toLowerCase().replace(/[.#]/g, " ");
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
