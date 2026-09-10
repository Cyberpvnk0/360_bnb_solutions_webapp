/**
 * A telephone number for a property whose listing gave none, from
 * public records.
 *
 * The trade calls this skip tracing; the product calls it a deep phone
 * lookup, because that is what it is to the person pressing the
 * button. The records vendor (DataSkip) is asked for the property's
 * owner — name, numbers, emails — and the owner of a rental is the
 * landlord, or one step from the manager.
 *
 * WHAT IS KEPT AND SHOWN. Names, numbers and emails: facts about who to
 * ring, the same facts the listing page would have given. They are
 * shown to the account that paid for them and kept a month in the
 * shared store so the next account pays the plan rather than the
 * vendor. Nothing here is logged. Flags that decide whether a number
 * should be rung at all — do-not-call, deceased — are honoured: a
 * deceased person is dropped, a do-not-call number is marked.
 *
 * CHARGED ONLY ON A NUMBER, ON BOTH SIDES. The vendor bills per match
 * and a miss is free; the route above this reads the account's room
 * before asking and takes the credits after, so a search that finds
 * nothing costs nobody anything. See app/api/phone-lookup.
 *
 * THE VENDOR'S CALL. One request per property:
 *
 *   POST https://app.dataskip.io/api/v1/skip-trace
 *   Authorization: Bearer <DataSkip_Key>
 *   { "address": "44 Pine St", "city": "Bridgewater", "state": "MA", "zip": "02324" }
 *
 * The address is the street line only — their docs are explicit that
 * a whole "street, city, state zip" in that field will not match — with
 * the town, state and ZIP beside it. A match answers
 *
 *   { success: true, found: true, charged: 4,
 *     contact: { firstName, lastName, fullName, propertyAddress, …, mailingAddress, … },
 *     phones: [{ number: "5555550123", type: "mobile" | "landline", dnc: false }],
 *     emails: ["owner@example.com"] }
 *
 * — the numbers and emails BESIDE the contact, the name inside it, and
 * `charged` in cents. A miss answers { success: true, found: false,
 * contact: null, charged: 0 }. A 402 means our balance with them is
 * empty; a 429 is their per-minute limit. The answer is read
 * defensively — that shape first, then the contact wherever else a
 * vendor might put it — and an answer with nothing recognisable in it
 * is reported as unreadable rather than as "no match", so a changed
 * shape shows up as a failure instead of a quiet run of empty results.
 */

import { addressKey, streetLine } from "./address";
import { isFresh, readKeyedBlob, writeKeyed } from "@/lib/db/market-store";

export interface FoundPhone {
  /** "(813) 555-0142" */
  number: string;
  type: "mobile" | "landline" | "unknown";
  /** On a do-not-call list, by the vendor's flags. Shown, never hidden. */
  dnc: boolean;
  reachable: boolean | null;
  score: number | null;
}

export interface FoundPerson {
  name: string | null;
  phones: FoundPhone[];
  emails: string[];
}

export interface PhoneLookupResult {
  persons: FoundPerson[];
}

export type PhoneLookupFailure =
  | "no-key"
  | "auth"
  | "quota"
  | "http"
  | "network"
  | "unreadable";

export type PhoneLookup =
  | { ok: true; result: PhoneLookupResult | null; from: "store" | "vendor" }
  | { ok: false; reason: PhoneLookupFailure; status?: number; detail?: string };

const DEFAULT_ENDPOINT = "https://app.dataskip.io/api/v1/skip-trace";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 25_000;

/** The names the key has been set under — ours, then the vendor's own
 *  (their CLI and SDK read SKIPTRACE_API_KEY); the first one set wins. */
const KEY_NAMES = ["DataSkip_Key", "DATASKIP_KEY", "DATA_SKIP_API", "DATASKIP_API_KEY", "SKIPTRACE_API_KEY"];

/**
 * A variable by one of its names, or by any name that starts with
 * "dataskip" in whatever casing it was saved under — variable names
 * are case-sensitive, and a key saved as DataSkip_Key must not sit
 * unread because the code spelled it DATASKIP_KEY.
 */
function envNamed(names: readonly string[], test: (name: string) => boolean): string | null {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  for (const [name, v] of Object.entries(process.env)) {
    if (test(name) && v?.trim()) return v.trim();
  }
  return null;
}

/** The key, under the name it is set by in Vercel. */
function apiKey(): string | null {
  return envNamed(KEY_NAMES, (name) => /^(data_?skip|skiptrace)/i.test(name) && !/url/i.test(name));
}

export function phoneLookupConfigured(): boolean {
  return apiKey() !== null;
}

