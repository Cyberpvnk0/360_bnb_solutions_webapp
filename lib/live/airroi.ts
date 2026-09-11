/**
 * AirROI — the live short-term-rental data behind projections.
 *
 * Server-side ONLY: the key lives in AIRROI_API_KEY and every call goes
 * through app/api/str, never the browser. AirROI bills per call, so
 * responses cache hard (comps for a day, market analytics for a week —
 * a market's trailing-12 ADR doesn't move hourly) and the same daily cap
 * that guards the rental feed guards this one.
 *
 * Endpoint paths are the vendor's real ones, taken from their published
 * examples: no version prefix, `x-api-key` for auth, coordinates as
 * `latitude`/`longitude` on listings and `lat`/`lng` on markets. An
 * earlier draft of this file invented a `/v1/` prefix and would have
 * 404'd on the first real call.
 *
 * FIELD NAMES ARE OBSERVED, not guessed. A comp arrives as eight nested
 * objects and the figures live inside them: rate and occupancy under
 * performance_metrics, size under property_details, position under
 * location_info. An earlier version read flat top-level keys, which
 * would have mapped all twenty-five rows to null, tripped the
 * too-thin-to-underwrite guard, and shown seeded comps with no error
 * anywhere — live data arriving and being thrown away in silence.
 *
 * The flat readers are kept as a fallback so a reshaped payload
 * degrades instead of vanishing.
 *
 * ON PROSE: listing_info.description is somebody's marketing paragraph
 * and it stops here. StrComp has nowhere to put it, nothing returns the
 * raw payload, and that is deliberate — the same rule the enrichment
 * module is built around.
 *
 * Billing is per call, between $0.01 and $1.00 depending on endpoint,
 * which is the whole reason the revalidate windows below are long.
 */

import type { StrComp } from "@/lib/mock/types";
import { looksRoundedId } from "./listing-id";
import { describeFields } from "./shape";
import { writeKeyed } from "@/lib/db/market-store";

const BASE = "https://api.airroi.com";

/** Comparable listings around a point — the comps behind a projection. */
export const COMPS_PATH = "/listings/comparables";

/**
 * The comps query, in ONE place.
 *
 * Every parameter here is required by the service. Three separate
 * copies of this list existed and each dropped a different pair at
 * least once, so there is one now and everything reads it.
 */
export function compsParams(
  lat: number,
  lon: number,
  opts: { bedrooms?: number; baths?: number; guests?: number }
): Record<string, string> {
  const bedrooms = opts.bedrooms ?? 2;
  return {
    latitude: String(lat),
    longitude: String(lon),
    bedrooms: String(bedrooms),
    baths: (opts.baths ?? Math.max(1, bedrooms)).toFixed(1),
    guests: String(opts.guests ?? Math.max(2, bedrooms * 2)),
    currency: "native",
  };
}
/**
 * A coordinate's market — IDENTITY ONLY.
 *
 * Measured, not assumed: this returns full_name, country, region,
 * locality and district, and no performance figures whatsoever. The
 * first version of this file treated it as the analytics call and would
 * have mapped a market with no ADR and no occupancy to null forever,
 * looking for all the world like a market with no data.
 */
export const MARKET_PATH = "/markets/lookup";

/**
 * The market's headline figures — occupancy, ADR, RevPAR, revenue,
 * active listings. POST, with the market object lookup returns.
 */
export const MARKET_SUMMARY_PATH = "/markets/summary";

/** The same figures as a monthly series with percentiles. POST. */
export const MARKET_METRICS_PATH = "/markets/metrics/all";

/**
 * Their own revenue model for a specific property.
 *
 * Takes the property (bedrooms, baths, guests, a point) and returns a
 * revenue estimate, an ADR, an occupancy, percentiles for each, a
 * monthly revenue distribution AND the comparable listings it used —
 * all in one billed call. Everything the analyzer fetches separately,
 * plus the percentiles the revenue range currently has to invent.
 */
export const ESTIMATE_PATH = "/calculator/estimate";

/** Comps move with new bookings; market aggregates barely move at all. */
export const COMPS_REVALIDATE_SECONDS = 86_400; // 1 day
export const MARKET_REVALIDATE_SECONDS = 604_800; // 7 days

/**
 * A CIRCUIT BREAKER on billed calls, not the meter.
 *
 * The meter is the plan: each account's monthly analyses are counted
 * server-side in lib/db/usage against the tier it pays for, and that
 * is what decides whether a call may be made. This counter sits behind
 * it for the day something bypasses the plan — a bug, a loop, a route
 * that forgot to ask — and it should trip only then.
 *
 * OFF UNLESS AIRROI_DAILY_CALLS IS SET. It used to default to fifty,
 * then five hundred, and any figure here is a limit that sits above
 * paying users: a breaker below what the plans entitle silently hands
 * students modelled comps after the first busy hour, in a product
 * whose whole promise is measured ones. The plan meter is the limit;
 * this exists for an operator who wants a hard brake on the vendor
 * bill, and it holds only when they name the figure. For sizing one:
 * the measured price is $0.18 a call, and roughly (accounts x average
 * monthly entitlement) / 30, times two for headroom, is the floor.
 *
 * Per-instance and per-day, like the quota beside it. A serverless
 * fleet means the true figure is this times however many instances
 * happen to be warm, so it is a brake rather than a lock. A cached
 * analysis never reaches this counter.
 */
