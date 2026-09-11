/**
 * Is this short-term listing still on the platform?
 *
 * THE FEED CANNOT SAY. Measured, twice, across whole comp sets and
 * described field by field (lib/live/airroi, rememberCompShape, read at
 * /api/usage): the comps payload carries no status, no listing URL, no
 * platform and no as-of stamp, its last-ninety-day calendar reads
 * healthy for every comp, and its two day-count fields are the lengths
 * of their windows rather than the days a listing was seen. Every
 * field describes a listing that traded. None says whether it is still
 * there.
 *
 * That is not a cosmetic problem. A comp set is trailing-twelve-month
 * evidence, so a listing that came down six months ago still lends its
 * rate and its occupancy to the average somebody signs a lease
 * against, and its room link opens the platform's error page. Three
 * heuristics have been written against the feed's own fields and all
 * three fire on nothing.
 *
 * So the answer is fetched rather than inferred: the listing's own
 * page, once, through the scraping vendor, and what comes back is one
 * of three words. The page is a local — read for a fact and dropped,
 * the rule the whole scraping module is built around.
 *
 * FOUR THINGS KEEP THIS CHEAP AND SAFE.
 *
 * It is cached and shared. A verdict is filed by listing id in the
 * store every student reads, so the second analysis in a market pays
 * for none of the comps the first one checked. "Gone" is kept for
 * good, because a listing that has been taken down does not come back
 * under the same id; "live" is re-asked after a fortnight.
 *
 * It starts on the cheap tier. A room page is not the protected portal
 * the vendor's defaults are tuned for, and a caller checking
 * twenty-five pages for one word has no business paying the rendering
 * tier for any of them. Standard first, premium once if the standard
 * answer was an anti-bot screen, never ultra.
 *
 * It is bounded. At most one set's worth of checks per analysis, all
 * of them inside one time budget, and the whole thing switched off by
 * a single variable.
 *
 * IT FAILS OPEN, ALWAYS. A page that could not be read, a vendor that
 * refused, a budget that ran out, a store that would not answer: every
 * one of those keeps the comp. A projection is the product's core
 * promise, and gutting a comp set because a scraper had a bad minute
 * would be a far worse error than the one this corrects.
 */

import { readKeyedBlobs, writeKeyed } from "@/lib/db/market-store";
import { readListingPage, ScraperApiError } from "./scraperapi";

/** What the platform says about a listing, or that we could not tell. */
export type Liveness = "live" | "gone" | "unknown";

/** One listing id's verdict, as the store keeps it. */
interface Verdict {
  state: Liveness;
  /** When it was decided, ISO. */
  at: string;
}

const KEY_PREFIX = "live:airbnb:";

/** A live listing is re-asked after a fortnight; a gone one never is.
 *  Taking a listing down is not something hosts undo under the same
 *  id, and re-checking the dead forever is the one cost with no
 *  possible answer. */
const LIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** An unreadable page is worth another try tomorrow, not on the next
 *  page load: a target having a bad hour must not become a check per
 *  visitor. */
const UNKNOWN_TTL_MS = 24 * 60 * 60 * 1000;

/** How many uncached listings one analysis may check. A full set and
 *  no more; the rest keep their comps and stay unknown. */
const MAX_CHECKS = 30;
/** How many at once. The vendor holds a protected page for over a
 *  minute, so this is about not opening thirty of those together. */
const LANES = 6;
/** The whole pass, however many are left. An analysis waiting on a
 *  scraper is an analysis nobody is reading. */
const BUDGET_MS = 25_000;

function on(): boolean {
  // One variable turns it off. Anything but "0" or "off" leaves it on,
  // so an empty or missing value is the working default.
  const raw = process.env.AIRBNB_LIVE_CHECK?.trim().toLowerCase();
  return raw !== "0" && raw !== "off" && raw !== "false";
}

/** The listing id inside a comp's own id, or null for a seeded one. */
export function listingIdOf(compId: string): string | null {
  const m = /^sc-live-(\d{5,})$/.exec(compId);
  return m ? m[1] : null;
}

export function roomUrl(id: string): string {
  return `https://www.airbnb.com/rooms/${id}`;
}

/**
 * What a room page says about itself.
 *
 * The platform answers a removed listing with the same generic "something
 * went wrong" shell it answers a nonsense id with, so the tell is not
 * the error text but what a real page carries and that shell does not:
 * the listing's own address in a canonical or og:url tag. Found, the
 * listing is there. Absent, with the shell's own words present, it is
 * not. Absent with neither is a page we could not read, which is not
 * the same claim and must not be recorded as one.
 */
