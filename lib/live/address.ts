/**
 * One thing an address line needs before it is shown or geocoded.
 *
 * This module used to be a whole address-matching toolkit — keys two
 * vendors could agree on, so a picture from one could be welded onto a
 * row from the other. That matching is gone, and so are the keys: this
 * product displays no listing photos, so there is nothing to match a
 * photo to. What is left is the one transform the furnished search
 * still needs.
 */

/**
 * The postal part of a listing's address line.
 *
 * Apartment listings arrive as "Community Name | 5000 Big Island Dr".
 * The building's marketing name is not an address: it geocodes to
 * nothing, and it reads as noise on a card — and because plenty of them
 * start with a digit ("5 Thousand Town"), a leading-number check waves
 * the whole string through as if it were a street. Take the street.
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
