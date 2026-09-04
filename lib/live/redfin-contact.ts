/**
 * Who to ring about a rental, read off the listing's own page.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE. The portal's SEARCH endpoint does
 * not carry contact details: a shape probe over 164 Jacksonville rentals
 * found no agent name, no broker name and no email, and a `phone` field
 * that is the empty string on every single row. That is recorded in
 * lib/live/redfin so nobody re-derives it. But the contact IS on the
 * listing page — "Text or call (407) 205-7960" sits under the message
 * box on every rental — so the page is where it has to come from.
 *
 * THE ONE RULE OF THIS MODULE, inherited from lib/live/scraperapi: the
 * fetched document is a local. It is never returned, stored, logged, or
 * sent to a browser. What comes out is a name and a telephone number.
 * That distinction is the whole reason this is allowed to exist where a
 * photo merge is not: a photograph is somebody's copyrighted work,
 * while a name and a number are facts about who to ring — the facts a
 * caller needs and the only ones this takes.
 *
 * ON DEMAND, NEVER IN BULK. One page per property a student actually
 * opens, capped daily and cached for a month, rather than a pass over
 * every row in a market. A market is five hundred listings and almost
 * nobody rings five hundred landlords.
 *
 * NEVER GUESSES. Every candidate below comes from somewhere on the page
 * that is ABOUT this listing — a tel: link, the contact block's own
 * words, a structured field under an agent or broker key. A number
 * scraped from a footer would be the portal's switchboard printed under
 * a stranger's address, which reads as fact and gets dialled.
 */

import {
  isChallenge,
  readListingPage,
  ScraperApiError,
} from "@/lib/live/scraperapi";
import type { ListingContact } from "@/lib/mock/types";

/* ------------------------------------------------------------------ */
/* Telephone numbers                                                   */
/* ------------------------------------------------------------------ */

/**
 * A North American number, in any of the shapes a page writes one:
 * "(407) 205-7960", "407-205-7960", "407.205.7960", "+1 407 205 7960",
 * "tel:+14072057960".
 */
const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?!\d)/g;

/** Prefixes a real listing rarely uses and a switchboard usually does. */
const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

/**
 * The 555-01xx block is reserved for fiction, and our own preview
 * inventory uses it. A live row carrying one means an extractor read
 * seeded data, which must never reach a card as a real number.
 */
function isReserved(area: string, exchange: string, line: string): boolean {
  if (exchange === "555" && line.startsWith("01")) return true;
  // 000-0000, 111-1111 and the like are placeholders, not numbers.
  if (/^(\d)\1{2}$/.test(area) && /^(\d)\1{2}$/.test(exchange)) return true;
  if (/^(\d)\1{3}$/.test(line) && /^(\d)\1{2}$/.test(exchange)) return true;
  return false;
}

export interface PhoneCandidate {
  /** Display form, always "(407) 205-7960". */
  phone: string;
  /** Lower is better: how directly the page tied this to the listing. */
  tier: number;
  tollFree: boolean;
}