function endpoint(): string {
  return (
    envNamed(["DATA_SKIP_API_URL", "DataSkip_Url"], (name) => /^data_?skip.*url$/i.test(name)) ??
    DEFAULT_ENDPOINT
  );
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Ten digits, or null: a North American number with the country
 *  code dropped. */
function digitsOf(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let d = String(value).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

export function formatPhone(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function flag(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    (typeof value === "string" && /^(true|y|yes|1)$/i.test(value.trim()))
  );
}

/** A flag that may be a boolean or an object of booleans. */
function anyFlag(value: unknown): boolean {
  if (flag(value)) return true;
  if (isRow(value)) return Object.values(value).some(flag);
  return false;
}

function usableName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return null;
  if (/[<>{}]|https?:/i.test(name)) return null;
  return name;
}

function nameOf(person: Row): string | null {
  const n = person.fullName ?? person.full_name ?? person.name ?? person.ownerName;
  if (typeof n === "string") return usableName(n);
  if (isRow(n)) {
    if (typeof n.full === "string") return usableName(n.full);
    return usableName(
      [n.first, n.middle, n.last]
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .join(" ")
    );
  }
  const first = person.firstName ?? person.first_name;
  const last = person.lastName ?? person.last_name;
  if (typeof first === "string" || typeof last === "string") {
    return usableName([first, last].filter((s) => typeof s === "string").join(" "));
  }
  return null;
}

function typeOf(value: unknown): FoundPhone["type"] {
  const t = String(value ?? "").toLowerCase();
  if (/mobile|cell|wireless/.test(t)) return "mobile";
  if (/land|home|voip|office|work|fixed/.test(t)) return "landline";
  return "unknown";
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The keys a contact record is recognised by. */
const CONTACT_KEYS = ["phones", "phoneNumbers", "phone_numbers", "emails", "fullName", "full_name", "name"];
/** Where the vendor may put the contact, one or several. */
const CONTACT_SLOTS = ["contact", "owner", "person", "data", "result"];
const CONTACT_LISTS = ["contacts", "owners", "persons", "results"];

function looksLikeContact(value: unknown): value is Row {
  return isRow(value) && CONTACT_KEYS.some((k) => k in value);
}

/** The contact records in an answer, wherever the vendor put them. */
function contactsIn(body: Row): Row[] {
  const out: Row[] = [];
  if (looksLikeContact(body)) out.push(body);
  for (const slot of CONTACT_SLOTS) {
    const v = body[slot];
    if (looksLikeContact(v)) out.push(v);
    else if (isRow(v)) out.push(...contactsIn(v));
  }
  for (const list of CONTACT_LISTS) {
    const v = body[list];
    if (Array.isArray(v)) for (const item of v) if (looksLikeContact(item)) out.push(item);
  }
  return out;
}

/** Reachable and mobile first; the vendor's own score settles ties. */
function byUsefulness(a: FoundPhone, b: FoundPhone): number {
  return (
    Number(b.reachable === true) - Number(a.reachable === true) ||
    Number(b.type === "mobile") - Number(a.type === "mobile") ||
    (b.score ?? 0) - (a.score ?? 0)
  );
}

function personFrom(contact: Row): FoundPerson | null {
  // The deceased are not rung. Either shape of the flag is honoured.
  if (anyFlag(contact.deceased) || anyFlag(contact.death)) return null;
  const dncPerson = anyFlag(contact.dnc) || anyFlag(contact.doNotCall);
  const rawPhones = [contact.phones, contact.phoneNumbers, contact.phone_numbers].find(Array.isArray) ?? [];
  const phones: FoundPhone[] = [];
  const seen = new Set<string>();
  for (const raw of rawPhones) {
    const rec: Row = isRow(raw) ? raw : { number: raw };
    const d = digitsOf(rec.number ?? rec.phone ?? rec.phoneNumber ?? rec.value);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    phones.push({
      number: formatPhone(d),
      type: typeOf(rec.type ?? rec.phoneType ?? rec.lineType ?? rec.line_type),
      dnc: dncPerson || anyFlag(rec.dnc) || anyFlag(rec.doNotCall),
      reachable: typeof rec.reachable === "boolean" ? rec.reachable : null,
      score: typeof rec.score === "number" ? rec.score : null,
    });
  }
  phones.sort(byUsefulness);
  const rawEmails = Array.isArray(contact.emails) ? contact.emails : [];
  const emails = Array.from(
    new Set(
      rawEmails
        .map((e) => (typeof e === "string" ? e : isRow(e) ? (e.email ?? e.address ?? e.value) : null))
        .filter(isEmail)
        .map((e) => e.trim().toLowerCase())
    )
  ).slice(0, 3);
  if (phones.length === 0 && emails.length === 0) return null;
  return { name: nameOf(contact), phones: phones.slice(0, 4), emails };
}

/**
 * The documented match: numbers and emails beside the contact, the
 * name inside it. Folded into one record so the name and the numbers
 * are not read as two people, one nameless and one unreachable.
 */
function documentedContact(body: Row): Row | null {
  if (!Array.isArray(body.phones) && !Array.isArray(body.emails)) return null;
  // No contact object: the name, if any, is beside the numbers.
  const contact = isRow(body.contact) ? body.contact : body;
  return {
    ...contact,
    phones: Array.isArray(body.phones) ? body.phones : contact.phones,
    emails: Array.isArray(body.emails) ? body.emails : contact.emails,
    dnc: body.dnc ?? contact.dnc,
    deceased: body.deceased ?? contact.deceased,
  };
}

/**
 * What the vendor's answer says, or null when it is a shape this does
 * not read — a failure, not a no-match. A miss (`found: false`, or a
 * match with nobody usable in it) is `{ persons: [] }`.
 */
export function parseSkipTrace(body: unknown): PhoneLookupResult | null {
  if (!isRow(body)) return null;
  if (body.found === false) return { persons: [] };
  const documented = documentedContact(body);
  const contacts = documented ? [documented] : contactsIn(body);
  if (contacts.length === 0) return body.found === true ? { persons: [] } : null;
  const persons: FoundPerson[] = [];
  for (const contact of contacts) {
    const person = personFrom(contact);
    if (person) persons.push(person);
  }
  return { persons: persons.slice(0, 3) };
}

/** How many numbers an answer carries. */
export function phonesIn(result: PhoneLookupResult | null): number {
  return result?.persons.reduce((n, p) => n + p.phones.length, 0) ?? 0;
}

function shapeOf(body: unknown): string {
  if (Array.isArray(body)) return `an array of ${body.length}`;
  if (!body || typeof body !== "object") return body === null ? "null" : typeof body;
  const keys = Object.keys(body);
  return `an object with keys: ${keys.slice(0, 8).join(", ") || "(none)"}`;
}

/** The vendor's own words for what went wrong, when it gave any. */
function vendorMessage(body: unknown): string | null {
  if (!isRow(body)) return null;
  const m = body.error ?? body.message ?? body.detail;
  if (typeof m === "string" && m.trim()) return m.trim().slice(0, 200);
  if (isRow(m) && typeof m.message === "string") return m.message.trim().slice(0, 200);
  return null;
}

function storeKeyFor(place: { address: string; stateCode: string }): string | null {
  const key = addressKey(place.address);
  return key ? `phone:v1:${place.stateCode.trim().toLowerCase()}:${key}` : null;
}

/**
 * The owner's contact details for one property, from the store when
 * they were asked for within the month, otherwise from the vendor and
 * then stored. A no-match is stored too, for a week. Never throws.
 */
export async function lookupPhone(place: {
  address: string;
  city: string;
  stateCode: string;
  zip: string;
}): Promise<PhoneLookup> {
  const key = storeKeyFor(place);
  if (!key) return { ok: false, reason: "unreadable", detail: "address could not be keyed" };

  const stored = await readKeyedBlob(key).catch(() => null);
  if (stored) {
    const value = stored.value as { result?: unknown };
    if (value.result && isFresh(stored.at, HIT_TTL_MS)) {
      return { ok: true, result: value.result as PhoneLookupResult, from: "store" };
    }
    if (value.result === null && isFresh(stored.at, MISS_TTL_MS)) {
      return { ok: true, result: null, from: "store" };
    }
  }

  const token = apiKey();
  if (!token) return { ok: false, reason: "no-key" };

  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        address: streetLine(place.address, place.city, place.stateCode),
        city: place.city,
        state: place.stateCode.toUpperCase(),
        zip: place.zip,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      reason: "network",
      detail: e instanceof Error && e.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000}s` : "unreachable",
    };
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth", status: res.status, detail };
    }
    if (res.status === 402 || res.status === 429) {
      return { ok: false, reason: "quota", status: res.status, detail };
    }
    return { ok: false, reason: "http", status: res.status, detail };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (isRow(body) && body.success === false) {
    // Their refusal in a 200: an insufficient balance, a bad key, a
    // malformed address. Their words go through so the diagnostic
    // says which.
    return { ok: false, reason: "http", status: res.status, detail: vendorMessage(body) ?? "the vendor refused" };
  }
  const parsed = parseSkipTrace(body);
  if (parsed === null) {
    return { ok: false, reason: "unreadable", detail: `no contact in ${shapeOf(body)}` };
  }
  const result = parsed.persons.length > 0 ? parsed : null;
  void writeKeyed(key, { result }).catch(() => undefined);
  return { ok: true, result, from: "vendor" };
}