const DAILY_CALL_BUDGET = (() => {
  const raw = Number(process.env.AIRROI_DAILY_CALLS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : Number.POSITIVE_INFINITY;
})();

let spentDay = "";
let spentCalls = 0;

function budget(): { used: number; cap: number; left: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (spentDay !== today) {
    spentDay = today;
    spentCalls = 0;
  }
  return {
    used: spentCalls,
    cap: DAILY_CALL_BUDGET,
    left: Math.max(0, DAILY_CALL_BUDGET - spentCalls),
  };
}

/** What this instance has spent today. Surfaced by /api/usage. */
export function airRoiBudget(): { used: number; cap: number; left: number } {
  return budget();
}

export class AirRoiError extends Error {
  constructor(
    readonly reason: "no-key" | "auth" | "quota" | "http" | "network" | "budget",
    readonly status?: number,
    /** What the service said went wrong. A rejected request explains
     *  itself in the body, and the first version of this class dropped
     *  that on the floor — which turned a 400 that names its missing
     *  parameter into a silent "http". */
    readonly detail?: string
  ) {
    super(`AirROI ${reason}${status ? ` (${status})` : ""}`);
    this.name = "AirRoiError";
  }
}

export function hasAirRoiKey(): boolean {
  return Boolean(process.env.AIRROI_API_KEY);
}

/* ------------------------------------------------------------------ */
/* Tolerant field readers                                              */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

/** First key that holds a finite number, whatever the vendor calls it. */
function pickNumber(row: Row, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/[$,%,\s]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Parse a JSON body without rounding the ids in it.
 *
 * Airbnb's newer listing ids run to nineteen digits — past 2^53, which
 * is as far as a JavaScript number counts exactly. JSON.parse read
 * 1482756537092586123 as 1482756537092586000, and a room URL built
 * from that opens Airbnb's "something went wrong" page, which is what
 * every comp with a new-style id did. Any integer too long to hold
 * exactly is quoted before the parse, so it arrives as the string it
 * should have been; every id reader here takes a string first.
 *
 * Walks the text rather than regex-replacing it, because a listing's
 * description is prose that can contain "…, 1234567890123456789, …"
 * and a replacement inside a string literal would break the document.
 * Nothing else in a comps payload is sixteen digits long; a float or a
 * short integer passes through untouched.
 */
export function parseJsonKeepingBigIds(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      // A string literal, copied verbatim, escapes and all.
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < n && /[0-9.eE+-]/.test(text[j])) j++;
      const tok = text.slice(i, j);
      const unsafe =
        /^-?\d{16,}$/.test(tok) && !Number.isSafeInteger(Number(tok));
      out += unsafe ? `"${tok}"` : tok;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out);
}