/** Every usable number in a fragment, tagged with how much to trust it. */
function phonesIn(text: string, tier: number): PhoneCandidate[] {
  const out: PhoneCandidate[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const [, area, exchange, line] = m;
    if (isReserved(area, exchange, line)) continue;
    out.push({
      phone: `(${area}) ${exchange}-${line}`,
      tier,
      tollFree: TOLL_FREE.has(area),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Where on a page a contact hides                                     */
/* ------------------------------------------------------------------ */

/**
 * The contact block's own words, and the number that follows them.
 *
 * This is the highest-confidence source on the page because it is the
 * one a human reads: it sits inside "Contact <address>", beside the
 * message box, and it says what to do with the number.
 *
 * TWO LISTS, NOT ONE. An unambiguous instruction to ring THIS listing
 * outranks everything; a bare "call" or "phone" is a word that also
 * appears in markup, analytics and boilerplate, so it sits below the
 * structured sources rather than above them. Both allow a few tags
 * between the words and the number, since the number is usually a link.
 */
const LEAD_IN = String.raw`\s*[:;]?\s*(?:<[^>]*>\s*)*([^<]{0,40})`;

const CONTACT_PHRASES = new RegExp(
  String.raw`(?:text or call|call or text|call now|call us at|contact us at|leasing office|leasing agent)` +
    LEAD_IN,
  "gi"
);

const LOOSE_PHRASES = new RegExp(
  String.raw`(?:\bphone(?:\s*number)?\b|\bcall\b)` + LEAD_IN,
  "gi"
);

function fromPhrases(doc: string, re: RegExp, tier: number): PhoneCandidate[] {
  const out: PhoneCandidate[] = [];
  for (const m of doc.matchAll(re)) out.push(...phonesIn(m[1], tier));
  return out;
}

/** A tel: link is a number the page itself asks a browser to dial. */
function fromTelLinks(doc: string): PhoneCandidate[] {
  const out: PhoneCandidate[] = [];
  for (const m of doc.matchAll(/href=["']tel:([^"']{7,24})["']/gi)) {
    out.push(...phonesIn(m[1], 1));
  }
  return out;
}

/** Keys an embedded blob files a listing's telephone under. */
const PHONE_KEYS =
  /^(?:telephone|phone|phoneNumber|contactPhone|displayPhone|agentPhone|brokerPhone|officePhone|leasingPhone)$/i;

/** Keys that name the person or firm letting the property. */
const NAME_KEYS =
  /^(?:agentName|listingAgentName|contactName|salesAgentName)$/i;
const COMPANY_KEYS =
  /^(?:brokerName|listingBrokerName|brokerageName|officeName|listingOfficeName|managementCompany|propertyManagerName|companyName)$/i;

interface Harvest {
  phones: PhoneCandidate[];
  names: string[];
  companies: string[];
}

/**
 * Every contact-shaped value in an embedded JSON blob, at any depth.
 *
 * Bounded on both depth and count: a portal's server state is megabytes
 * of view model, and walking all of it to find a phone number is how a
 * request times out.
 */
function harvest(value: unknown, out: Harvest, depth = 0): Harvest {
  if (depth > 10) return out;
  if (out.phones.length > 40 || out.names.length > 20) return out;
  if (Array.isArray(value)) {
    for (const v of value) harvest(v, out, depth + 1);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") {
      if (PHONE_KEYS.test(k)) out.phones.push(...phonesIn(v, 2));
      else if (NAME_KEYS.test(k)) out.names.push(v.trim());
      else if (COMPANY_KEYS.test(k)) out.companies.push(v.trim());
      continue;
    }
    harvest(v, out, depth + 1);
  }
  return out;
}

/** Embedded JSON blobs worth walking: schema.org and framework state. */
function jsonBlobs(doc: string): string[] {
  const blobs: string[] = [];
  const patterns = [
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]*id=["'](?:__NEXT_DATA__|__REACT_QUERY_STATE__|reactServerState)["'][^>]*>([\s\S]*?)<\/script>/gi,
  ];
  for (const re of patterns) {
    for (const m of doc.matchAll(re)) if (m[1]?.trim()) blobs.push(m[1]);
  }
  return blobs.slice(0, 12);
}

function fromEmbeddedJson(doc: string): Harvest {
  const out: Harvest = { phones: [], names: [], companies: [] };
  for (const blob of jsonBlobs(doc)) {
    try {
      harvest(JSON.parse(blob), out);
    } catch {
      // A malformed blob is not a reason to abandon the others.
    }
  }
  return out;
}

/**
 * A name we will actually print. Anything that reads like markup, a
 * sentence, or a placeholder is dropped rather than shown — a wrong
 * name beside a right number is worse than the number alone.
 */
function usableName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return undefined;
  if (/[<>{}]|https?:/i.test(name)) return undefined;
  if (/^(?:n\/?a|none|null|undefined|unknown|redfin)$/i.test(name)) return undefined;
  return name;
}

/* ------------------------------------------------------------------ */
/* The public surface: a contact, or nothing                           */
/* ------------------------------------------------------------------ */

/**
 * What the listing page says about who to contact, or null when it says
 * nothing we would stand behind.
 *
 * Null is a real answer and the panel already knows how to show it. A
 * blank is honest; a switchboard number under somebody's address is not.
 */
export function extractRedfinContact(doc: string): ListingContact | null {
  const embedded = fromEmbeddedJson(doc);
  const candidates = [
    ...fromPhrases(doc, CONTACT_PHRASES, 0),
    ...fromTelLinks(doc),
    ...embedded.phones,
    ...fromPhrases(doc, LOOSE_PHRASES, 3),
  ];

  // Most directly tied to the listing first, and a local number ahead of
  // a toll-free one at the same tier: a switchboard is the failure mode
  // this whole module is built to avoid.
  candidates.sort(
    (a, b) => a.tier - b.tier || Number(a.tollFree) - Number(b.tollFree)
  );
  const phone = candidates[0]?.phone;

  const name = usableName(embedded.names[0]);
  const company = usableName(embedded.companies[0]);
  if (!phone && !name && !company) return null;

  // Say what we actually know it is. A named person is an agent, a firm
  // on its own is a broker, and a number with neither is a contact on
  // the listing — which is true, and does not promote a leasing office
  // into somebody's agent.
  const role: ListingContact["role"] = name
    ? "Listing agent"
    : company
      ? "Listing broker"
      : "Listing contact";

  return {
    ...(name ? { name } : {}),
    ...(company ? { company } : {}),
    ...(phone ? { phone } : {}),
    role,
  };
}

/**
 * Structural read of a listing page: COUNTS ONLY, never content.
 *
 * An extraction that comes back empty has half a dozen possible causes
 * — the page was a block screen, the number is rendered by script after
 * load, the keys are named something this file has never seen — and
 * they need opposite fixes. Guessing between them costs a billed scrape
 * per guess. This answers which one it was in a single read, without
 * ever quoting the page.
 */
export interface ContactSignals {
  bytes: number;
  /** Candidates each source found, in the order they are trusted. */
  fromContactPhrase: number;
  fromTelLink: number;
  fromEmbeddedJson: number;
  fromLoosePhrase: number;
  /** Blobs of embedded JSON that parsed. */
  jsonBlobs: number;
  namesFound: number;
  companiesFound: number;
  /** An anti-bot interstitial rather than the page we asked for. */
  looksLikeChallenge: boolean;
}

export function contactSignals(doc: string): ContactSignals {
  const embedded = fromEmbeddedJson(doc);
  return {
    bytes: doc.length,
    fromContactPhrase: fromPhrases(doc, CONTACT_PHRASES, 0).length,
    fromTelLink: fromTelLinks(doc).length,
    fromEmbeddedJson: embedded.phones.length,
    fromLoosePhrase: fromPhrases(doc, LOOSE_PHRASES, 3).length,
    jsonBlobs: jsonBlobs(doc).length,
    namesFound: embedded.names.length,
    companiesFound: embedded.companies.length,
    looksLikeChallenge: isChallenge(doc),
  };
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export interface ContactRead {
  contact: ListingContact | null;
  /** Credits this read cost, when the vendor reported them. */
  credits: number | null;
  /** True when every tier was served an anti-bot interstitial. The row
   *  has no contact because we were refused, not because it published
   *  none — and those two must never look the same to a reader. */
  blocked: boolean;
  /** Counts only, and only when asked for. See ContactSignals. */
  signals?: ContactSignals;
}

/** Only ever a listing page on the source site. This string reaches the
 *  scraper as a URL to fetch, so it is checked here rather than trusted. */
export function isListingPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)redfin\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Read one listing page and return who to ring.
 *
 * Throws only on transport and auth problems, which the route turns
 * into an honest reason. A page that simply publishes no contact is not
 * a failure: it returns null, which the panel already says out loud.
 */
export async function fetchRedfinContact(
  url: string,
  opts: { probe?: boolean } = {}
): Promise<ContactRead> {
  if (!isListingPageUrl(url)) {
    throw new ScraperApiError("http", 400, "not a listing page URL");
  }
  const { outcome, spent, challenged } = await readListingPage(url);
  const signals = opts.probe ? contactSignals(outcome.doc) : undefined;
  if (challenged) {
    return { contact: null, credits: spent || null, blocked: true, signals };
  }
  return {
    contact: extractRedfinContact(outcome.doc),
    credits: spent || null,
    blocked: false,
    signals,
  };
  // `outcome.doc` goes out of scope here and is never persisted.
}
