/**
 * Whether Zillow has a page for an address, asked quickly and cheaply.
 *
 * Zillow's address URL (lib/live/listing-links, zillowHref) is a
 * search. When the address matches one home, their server answers
 * with a redirect to that home's page; when it matches none, it
 * answers with a search of the area, or a redirect to one. So one
 * request that follows no redirect tells which — when they answer at
 * all: from a server they often do not, and a refusal, a challenge
 * page or silence says nothing about the address. Those are
 * "unknown", and the click opens the address URL as it would have
 * anyway. Nothing is billed: no proxy, no vendor, one request with a
 * short clock on it.
 */

import { zillowHref, type Addressed } from "./listing-links";

export type ZillowCheck =
  | { kind: "page"; url: string }
  | { kind: "none"; detail: string }
  | { kind: "unknown"; detail: string };

const DEFAULT_TIMEOUT_MS = 2_500;

/** A redirect to somewhere that is not a home is a search — unless it
 *  is a challenge, which says nothing. */
function isChallenge(location: string): boolean {
  return /captcha|perimeterx|\/px\/|_px|blocked|access-denied/i.test(location);
}

/** Where a redirect points, when it points somewhere on their site. */
function onTheirSite(location: string): URL | null {
  try {
    const u = new URL(location, "https://www.zillow.com/");
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)zillow\.com$/i.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/** The home's page, when a redirect points at one. */
function homePage(u: URL): string | null {
  if (!/\/homedetails\//i.test(u.pathname)) return null;
  const page = new URL(u.toString());
  page.search = "";
  page.hash = "";
  return page.toString();
}

export async function checkZillow(
  place: Addressed,
  opts: { timeoutMs?: number } = {}
): Promise<ZillowCheck> {
  const url = zillowHref(place);
  if (!url) return { kind: "unknown", detail: "no address to ask about" };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return {
      kind: "unknown",
      detail: e instanceof Error && e.name === "TimeoutError" ? "no answer in time" : "unreachable",
    };
  }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") ?? "";
    const to = onTheirSite(location);
    if (!to || isChallenge(location)) {
      return { kind: "unknown", detail: `redirected elsewhere (${res.status})` };
    }
    const page = homePage(to);
    if (page) return { kind: "page", url: page };
    return { kind: "none", detail: `redirected to a search (${res.status})` };
  }
  return { kind: "unknown", detail: `HTTP ${res.status}` };
}