function pickString(row: Row, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Occupancy arrives as either 0–1 or 0–100 depending on the endpoint;
 *  this product stores fractions, always. */
export function toFraction(value: number | null): number | null {
  if (value === null) return null;
  const f = value > 1.5 ? value / 100 : value;
  return f >= 0 && f <= 1 ? f : null;
}

// Trailing twelve months first — a year absorbs a season, ninety days
// does not, and a projection built on a summer is a projection that
// fails every winter.
const ADR_KEYS = ["ttm_avg_rate", "adr", "avg_daily_rate", "averageDailyRate", "average_daily_rate", "avgDailyRate", "nightlyRate", "price"];
const OCC_KEYS = ["ttm_occupancy", "occupancy", "avg_occupancy", "occupancyRate", "occupancy_rate", "occ"];
const REV_KEYS = ["ttm_revenue", "annualRevenue", "annual_revenue", "revenueLtm", "revenue_ltm", "revenue"];
// bedrooms before beds: their payload carries both and they differ —
// a studio with two beds is not a two-bedroom.
const BEDS_KEYS = ["bedrooms", "bedroomCount", "beds"];
const BATHS_KEYS = ["baths", "bathrooms", "bathroomCount"];
const DIST_KEYS = ["distanceMiles", "distance_miles", "distance"];
const NAME_KEYS = ["listing_name", "title", "name", "listingName", "listing_title"];
const ID_KEYS = ["listing_id", "id", "listingId", "airbnbId"];
// Where the listing lives and what it looks like, if the feed says.
const URL_KEYS = ["listing_url", "url", "airbnb_url", "link", "listingUrl"];
const PHOTO_KEYS = [
  "picture_url", "cover_photo_url", "cover_photo", "photo_url", "image_url",
  "thumbnail_url", "main_photo", "main_image", "pictureUrl", "thumbnail",
];
const PHOTO_LIST_KEYS = ["photos", "images", "pictures"];

/** An https URL or nothing — a comp's link and picture leave this file
 *  only when they are real addresses on the web. */
function pickHttpsUrl(row: Row, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    const candidate =
      typeof v === "string"
        ? v
        : v && typeof v === "object" && typeof (v as Row).url === "string"
          ? ((v as Row).url as string)
          : null;
    if (candidate && /^https:\/\//i.test(candidate.trim())) return candidate.trim();
  }
  return null;
}

/** The first https URL in the first photo of a photo list, whatever
 *  shape the list's entries take. */
function pickFirstPhoto(row: Row): string | null {
  for (const k of PHOTO_LIST_KEYS) {
    const list = row[k];
    if (!Array.isArray(list) || list.length === 0) continue;
    const first = list[0];
    if (typeof first === "string" && /^https:\/\//i.test(first)) return first;
    if (first && typeof first === "object") {
      const hit = pickHttpsUrl(first as Row, ["url", "picture_url", "src", "large", "medium", "small"]);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * A listing's page on Airbnb from its id. Their ids are plain integers
 * and their room URLs are built from nothing else, so a numeric id is a
 * page. Anything else is not guessed at.
 */
export function airbnbRoomUrl(id: string | number | null | undefined): string | null {
  const s = String(id ?? "").trim();
  // An id that passed through a double names nothing (lib/live/listing-id).
  if (!/^\d{5,}$/.test(s) || looksRoundedId(s)) return null;
  return `https://www.airbnb.com/rooms/${s}`;
}

/** Vrbo's listing pages are likewise built from a numeric id. */
export function vrboListingUrl(id: string | number | null | undefined): string | null {
  const s = String(id ?? "").trim();
  if (!/^\d{4,}$/.test(s) || looksRoundedId(s)) return null;
  return `https://www.vrbo.com/${s}`;
}

const PLATFORM_KEYS = ["platform", "source", "channel", "site", "provider", "ota", "marketplace"];

/**
 * Which platform a comp is listed on, when the feed says. The feed
 * covers more than one, and a Vrbo id sent to airbnb.com/rooms opens
 * Airbnb's "something went wrong" page — which is exactly what a link
 * built without asking did.
 */
export function platformOf(row: Row, info: Row | null): "airbnb" | "vrbo" | "other" | null {
  const raw = (info ? pickString(info, PLATFORM_KEYS) : null) ?? pickString(row, PLATFORM_KEYS);
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("airbnb")) return "airbnb";
  if (v.includes("vrbo") || v.includes("homeaway") || v.includes("expedia")) return "vrbo";
  return "other";
}

/**
 * The listing's page, in order of certainty: the feed's own link; a
 * platform-specific id the feed names outright (airbnb_id, vrbo_id);
 * the generic id on whatever platform the feed says; and, when the
 * feed says nothing, Airbnb — the platform the ids have always been
 * from. A comp the feed marks as some third platform gets no link
 * rather than a wrong one.
 */
/* ------------------------------------------------------------------ */
/* Whether a comp is still listed                                      */
/* ------------------------------------------------------------------ */

/** Keys that say a listing is live (true) or not (false). */
const LIVE_KEYS = ["is_active", "active", "isActive", "is_listed", "listed", "is_live", "live"];
/** Keys that say a listing is gone when TRUE. */
const GONE_KEYS = ["inactive", "is_inactive", "unlisted", "is_unlisted", "deleted", "is_deleted", "removed", "is_removed"];
/** Keys holding a status word. */
const STATUS_KEYS = ["status", "listing_status", "listingStatus", "availability_status", "state"];
const LIVE_WORDS = /^(active|live|listed|available|online|published)$/i;
const GONE_WORDS = /^(inactive|unlisted|delisted|deleted|removed|suspended|paused|snoozed|offline|unavailable|closed)$/i;

/** The last-90-days calendar, as the feed keeps it. */
const L90D_TOTAL_KEYS = ["l90d_total_days"];
/** Its twelve-month twin, which separates a listing that stopped from
 *  one that had not started. Read by the diagnostic only, for now. */
const TTM_TOTAL_KEYS = ["ttm_total_days"];
const L90D_PART_KEYS = ["l90d_available_days", "l90d_days_reserved", "l90d_blocked_days"];
/** The two of those that mean somebody could have stayed: a night the
 *  host left open, and a night a guest took. */
const L90D_OPEN_KEYS = ["l90d_available_days"];
const L90D_BOOKED_KEYS = ["l90d_days_reserved"];

/**
 * Whether this comp is still listed, and which field said so. Null
 * when nothing in the payload says either way.
 *
 * A comp set is trailing-twelve-month evidence, so it can carry a
 * listing that earned in the year and has since come down — and a
 * room link for one of those opens the platform's "something went
 * wrong" page, which is what the links that failed on an ordinary
 * eight-digit id were. Such a listing is left out of the set (see
 * mapComp).
 *
 * The feed carries no listed-or-not flag (checked against a live
 * payload: none of its groups has one). What it does carry, for every
 * comp, is the last ninety days of the listing's calendar — days
 * available, reserved and blocked, and their total. A listing that is
 * on the platform has a calendar; one with no days at all in the last
 * ninety is not there to be booked. That is the fact this reads, after
 * an explicit flag if a feed ever sends one. A calendar that is merely
 * quiet — blocked, or unbooked — is a live listing and stays.
 *
 * AND A SECOND, WEAKER FACT, FOR THE LINK ONLY: whether any night in
 * that window was OPEN OR BOOKED. `bookable` is false when the feed
 * states both counts and both are zero — ninety days in which nobody
 * could have stayed. A listing that has come down looks exactly like
 * that to a feed that reads calendars, and so does an owner's own
 * season, and the payload does not tell them apart. So it decides the
 * link and nothing else: the comp stays in the set with its year's
 * figures, and the page it would have opened is not promised. Null
 * when the feed states neither count — nothing is inferred from
 * silence here either.
 */
export interface Activity {
  /** Still listed, as far as the feed says. Null when it does not. */
  active: boolean | null;
  /** Which field carried that, for the staff diagnostic. */
  key: string | null;
  /** Whether any night of the window was open or booked. Decides the
   *  room link, never membership of the comp set. */
  bookable: boolean | null;
}

export function activityOf(row: Row, info: Row | null): Activity {
  const metrics = group(row, "performance_metrics") ?? row;
  const open = pickNumber(metrics, L90D_OPEN_KEYS);
  const booked = pickNumber(metrics, L90D_BOOKED_KEYS);
  // Stated by the feed, or not read at all: one open or booked night
  // is proof enough, and two stated zeros are proof of the opposite.
  const bookable =
    open === null && booked === null ? null : (open ?? 0) > 0 || (booked ?? 0) > 0;

  const flagged = flagOf(row, info);
  if (flagged.active !== null) return { ...flagged, bookable };

  const total = pickNumber(metrics, L90D_TOTAL_KEYS);
  if (total !== null) {
    return {
      active: total > 0,
      key: "performance_metrics.l90d_total_days",
      bookable,
    };
  }
  const parts = L90D_PART_KEYS.map((k) => pickNumber(metrics, [k])).filter(
    (n): n is number => n !== null
  );
  if (parts.length > 0) {
    return {
      active: parts.some((n) => n > 0),
      key: "performance_metrics.l90d_*_days",
      bookable,
    };
  }
  return { active: null, key: null, bookable };
}

/** An explicit listed-or-not flag, in the shapes feeds use. */
function flagOf(
  row: Row,
  info: Row | null
): { active: boolean | null; key: string | null } {
  const scopes: Array<[string, Row]> = info ? [["listing_info", info], ["", row]] : [["", row]];
  for (const [scope, src] of scopes) {
    const at = (k: string) => (scope ? `${scope}.${k}` : k);
    for (const k of LIVE_KEYS) {
      const v = src[k];
      if (typeof v === "boolean") return { active: v, key: at(k) };
      if (typeof v === "number" && (v === 0 || v === 1)) return { active: v === 1, key: at(k) };
    }
    for (const k of GONE_KEYS) {
      const v = src[k];
      if (typeof v === "boolean") return { active: !v, key: at(k) };
      if (typeof v === "number" && (v === 0 || v === 1)) return { active: v === 0, key: at(k) };
    }
    for (const k of STATUS_KEYS) {
      const v = src[k];
      if (typeof v !== "string") continue;
      const word = v.trim();
      if (LIVE_WORDS.test(word)) return { active: true, key: at(k) };
      if (GONE_WORDS.test(word)) return { active: false, key: at(k) };
    }
  }
  return { active: null, key: null };
}

/* ------------------------------------------------------------------ */
/* Whole places only                                                   */
/* ------------------------------------------------------------------ */

const ROOM_TYPE_KEYS = ["room_type", "listing_type", "roomType", "listingType"];

/**
 * Whether a comp is a whole place rather than a room in one.
 *
 * The strategy this product underwrites leases a whole unit and lists
 * it whole. A private room at $33 a night is a real listing and a
 * wrong comparable, and a few of them in a set of twenty-five pull
 * the average rate — and every figure built on it — well under what
 * the unit itself would earn. The feed names each comp's type in
 * listing_info (room_type, and listing_type beside it); a comp that
 * says it is a private, shared or hotel room is left out, and one
 * that says nothing is kept.
 */
export function wholePlace(row: Row, info: Row | null): boolean {
  const src = info ?? row;
  for (const k of ROOM_TYPE_KEYS) {
    const v = pickString(src, [k]);
    if (!v) continue;
    if (/entire|whole|full/i.test(v)) return true;
    if (/private|shared|hotel|room/i.test(v)) return false;
  }
  return true;
}

export function listingPageUrl(row: Row, info: Row | null, id: string): string | null {
  const given = (info ? pickHttpsUrl(info, URL_KEYS) : null) ?? pickHttpsUrl(row, URL_KEYS);
  if (given) return given;
  const src = info ?? row;
  const airbnbId = pickString(src, ["airbnb_id", "airbnbId"]) ?? pickNumber(src, ["airbnb_id", "airbnbId"]);
  if (airbnbId !== null) return airbnbRoomUrl(airbnbId);
  const vrboId = pickString(src, ["vrbo_id", "vrboId"]) ?? pickNumber(src, ["vrbo_id", "vrboId"]);
  if (vrboId !== null) return vrboListingUrl(vrboId);
  switch (platformOf(row, info)) {
    case "vrbo":
      return vrboListingUrl(id);
    case "other":
      return null;
    default:
      return airbnbRoomUrl(id);
  }
}

/* ------------------------------------------------------------------ */
/* What the comps payload looks like — names, never values             */
/* ------------------------------------------------------------------ */

/**
 * The field names of the last comp payload this process mapped. Kept
 * so a staff reader of /api/usage can see what the feed actually sends
 * — which groups, which keys, how often — without a billed call and
 * without any listing value leaving the server. The link and photo
 * readers above were written from guesses at these names; this is how
 * the guesses get checked.
 *
 * ACROSS THE WHOLE SET, NOT THE FIRST ROW. Twice now a rule about
 * which comps are still listed has been written from one row of one
 * payload and shipped, and twice the links went on failing — because a
 * JSON feed omits a null field per row, so the first comp cannot say
 * what the fiftieth carries, and a count of one cannot say whether a
 * rule ever fires. What is recorded now is every field path in every
 * comp with the number of comps carrying it, the calendar counts
 * tallied, the ids tallied by length and exactness, and how many comps
 * each rule actually removed or unlinked. Names and counts; never a
 * value.
 */
let lastCompShape: Record<string, unknown> | null = null;

/** Where the shape is kept between processes: the shared cache table.
 *  On serverless the process that bought a comp set is almost never
 *  the one that answers /api/usage, so memory alone reads as "never
 *  saw one" — which is what it did. */
export const COMP_SHAPE_KEY = "diag:comps-shape";

export function rememberCompShape(rows: unknown[], responseKeys: string[] = []): void {
  const first = rows.find((r) => r && typeof r === "object");
  if (!first) return;
  const shape: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(first as Row)) {
    shape[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.keys(v as Row).sort()
        : [Array.isArray(v) ? `array(${v.length})` : typeof v];
  }
  // How the first comp's id ARRIVED — its type and digit count, never
  // its value — under a key no payload field can collide with. An id
  // past 2^53 that came through a double is a link to nothing, and
  // whether the vendor sends it rounded or this process rounded it is
  // the difference between a fallback and a fix. "exact" here means it
  // survived as an integer that is not the printed form of a double.
  shape.$id = idShapeOf(first as Row);
  // Which field, if any, says whether a comp is still listed — the
  // one fact that decides whether its room link can be trusted.
  const activity = activityOf(first as Row, group(first as Row, "listing_info"));
  shape.$active = [activity.key ?? "nothing says whether a comp is still listed"];
  // How many of the payload's comps were left out, and why — counts,
  // never values.
  const objects = rows.filter((r): r is Row => !!r && typeof r === "object");
  const reads = objects.map((r) => activityOf(r, group(r, "listing_info")));
  const gone = reads.filter((a) => a.active === false).length;
  const rooms = objects.filter((r) => !wholePlace(r, group(r, "listing_info"))).length;
  shape.$inactive = [`${gone} of ${rows.length} no longer listed, left out`];
  shape.$rooms = [`${rooms} of ${rows.length} private or shared rooms, left out`];
  // How many comps lose their room link under the calendar rule, and
  // how many the rule cannot judge at all. A payload where every comp
  // reads "unknown" is a payload with no calendar in it, whatever the
  // field list says — and that is the answer that ends the guessing.
  shape.$withheld = [
    `${reads.filter((a) => a.bookable === false).length} of ${rows.length} with no open or booked night in the last ninety, kept without a link`,
    `${reads.filter((a) => a.bookable === null).length} of ${rows.length} the calendar cannot judge, linked as before`,
  ];
  // The calendar itself, tallied: which of its four counts the feed
  // states, on how many comps. Counts of fields, never a day of
  // anyone's calendar.
  const metricsOf = (r: Row) => group(r, "performance_metrics") ?? r;
  shape.$calendar = Object.fromEntries(
    [...L90D_TOTAL_KEYS, ...L90D_PART_KEYS].map((k) => [
      k,
      `stated on ${objects.filter((r) => pickNumber(metricsOf(r), [k]) !== null).length} of ${rows.length}`,
    ])
  );
  /**
   * THE LAST UNKNOWN, and the one that decides whether a dead link can
   * ever be told from a live one.
   *
   * Every other field in this payload describes a listing that is
   * trading; none of them says whether it is still there. These two
   * might, depending on what the vendor means by them. If
   * `l90d_total_days` is the LENGTH of the window it will read 90 for
   * every comp and nothing here can help. If it is the number of days
   * the listing was actually OBSERVED in that window, a comp that
   * stopped partway through is a comp that came off the platform, and
   * the short reading says when.
   *
   * Its twin separates that from an ordinary new listing: one created
   * six weeks ago is short on both counts, while one that has traded
   * for a year and stopped last month is long on the year and short on
   * the quarter.
   *
   * Bucketed rather than listed. A spread of day counts is a fact
   * about the feed's schema, which is what this diagnostic is for; a
   * day count per listing would be a fact about somebody's calendar,
   * which is not.
   */
  const spread = (key: string, full: number, edges: number[]) => {
    const seen = objects
      .map((r) => pickNumber(metricsOf(r), [key]))
      .filter((n): n is number => n !== null);
    if (seen.length === 0) return "not stated";
    const at = seen.filter((n) => n >= full).length;
    const bands = edges.map((lo, i) => {
      const hi = i === 0 ? full - 1 : edges[i - 1] - 1;
      return [`${lo}-${hi}`, seen.filter((n) => n >= lo && n <= hi).length] as const;
    });
    return [
      `${at} of ${seen.length} at ${full}`,
      ...bands.filter(([, n]) => n > 0).map(([band, n]) => `${n} at ${band}`),
      ...(seen.filter((n) => n === 0).length > 0
        ? [`${seen.filter((n) => n === 0).length} at 0`]
        : []),
    ].join(", ");
  };
  shape.$span = {
    l90d_total_days: spread(L90D_TOTAL_KEYS[0], 90, [60, 30, 1]),
    ttm_total_days: spread(TTM_TOTAL_KEYS[0], 365, [270, 180, 90, 1]),
    reading:
      "All at the full figure means these are window lengths and carry no liveness. Anything short of it means the count is days observed — and a comp short on the quarter but long on the year is one that stopped being seen, which is the signal this product has had no way to read.",
  };
  // Every id in the set by length and exactness, not just the first —
  // one rounded id among twenty-five is a broken link nobody would see
  // in a sample of one.
  shape.$ids = idTally(objects);
  // Every field the payload carries anywhere, with how many comps
  // carry it. maxLength separates a label from a paragraph without
  // printing a word of either.
  shape.$fields = describeFields(objects, 3);
  // The estimate response's own top-level keys — where a data-as-of
  // stamp would be, if the vendor ships one.
  if (responseKeys.length > 0) shape.$response = [...responseKeys].sort();
  lastCompShape = shape;
  // Names only, never values; a failed write is a missing diagnostic,
  // not a missing feature.
  void writeKeyed(COMP_SHAPE_KEY, shape).catch(() => undefined);
}

/** Every comp's id by digit length, and how many survived as exact
 *  integers rather than the printed form of a double. */
function idTally(rows: Row[]): Record<string, string> {
  const lengths = new Map<number, number>();
  let exact = 0;
  let rounded = 0;
  let missing = 0;
  for (const row of rows) {
    const src = group(row, "listing_info") ?? row;
    const found = [...ID_KEYS, "airbnb_id", "airbnbId"]
      .map((k) => src[k])
      .find((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== ""));
    if (found === undefined) {
      missing += 1;
      continue;
    }
    const digits = String(found).trim();
    lengths.set(digits.length, (lengths.get(digits.length) ?? 0) + 1);
    if (/^\d+$/.test(digits) && !looksRoundedId(digits)) exact += 1;
    else rounded += 1;
  }
  return {
    byLength: [...lengths.entries()]
      .sort(([a], [b]) => a - b)
      .map(([len, n]) => `${n}x ${len} digits`)
      .join(", "),
    exact: String(exact),
    rounded: String(rounded),
    missing: String(missing),
  };
}

function idShapeOf(row: Row): string[] {
  const src = group(row, "listing_info") ?? row;
  for (const k of [...ID_KEYS, "airbnb_id", "airbnbId"]) {
    const v = src[k];
    if (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) {
      const digits = String(v).trim();
      const exact = /^\d+$/.test(digits) && !looksRoundedId(digits);
      return [typeof v, `${digits.length} digits`, exact ? "exact" : "rounded"];
    }
  }
  return ["missing"];
}

export function compFieldsSeen(): Record<string, unknown> | null {
  return lastCompShape;
}
const LAT_KEYS = ["latitude", "lat"];
const LON_KEYS = ["longitude", "lng", "lon", "long"];

/**
 * One AirROI listing → the StrComp shape the projection already runs on.
 * Returns null for a row missing anything load-bearing: a comp without a
 * rate or an occupancy can't back a revenue estimate, and a fabricated
 * one would quietly poison every number downstream.
 */
export function mapComp(raw: unknown, index: number): StrComp | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Row;

  const adr = nestedNumber(row, "performance_metrics", ADR_KEYS, ADR_KEYS);
  /**
   * Unadjusted, deliberately.
   *
   * They publish both: ttm_occupancy is reserved nights over all 365,
   * ttm_adjusted_occupancy is reserved over the nights the host chose
   * to make available. A host who blocks half the year looks fully
   * booked on the adjusted figure. A student underwriting a lease will
   * have all 365 nights to fill, so the unadjusted number is the one
   * that answers their question, and it is the conservative one — which
   * is the right way to be wrong about somebody's rent.
   */
  const occupancy = toFraction(
    nestedNumber(row, "performance_metrics", OCC_KEYS, OCC_KEYS)
  );
  if (adr === null || adr <= 0 || occupancy === null) return null;

  const bedrooms = nestedNumber(row, "property_details", BEDS_KEYS, BEDS_KEYS) ?? 0;
  const bathrooms = nestedNumber(row, "property_details", BATHS_KEYS, BATHS_KEYS) ?? 1;
  const distance = pickNumber(row, DIST_KEYS);

  const info = group(row, "listing_info");
  const id =
    (info ? pickString(info, ID_KEYS) ?? pickNumber(info, ID_KEYS)?.toString() : null) ??
    pickString(row, ID_KEYS) ??
    pickNumber(row, ID_KEYS)?.toString() ??
    `airroi-${index}`;
  const name =
    (info ? pickString(info, NAME_KEYS) : null) ?? pickString(row, NAME_KEYS);
  // A listing the feed says is no longer up is not a comp. Its year's
  // earnings are history, not the market someone is about to enter,
  // and its room page is the platform's error page. Out, whole — not
  // kept with a caveat. A feed that says nothing is trusted; nothing
  // is inferred from dates or silence.
  const { active, bookable } = activityOf(row, info);
  if (active === false) return null;
  // Nor is a room in somebody's home a comparable for a whole unit.
  if (!wholePlace(row, info)) return null;

  // The listing's own page: the feed's link when it gives one, else the
  // page its id names. Its cover photo likewise, from wherever the
  // payload keeps it — never from the description, which is prose.
  //
  // WITHHELD when the last ninety days held no night anybody could
  // have stayed. The comp is still a comp — its year is what the
  // market earned, and the projection stands on that — but its page is
  // as likely to be the platform's error page as the listing, and a
  // link that fails two times in five is worth less than the area
  // search beneath it. See StrComp.linkWithheld.
  const linkWithheld = bookable === false;
  const listingUrl = linkWithheld ? null : listingPageUrl(row, info, id);
  const photoUrl =
    (info ? pickHttpsUrl(info, PHOTO_KEYS) ?? pickFirstPhoto(info) : null) ??
    pickHttpsUrl(row, PHOTO_KEYS) ??
    pickFirstPhoto(row);

  // Only a pair counts. Half a coordinate would place a pin on the
  // prime meridian and look deliberate doing it.
  const lat = nestedNumber(row, "location_info", LAT_KEYS, LAT_KEYS);
  const lon = nestedNumber(row, "location_info", LON_KEYS, LON_KEYS);
  /**
   * Keep the coordinate either way; record only whether it is exact.
   *
   * Airbnb blurs a listing's position until it is booked, and in
   * practice almost every comp comes back blurred — all twelve in the
   * first live pull. An earlier version of this discarded those and let
   * the map fall back to its scatter, which put the pin at a hashed
   * random bearing from the subject. That is strictly worse: the blur
   * is a small circle around the real address, the scatter is anywhere
   * on a ring. Throwing away a good approximation to replace it with a
   * worse one is not caution, it is just a different error.
   *
   * So the position is used and `exactLocation` carries the caveat.
   */
  const hasPoint =
    lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const exact = group(row, "location_info")?.exact_location;
  const placed = hasPoint
    ? { lat: lat!, lon: lon!, exactLocation: exact === true }
    : {};

  const revenue = nestedNumber(row, "performance_metrics", REV_KEYS, REV_KEYS);

  return {
    id: `sc-live-${id}`,
    name: name ?? `${Math.max(1, Math.round(bedrooms))} BR nearby rental`,
    ...(listingUrl ? { listingUrl } : {}),
    ...(photoUrl ? { photoUrl } : {}),
    ...(active === null ? {} : { active }),
    ...(linkWithheld ? { linkWithheld: "calendar-closed" as const } : {}),
    bedrooms: Math.max(0, Math.round(bedrooms)),
    bathrooms: Math.max(0.5, bathrooms),
    adr: Math.round(adr),
    // Whole-point storage, like every other occupancy in the product.
    occupancy: Math.round(occupancy * 100) / 100,
    distanceMiles: distance === null ? 0 : Math.round(distance * 10) / 10,
    ...placed,
    ...(revenue !== null && revenue > 0 ? { annualRevenue: Math.round(revenue) } : {}),
  };
}

/** avg / p25 / p50 / p75 / p90, as their percentile blocks arrive. */
export interface Percentiles {
  avg: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

function mapPercentiles(raw: unknown): Percentiles | null {
  const g = raw && typeof raw === "object" ? (raw as Row) : null;
  if (!g) return null;
  const read = (k: string) => pickNumber(g, [k]);
  return { avg: read("avg"), p25: read("p25"), p50: read("p50"), p75: read("p75"), p90: read("p90") };
}

export interface PropertyEstimate {
  /** Their projected annual revenue for this property. */
  revenue: number | null;
  adr: number | null;
  /** Fraction. */
  occupancy: number | null;
  percentiles: {
    revenue: Percentiles | null;
    adr: Percentiles | null;
    occupancy: Percentiles | null;
  };
  /** Twelve numbers, one per month — the seasonality of this address. */
  monthlyRevenue: number[] | null;
  /** The listings their estimate was built from. */
  comps: StrComp[];
}

/**
 * One month of a market's history, flattened.
 *
 * Their payload gives avg/p25/p50/p75/p90 for every measure; the charts
 * plot a single line, so the average is taken and the rest dropped
 * rather than carried through a store and three components unused.
 */
export interface LiveMarketMonth {
  /** YYYY-MM-01, matching the seeded series so both feed one chart. */
  month: string;
  adr: number;
  /** Fraction. */
  occupancy: number;
  revenue: number | null;
  revpar: number | null;
}

export interface MarketSummary {
  adr: number | null;
  /** Fraction. */
  occupancy: number | null;
  revpar: number | null;
  revenue: number | null;
  activeListings: number | null;
  bookingLeadTime: number | null;
  lengthOfStay: number | null;
}

export interface MarketAnalytics {
  adr: number;
  /** Fraction, whole-point precision. */
  occupancy: number;
  annualRevenue: number | null;
  activeListings: number | null;
}

export function mapMarketAnalytics(raw: unknown): MarketAnalytics | null {
  if (!raw || typeof raw !== "object") return null;
  // Payloads often nest the figures one level down.
  const outer = raw as Row;
  const row = (outer.data ?? outer.metrics ?? outer.market ?? outer) as Row;

  const adr = pickNumber(row, ADR_KEYS);
  const occupancy = toFraction(pickNumber(row, OCC_KEYS));
  if (adr === null || adr <= 0 || occupancy === null) return null;

  return {
    adr: Math.round(adr),
    occupancy: Math.round(occupancy * 100) / 100,
    annualRevenue: pickNumber(row, REV_KEYS),
    activeListings: pickNumber(row, ["active_listings", "activeListings", "listingCount", "supply"]),
  };
}

/** One nested object, or null. Their comps put every real figure one
 *  level down, so this is the workhorse. */
function group(row: Row, key: string): Row | null {
  const v = row[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
}

/** Read a number from a nested group first, then from the top level —
 *  so a reshaped payload degrades to the old behaviour rather than to
 *  nothing. */
function nestedNumber(row: Row, groupKey: string, keys: string[], flat: string[]): number | null {
  const g = group(row, groupKey);
  return (g ? pickNumber(g, keys) : null) ?? pickNumber(row, flat);
}

/** Arrays hide under different keys per endpoint; find the first one. */
export function extractArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  for (const key of ["data", "results", "listings", "comps", "items"]) {
    const v = (body as Row)[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

async function call(
  path: string,
  params: Record<string, string>,
  revalidate: number,
  /** Their market endpoints are POST with a JSON body; the listing and
   *  calculator ones are GET with a query string. Probing the POST
   *  paths with GET is what produced three 404s reading "Invalid
   *  endpoint path", and the conclusion that market metrics did not
   *  exist. They exist. */
  body?: unknown
): Promise<unknown> {
  const key = process.env.AIRROI_API_KEY;
  if (!key) throw new AirRoiError("no-key");

  // Counted before the request, not after: a call that times out or
  // errors has still been made and, on most metered APIs, still
  // billed. Counting successes only is how a budget gets quietly
  // exceeded by the failures.
  const remaining = budget();
  if (remaining.left <= 0) {
    throw new AirRoiError(
      "budget",
      undefined,
      `daily call budget spent (${remaining.used}/${remaining.cap}). ` +
        "This is the circuit breaker behind the per-account plan meter; raise AIRROI_DAILY_CALLS as the subscriber base grows."
    );
  }
  spentCalls += 1;

  const url = body
    ? `${BASE}${path}`
    : `${BASE}${path}?${new URLSearchParams(params)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...(body
        ? {
            method: "POST",
            body: JSON.stringify(body),
          }
        : {}),
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        // Their documented scheme, singular. An earlier version also
        // sent a Bearer token on the guess that one of the two would
        // land; the docs settle it, and a stray credential header is
        // not a free thing to send.
        "x-api-key": key,
        Accept: "application/json",
      },
      next: { revalidate },
    });
  } catch {
    throw new AirRoiError("network");
  }

  if (!res.ok) {
    // Validation prose, not listing data — safe to surface and the
    // whole point of asking.
    const detail = (await res.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new AirRoiError("auth", res.status, detail);
    }
    if (res.status === 402 || res.status === 429) {
      throw new AirRoiError("quota", res.status, detail);
    }
    throw new AirRoiError("http", res.status, detail);
  }
  // Read as text and parsed here rather than with res.json(): see
  // parseJsonKeepingBigIds for the ids that would not survive it.
  const text = await res.text().catch(() => "");
  try {
    return parseJsonKeepingBigIds(text);
  } catch {
    return null;
  }
}

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Great-circle miles between two points.
 *
 * Their comps carry no distance field — reasonably, since distance is
 * only meaningful relative to whatever you asked about — so it is
 * computed here from the coordinates they do give. Flat-earth
 * arithmetic would be close enough at three miles and wrong in a way
 * that grows silently with radius.
 */
function milesBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Comps with a distance filled in, nearest first. Shared by the
 *  comparables endpoint and the calculator's own comp set. */
function withDistance(comps: StrComp[], subject: { lat: number; lon: number }): StrComp[] {
  return comps
    .map((c) =>
      c.distanceMiles > 0 || c.lat === undefined || c.lon === undefined
        ? c
        : {
            ...c,
            distanceMiles:
              Math.round(milesBetween(subject, { lat: c.lat, lon: c.lon }) * 10) / 10,
          }
    )
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/** Nearby active short-term rentals, closest first. */
export async function fetchComps(opts: {
  lat: number;
  lon: number;
  bedrooms?: number;
  baths?: number;
  guests?: number;
  limit?: number;
}): Promise<StrComp[]> {
  /**
   * baths and guests are REQUIRED — the service answers
   * "query param baths must not be null" without them, so leaving them
   * off is not a degraded request, it is a guaranteed 400.
   *
   * They were modelled as optional here and omitted when absent, which
   * meant three separate copies of this parameter list each had to
   * remember to pass them, and three separate times one didn't: the
   * sweep, the single-endpoint probe, and this, the path the product
   * actually uses. Defaulting them where the request is built ends
   * that — a caller can still say what it knows, and one that says
   * nothing gets a request that works instead of one that cannot.
   *
   * The defaults follow the shape of the housing stock: about a bath
   * per bedroom, two guests to a bedroom.
   */

  const body = await call(
    COMPS_PATH,
    compsParams(opts.lat, opts.lon, opts),
    COMPS_REVALIDATE_SECONDS
  );
  return withDistance(
    extractArray(body).map(mapComp).filter((c): c is StrComp => c !== null),
    { lat: opts.lat, lon: opts.lon }
  ).slice(0, opts.limit ?? 12);
}

/**
 * Their revenue model for one property, and the comps behind it.
 *
 * One call where the analyzer previously made one for comps and then
 * derived everything itself. The derivation stays — the projection is
 * still computed from the comp set displayed beside it, which is the
 * one invariant this product cannot give up — but their figures come
 * along as an independent read, and their percentiles are real where
 * the revenue range previously had to spread a band around a point.
 */
export async function fetchEstimate(opts: {
  lat: number;
  lon: number;
  bedrooms?: number;
  baths?: number;
  guests?: number;
  radiusMiles?: number;
}): Promise<PropertyEstimate> {
  const params = compsParams(opts.lat, opts.lon, opts);
  // The calculator names its coordinates lat/lng where comparables says
  // latitude/longitude. Same service, two conventions.
  const body = await call(
    ESTIMATE_PATH,
    {
      lat: String(opts.lat),
      lng: String(opts.lon),
      bedrooms: params.bedrooms,
      baths: params.baths,
      guests: params.guests,
      ...(opts.radiusMiles ? { radius: String(opts.radiusMiles) } : {}),
      currency: "native",
    },
    COMPS_REVALIDATE_SECONDS
  );

  const row = (body && typeof body === "object" ? body : {}) as Row;
  const pct = group(row, "percentiles");
  const monthly = row.monthly_revenue_distributions;
  const subject = { lat: opts.lat, lon: opts.lon };

  return {
    revenue: pickNumber(row, ["revenue"]),
    adr: pickNumber(row, ["average_daily_rate"]),
    occupancy: toFraction(pickNumber(row, ["occupancy"])),
    percentiles: {
      revenue: mapPercentiles(pct?.revenue),
      adr: mapPercentiles(pct?.average_daily_rate),
      occupancy: mapPercentiles(pct?.occupancy),
    },
    monthlyRevenue: Array.isArray(monthly)
      ? monthly.filter((n): n is number => typeof n === "number")
      : null,
    comps: withDistance(
      (() => {
        const raw = extractArray({ listings: row.comparable_listings });
        rememberCompShape(raw, Object.keys(row));
        return raw.map(mapComp).filter((c): c is StrComp => c !== null);
      })(),
      subject
    ),
  };
}

/**
 * A market's headline figures.
 *
 * POST, with the market object /markets/lookup returns. Getting the
 * method wrong is what made three probes answer 404 "Invalid endpoint
 * path" and produced the conclusion that market metrics were simply
 * unavailable. They were available the whole time.
 */
export async function fetchMarketSummary(market: {
  country?: string;
  region?: string;
  locality?: string;
  district?: string;
}): Promise<{ summary: MarketSummary; fullName: string | null } | null> {
  const body = await call(MARKET_SUMMARY_PATH, {}, MARKET_REVALIDATE_SECONDS, {
    market,
    currency: "native",
  });
  const row = (body && typeof body === "object" ? body : null) as Row | null;
  if (!row) return null;
  return {
    summary: {
      adr: pickNumber(row, ["average_daily_rate"]),
      occupancy: toFraction(pickNumber(row, ["occupancy"])),
      revpar: pickNumber(row, ["rev_par", "revpar"]),
      revenue: pickNumber(row, ["revenue"]),
      activeListings: pickNumber(row, ["active_listings_count"]),
      bookingLeadTime: pickNumber(row, ["booking_lead_time"]),
      lengthOfStay: pickNumber(row, ["length_of_stay"]),
    },
    // Free: whatever this response calls the area it just measured.
    // Worth reading here because it is the only way to learn the feed's
    // own name for a market without paying for the lookup that used to
    // be the only source of it.
    fullName: fullNameOf(body),
  };
}

/**
 * A market's monthly history.
 *
 * POST, like every other market endpoint. Twelve months by default,
 * which is what the charts draw and what "trailing twelve" means
 * everywhere else in this product.
 *
 * A month with no rate or no occupancy is dropped rather than zeroed:
 * a zero plots as a real collapse and reads as one.
 */
export async function fetchMarketMetrics(
  market: {
    country?: string;
    region?: string;
    locality?: string;
    district?: string;
  },
  numMonths = 12
): Promise<LiveMarketMonth[]> {
  const body = await call(MARKET_METRICS_PATH, {}, MARKET_REVALIDATE_SECONDS, {
    market,
    currency: "native",
    num_months: numMonths,
  });

  const rows = (body && typeof body === "object" ? (body as Row).results : null) as
    | unknown[]
    | null;
  if (!Array.isArray(rows)) return [];

  const avg = (row: Row, key: string): number | null => {
    const g = group(row, key);
    return g ? pickNumber(g, ["avg", "p50"]) : pickNumber(row, [key]);
  };

  return rows
    .map((raw): LiveMarketMonth | null => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Row;
      const month = normaliseMonth(pickString(row, ["date", "month"]));
      const adr = avg(row, "average_daily_rate");
      const occupancy = toFraction(avg(row, "occupancy"));
      if (!month || adr === null || adr <= 0 || occupancy === null) return null;
      return {
        month,
        adr: Math.round(adr),
        occupancy: Math.round(occupancy * 1000) / 1000,
        revenue: avg(row, "revenue"),
        revpar: avg(row, "revpar"),
      };
    })
    .filter((m): m is LiveMarketMonth => m !== null)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Their date to the seeded series' YYYY-MM-01.
 *
 * Both shapes have turned up in this codebase's vendors — a full
 * timestamp and a bare month — so this takes the first seven characters
 * when they parse as a year and month, and refuses anything else rather
 * than inventing a date for a row to sit at.
 */
function normaliseMonth(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/**
 * A point's market IDENTITY. Not its numbers.
 *
 * Measured against the live service: /markets/lookup returns full_name,
 * country, region, locality and district, and nothing else. There is no
 * ADR here, no occupancy, no revenue. /markets/metrics/all,
 * /markets/metrics/occupancy and /markets/overview all answer 404
 * "Invalid endpoint path", so whatever serves market-level aggregates
 * is not at any address we have found.
 *
 * That turns out not to matter. The projection derives its ADR and
 * occupancy from the comp set through lib/calc/comps, and comps drawn
 * around the actual property are a better basis than a ZIP-wide mean
 * would have been — their market identifier resolves to ZIP granularity
 * anyway ("32202, Jacksonville, Florida, United States").
 *
 * Kept because the market name is worth having and the call is cheap,
 * but nothing on a page requests it: an endpoint that cannot answer the
 * question it was written for should not be billed on every analysis.
 */
export async function fetchMarketIdentity(opts: {
  lat: number;
  lon: number;
}): Promise<{
  fullName: string | null;
  /** Exactly the shape /markets/summary wants as its `market`. */
  market: { country?: string; region?: string; locality?: string; district?: string } | null;
}> {
  const body = await call(
    MARKET_PATH,
    { lat: String(opts.lat), lng: String(opts.lon) },
    MARKET_REVALIDATE_SECONDS
  );
  const row = (body && typeof body === "object" ? body : null) as Row | null;
  const part = (k: string) => (row ? pickString(row, [k]) ?? undefined : undefined);
  return {
    fullName: fullNameOf(body),
    market: row
      ? {
          country: part("country"),
          region: part("region"),
          locality: part("locality"),
          district: part("district"),
        }
      : null,
  };
}

/**
 * Retained for the shape of a market payload we have not found yet.
 * Nothing calls it; if a metrics endpoint turns up, this is where its
 * response gets normalised.
 */
export async function fetchMarketAnalytics(opts: {
  lat: number;
  lon: number;
}): Promise<MarketAnalytics | null> {
  // Markets take lat/lng, not latitude/longitude — the two families of
  // endpoint genuinely differ, which is exactly the kind of thing that
  // only shows up against the real service.
  const body = await call(
    MARKET_PATH,
    { lat: String(opts.lat), lng: String(opts.lon) },
    MARKET_REVALIDATE_SECONDS
  );
  return mapMarketAnalytics(body);
}

/** Raw payload for one call — the diagnostic that lets us pin the field
 *  names to reality the first time a real key is present. */
export async function probeShape(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  return call(path, params, 60);
}

/**
 * Candidate endpoints, for the discovery sweep.
 *
 * Their documented examples name these paths, but "documented" and
 * "what this key can reach" are different claims, and neither the docs
 * nor the service are reachable from where this was written. So the
 * sweep asks the service itself and reports what each one said.
 *
 * Every row costs a call — a cent to a dollar each, per their pricing
 * — which is why this is a deliberate diagnostic and not something a
 * page ever triggers.
 */
export const PROBE_TARGETS: { path: string; params: (lat: number, lon: number) => Record<string, string> }[] = [
  // Every parameter the service requires, in one place, shared with the
  // real call path — see compsParams.
  { path: COMPS_PATH, params: (lat, lon) => compsParams(lat, lon, {}) },
  { path: MARKET_PATH, params: (lat, lon) => ({ lat: String(lat), lng: String(lon) }) },
];

/**
 * Stage two: endpoints that need a market identifier, tried with the
 * one stage one actually returned rather than a guess at its format.
 */
export const MARKET_PROBE_TARGETS: { path: string; params: (fullName: string) => Record<string, string> }[] = [
  { path: MARKET_METRICS_PATH, params: (n) => ({ full_name: n, currency: "native" }) },
  { path: MARKET_METRICS_PATH, params: (n) => ({ market: n, currency: "native" }) },
  { path: "/markets/metrics/occupancy", params: (n) => ({ full_name: n }) },
];

/** The market identifier a lookup response carries, if it carries one. */
export function fullNameOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Row;
  const direct = pickString(row, ["full_name", "fullName"]);
  if (direct) return direct;
  // Search responses wrap their rows.
  const entries = (row.entries ?? row.data ?? row.results) as unknown;
  if (Array.isArray(entries) && entries[0] && typeof entries[0] === "object") {
    return pickString(entries[0] as Row, ["full_name", "fullName"]);
  }
  return null;
}

export interface ProbeOutcome {
  path: string;
  ok: boolean;
  status: number | null;
  reason: string | null;
  /** What the service said, when it refused. */
  detail: string | null;
}

/** One candidate, reporting rather than throwing — a 404 is the answer
 *  the sweep is looking for, not a failure of the sweep. */
export async function probeEndpoint(
  path: string,
  params: Record<string, string>
): Promise<ProbeOutcome & { shape: unknown }> {
  try {
    const body = await call(path, params, 60);
    return { path, ok: true, status: 200, reason: null, detail: null, shape: body };
  } catch (error) {
    if (error instanceof AirRoiError) {
      return {
        path,
        ok: false,
        status: error.status ?? null,
        reason: error.reason,
        detail: error.detail ?? null,
        shape: null,
      };
    }
    return { path, ok: false, status: null, reason: "network", detail: null, shape: null };
  }
}