export function readLiveness(doc: string, id: string): Liveness {
  // Only the head, where the tags are: a review three thousand words
  // down that happens to say "no longer available" is not evidence.
  const head = doc.slice(0, 60_000);
  const canonical = new RegExp(
    `<(?:link|meta)[^>]+(?:rel=["']canonical["']|property=["']og:url["'])[^>]*/rooms/${id}\\b`,
    "i"
  );
  const ogUrl = new RegExp(`content=["'][^"']*airbnb\\.[a-z.]+/rooms/${id}\\b`, "i");
  if (canonical.test(head) || ogUrl.test(head)) return "live";
  if (
    /(we can'?t find|no longer available|isn'?t available|page not found|something went wrong)/i.test(
      head
    )
  ) {
    return "gone";
  }
  return "unknown";
}

/** One listing, asked of the platform. Never throws. */
async function ask(id: string): Promise<Liveness> {
  try {
    const { outcome, challenged } = await readListingPage(roomUrl(id), {
      from: "standard",
      to: "premium",
    });
    // An anti-bot screen is a failure, never a source — the same rule
    // the scraping module states for every other reader.
    if (challenged) return "unknown";
    return readLiveness(outcome.doc, id);
  } catch (error) {
    // The platform's own 404 or 410 IS the answer; every other refusal
    // is our inability to ask, and keeps the comp.
    if (error instanceof ScraperApiError && (error.status === 404 || error.status === 410)) {
      return "gone";
    }
    return "unknown";
  }
}

function fresh(v: Verdict): boolean {
  if (v.state === "gone") return true;
  const age = Date.now() - new Date(v.at).getTime();
  if (!Number.isFinite(age) || age < 0) return false;
  return age < (v.state === "live" ? LIVE_TTL_MS : UNKNOWN_TTL_MS);
}

function isVerdict(value: Record<string, unknown>): value is Verdict & Record<string, unknown> {
  return (
    (value.state === "live" || value.state === "gone" || value.state === "unknown") &&
    typeof value.at === "string"
  );
}

export interface LivenessRun {
  /** Verdict per listing id asked about. */
  states: Map<string, Liveness>;
  /** How the pass went, for the staff diagnostic — counts only. */
  tally: { cached: number; asked: number; live: number; gone: number; unknown: number };
}

/**
 * Ask about a set of listing ids: the store first, the platform for
 * whatever is left, and back to the store with the answers.
 */
export async function checkListings(ids: readonly string[]): Promise<LivenessRun> {
  const states = new Map<string, Liveness>();
  const wanted = [...new Set(ids)].filter((id) => /^\d{5,}$/.test(id));
  const tally = { cached: 0, asked: 0, live: 0, gone: 0, unknown: 0 };
  if (!on() || wanted.length === 0) return { states, tally };

  const held = await readKeyedBlobs(wanted.map((id) => `${KEY_PREFIX}${id}`)).catch(
    () => new Map<string, { value: Record<string, unknown>; at: string | null }>()
  );
  const toAsk: string[] = [];
  for (const id of wanted) {
    const hit = held.get(`${KEY_PREFIX}${id}`)?.value;
    if (hit && isVerdict(hit) && fresh(hit)) {
      states.set(id, hit.state);
      tally.cached += 1;
      continue;
    }
    toAsk.push(id);
  }

  const queue = toAsk.slice(0, MAX_CHECKS);
  const deadline = Date.now() + BUDGET_MS;
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= queue.length || Date.now() > deadline) return;
      const id = queue[i];
      const state = await ask(id);
      states.set(id, state);
      tally.asked += 1;
      // An answer nobody can read again is an answer bought twice. A
      // failed write is survivable, so it is not awaited into the
      // caller's own failure path.
      void writeKeyed(`${KEY_PREFIX}${id}`, {
        state,
        at: new Date().toISOString(),
      } satisfies Verdict).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, lane));

  for (const state of states.values()) tally[state] += 1;
  return { states, tally };
}

export const LIVENESS_TALLY_KEY = "diag:liveness";

/** The last pass's counts, for /api/usage. Counts, never a listing. */
export async function lastLivenessTally(): Promise<Record<string, unknown> | null> {
  const hit = await readKeyedBlobs([LIVENESS_TALLY_KEY]).catch(() => null);
  return hit?.get(LIVENESS_TALLY_KEY)?.value ?? null;
}
