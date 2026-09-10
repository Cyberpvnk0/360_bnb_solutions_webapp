/**
 * Who to call, across the handover from a card to the result.
 *
 * The analyzer opens in its own tab (components/deals/analyze-button),
 * so nothing the Deal Finder holds in memory reaches it: what the
 * result page knows about a property is what its URL says. The
 * lister's details ride along in the query string the way the rent
 * and the listing's page do — a row that arrived with a contact from
 * its feed, or whose overlay already read one off the listing's page,
 * must not have the result read that page again. Reading a page is a
 * billed scrape, and this one is for an answer already in hand.
 *
 * Read back with the suspicion everything in a query string gets:
 * anyone can edit a URL, and what comes out becomes a tel: and a
 * mailto: link. Lengths are capped, the role is one of the five the
 * panel knows, a number has to have the digits of one and an address
 * the shape of one. Nothing is invented to fill a gap: a URL with a
 * name and no number is a contact with a name and no number, which is
 * a thing listing pages routinely publish.
 */

import type { ListingContact } from "@/lib/mock/types";

const ROLES: readonly ListingContact["role"][] = [
  "Listing agent",
  "Listing broker",
  "Property manager",
  "Owner",
  "Listing contact",
];

/** The query keys: `c` for contact, then one letter per field. */
const KEYS = { name: "cn", company: "cc", phone: "cp", email: "ce", role: "cr" } as const;

const MAX = { name: 80, company: 120, phone: 32, email: 120 } as const;

/** Seven digits at least — a US line has ten, and the feeds print
 *  them with every kind of punctuation. */
const PHONE = /(?:\D*\d){7,}/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(v: string | undefined, max: number): string | undefined {
  const t = v?.replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : undefined;
}

/** Puts a listing's contact into an analysis URL's parameters. */
export function writeContactParams(
  params: URLSearchParams,
  contact: ListingContact | undefined
): void {
  if (!contact) return;
  const name = clean(contact.name, MAX.name);
  const company = clean(contact.company, MAX.company);
  const phone = clean(contact.phone, MAX.phone);
  const email = clean(contact.email, MAX.email);
  if (!name && !company && !phone && !email) return;
  if (name) params.set(KEYS.name, name);
  if (company) params.set(KEYS.company, company);
  if (phone) params.set(KEYS.phone, phone);
  if (email) params.set(KEYS.email, email);
  // The reader's default; leaving it out keeps the URL shorter.
  if (contact.role !== "Listing contact" && ROLES.includes(contact.role)) {
    params.set(KEYS.role, contact.role);
  }
}

/** The contact an analysis URL carries, or none. */
export function readContactParams(
  get: (key: string) => string | undefined
): ListingContact | undefined {
  const name = clean(get(KEYS.name), MAX.name);
  const company = clean(get(KEYS.company), MAX.company);
  const rawPhone = clean(get(KEYS.phone), MAX.phone);
  const phone = rawPhone && PHONE.test(rawPhone) ? rawPhone : undefined;
  const rawEmail = clean(get(KEYS.email), MAX.email);
  const email = rawEmail && EMAIL.test(rawEmail) ? rawEmail : undefined;
  if (!name && !company && !phone && !email) return undefined;
  const role = get(KEYS.role);
  return {
    ...(name ? { name } : {}),
    ...(company ? { company } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    role: ROLES.find((r) => r === role) ?? "Listing contact",
  };
}
