/**
 * A telephone number for a property whose listing gave none, from
 * public records.
 *
 * The trade calls this skip tracing; the product calls it a deep phone
 * lookup, because that is what it is to the person pressing the
 * button. The records vendor is asked for the property's owner — name,
 * numbers, emails — and the owner of a rental is the landlord, or one
 * step from the manager.
 *
 * WHAT IS KEPT AND SHOWN. Names, numbers and emails: facts about who to
 * ring, the same facts the listing page would have given. They are
 * shown to the account that paid for them and kept a month in the
 * shared store so the next account pays the plan rather than the
 * vendor. Nothing here is logged. Flags that decide whether a number
 * should be rung at all — do-not-call, deceased — are honoured: a
 * deceased person is dropped, a do-not-call number is marked.
 *
 * CHARGED ONLY ON A NUMBER. The route above this reads the account's
 * room before asking the vendor and takes the credits after, so a
 * search that finds nothing costs the account nothing. See
 * app/api/phone-lookup.
 *
 * The vendor's answer is read defensively — the persons array wherever
 * it sits, the fields under the names their docs use and the obvious
 * alternatives — and an answer with no persons array at all is
 * reported as unreadable rather than as "no match", so a changed shape
 * shows up as a failure instead of a quiet run of empty results.
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

const DEFAULT_ENDPOINT = "https://api.batchdata.com/api/v1/property/skip-trace";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 25_000;

export function phoneLookupConfigured(): boolean {
  return Boolean(process.env.BATCHDATA_API_KEY?.trim());
}

function endpoint(): string {
  return process.env.BATCHDATA_SKIP_TRACE_URL?.trim() || DEFAULT_ENDPOINT;
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
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(flag);
  }
  return false;
}

function usableName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return null;
  if (/[<>{}]|https?:/i.test(name)) return null;
  return name;
}

function nameOf(person: Record<string, unknown>): string | null {
  const n = person.name ?? person.fullName;
  if (typeof n === "string") return usableName(n);
  if (n && typeof n === "object") {
    const o = n as Record<string, unknown>;
    if (typeof o.full === "string") return usableName(o.full);
    return usableName(
      [o.first, o.middle, o.last]
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .join(" ")
    );
  }
  return null;
}

function typeOf(value: unknown): FoundPhone["type"] {
  const t = String(value ?? "").toLowerCase();
  if (/mobile|cell|wireless/.test(t)) return "mobile";
  if (/land|home|voip|office|work/.test(t)) return "landline";
  return "unknown";
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The persons array, wherever the answer nests it. */
function findPersons(value: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 6 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findPersons(v, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.persons)) {
    return row.persons.filter(
      (p): p is Record<string, unknown> => !!p && typeof p === "object" && !Array.isArray(p)
    );
  }
  for (const v of Object.values(row)) {
    const found = findPersons(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Reachable and mobile first; the vendor's own score settles ties. */
function byUsefulness(a: FoundPhone, b: FoundPhone): number {
  return (
    Number(b.reachable === true) - Number(a.reachable === true) ||
    Number(b.type === "mobile") - Number(a.type === "mobile") ||
    (b.score ?? 0) - (a.score ?? 0)
  );
}

/**
 * What the vendor's answer says, or null when it has no persons array
 * at all — a shape this does not read, which is a failure and not a
 * no-match. A persons array with nobody usable in it is a no-match:
 * `{ persons: [] }`.
 */
export function parseSkipTrace(body: unknown): PhoneLookupResult | null {
  const persons = findPersons(body);
  if (!persons) return null;
  const out: FoundPerson[] = [];
  for (const person of persons) {
    // The deceased are not rung. Either shape of the flag is honoured.
    if (anyFlag(person.death) || anyFlag(person.deceased)) continue;
    const dncPerson = anyFlag(person.dnc);
    const rawPhones = Array.isArray(person.phoneNumbers)
      ? person.phoneNumbers
      : Array.isArray(person.phones)
        ? person.phones
        : [];
    const phones: FoundPhone[] = [];
    const seen = new Set<string>();
    for (const raw of rawPhones) {
      const rec: Record<string, unknown> =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : { number: raw };
      const d = digitsOf(rec.number ?? rec.phone ?? rec.phoneNumber);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      phones.push({
        number: formatPhone(d),
        type: typeOf(rec.type ?? rec.phoneType ?? rec.lineType),
        dnc: dncPerson || anyFlag(rec.dnc),
        reachable: typeof rec.reachable === "boolean" ? rec.reachable : null,
        score: typeof rec.score === "number" ? rec.score : null,
      });
    }
    phones.sort(byUsefulness);
    const rawEmails = Array.isArray(person.emails) ? person.emails : [];
    const emails = Array.from(
      new Set(
        rawEmails
          .map((e) =>
            typeof e === "string"
              ? e.trim()
              : e && typeof e === "object"
                ? (e as Record<string, unknown>).email
                : null
          )
          .filter(isEmail)
          .map((e) => e.trim().toLowerCase())
      )
    ).slice(0, 3);
    if (phones.length === 0 && emails.length === 0) continue;
    out.push({ name: nameOf(person), phones: phones.slice(0, 4), emails });
  }
  return { persons: out.slice(0, 3) };
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

  const apiKey = process.env.BATCHDATA_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "no-key" };

  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            propertyAddress: {
              street: streetLine(place.address, place.city, place.stateCode),
              city: place.city,
              state: place.stateCode.toUpperCase(),
              zip: place.zip,
            },
          },
        ],
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
  const parsed = parseSkipTrace(body);
  if (parsed === null) {
    return { ok: false, reason: "unreadable", detail: `no persons in ${shapeOf(body)}` };
  }
  const result = parsed.persons.length > 0 ? parsed : null;
  void writeKeyed(key, { result }).catch(() => undefined);
  return { ok: true, result, from: "vendor" };
}
