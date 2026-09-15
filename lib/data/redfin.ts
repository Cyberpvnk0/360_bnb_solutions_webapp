/**
 * Client access to Redfin's furnished rentals.
 *
 * The Furnished filter is answered here rather than by reading listing
 * prose: Redfin applies its own furnished filter server-side, so every
 * row that comes back is furnished because they say so. One request per
 * market, cached a day and shared by every user.
 */

import type { RentalListing } from "@/lib/mock/types";

/**
 * EVERY reason the server can send, and they must ALL be here.
 *
 * The label below falls through to "unreachable" for anything it does
 * not recognise, so a reason the server knows and this union does not
 * is a real failure reported as a fake one. That is what happened to
 * `no-credits`: the server had the word, this list did not, and a spent
 * scraping plan read on screen as a connection problem — sending
 * whoever saw it to check their wifi instead of their bill.
 */
export type RedfinFailureReason =
  | "no-key"
  /** This market has no Redfin city id yet — not an error, a gap. */
  | "no-city"
  | "auth"
  | "forbidden"
  | "quota"
  /** The scraping plan's credits are spent for the cycle. */
  | "no-credits"
  /** We reached them and they were too slow. Not the same as absent. */
  | "timeout"
  | "http"
  | "network"
  | "unknown-market"
  | "daily-cap";

export interface RedfinResult {
  live: boolean;
  asOf?: string;
  reason?: RedfinFailureReason;
  listings: RentalListing[];
  remaining?: number;
  cap?: number;
  /** The vendor's own status, when there was one. Carried so a miss can
   *  be described precisely rather than guessed at — and so it can be
   *  pasted into a support ticket by whoever hit it. */
  status?: number | null;
  /** The supplier explaining itself, already stripped of markup and
   *  bounded server-side. A status alone says a request failed; this
   *  says what the other end thought was wrong with it, which is the
   *  difference between a diagnosis and another round of guessing. */
  detail?: string | null;
}

const EMPTY: RentalListing[] = [];

/** Furnished rentals for one market. Never throws: a miss leaves the
 *  caller to say why, not to show the wrong inventory. */
/**
 * Longer than the route's own budget, and finite.
 *
 * The route may spend a minute reading a whole city, and the scraper
 * behind it waits longer still, so a browser that gave up early would
 * throw away an answer that was coming. What it must never do is wait
 * for ever: a fetch with no deadline on a route that can be cut off
 * mid-flight leaves the promise unsettled, and the caller that was
 * waiting on it shows a spinner nobody can clear without a reload.
 * That is what "Finding furnished rentals…" did for good.
 */
const ASK_TIMEOUT_MS = 90_000;

export async function getRedfinFurnished(
  marketSlug: string
): Promise<RedfinResult> {
  try {
    const res = await fetch(
      `/api/redfin?market=${encodeURIComponent(marketSlug)}&furnished=1`,
      { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) }
    );
    const data = (await res.json().catch(() => null)) as
      | (RedfinResult & { listings?: RentalListing[] })
      | null;
    if (res.ok && data?.live && Array.isArray(data.listings)) {
      return { ...data, listings: data.listings };
    }
    return {
      live: false,
      // A body with no reason means the response was not ours at all —
      // a gateway page, most often, where the platform cut the function
      // off. `timeout` is the honest word for that, and a 504 says it.
      reason: data?.reason ?? (res.status === 504 ? "timeout" : "network"),
      listings: EMPTY,
      remaining: data?.remaining,
      cap: data?.cap,
      status: data?.status ?? res.status,
      detail: data?.detail ?? null,
    };
  } catch (error) {
    // Our own deadline, on a route that never answered.
    const name = error instanceof Error ? error.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return {
      live: false,
      reason: timedOut ? "timeout" : "network",
      listings: EMPTY,
    };
  }
}

/**
 * Plain-language explanation of a miss, for the toolbar.
 *
 * No supplier is ever named here — this is read by members. Each
 * reason gets its own sentence, because the whole point is that the
 * reader can tell "try again" from "not in this market" from "we have
 * a billing problem". Lumping them together is what made the screen
 * say "unreachable" about four unrelated things.
 */
export function redfinFailureLabel(reason?: RedfinFailureReason): string {
  switch (reason) {
    case "no-city":
    case "unknown-market":
      return "Furnished search isn't available for this market";
    case "no-key":
      return "Furnished search isn't configured";
    case "auth":
    case "forbidden":
      return "Furnished search is unavailable right now";
    case "no-credits":
      return "Furnished search is out of capacity this month";
    case "quota":
      return "Furnished search is busy — try again in a moment";
    case "daily-cap":
      return "Daily furnished-search limit reached";
    case "timeout":
      return "Furnished search timed out — try again";
    case "http":
      return "Furnished search failed — try again";
    default:
      return "Furnished search unreachable";
  }
}

/** True where clicking the chip again is worth doing. */
export function redfinRetryable(reason?: RedfinFailureReason): boolean {
  return (
    reason === "timeout" ||
    reason === "quota" ||
    reason === "http" ||
    reason === "network" ||
    reason === undefined
  );
}
