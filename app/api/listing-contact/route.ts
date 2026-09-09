/**
 * Who to ring about one listing.
 *
 *   GET /api/listing-contact?url=<the listing's own page>
 *
 * The market search does not carry contact details — a shape probe over
 * 164 rentals found a `phone` field that is empty on every row — but the
 * listing PAGE publishes them, so this reads that page and returns the
 * name and telephone number on it. Nothing else off the page crosses
 * this boundary: see the rule at the top of lib/live/redfin-contact.
 *
 * ON DEMAND, ONE PROPERTY AT A TIME. Every page is its own billed
 * scrape, so this runs when a student opens a property rather than over
 * a market's five hundred rows, is capped daily (lib/live/quota), and
 * rides a month-long vendor cache so the same listing is paid for once
 * however many people open it.
 *
 * Every answer says which kind it is, because they mean different
 * things to a reader: a contact, "this listing publishes none", or "we
 * could not read the page". The last two must never render the same —
 * unknown is not none.
 */

import { NextResponse } from "next/server";
import { requirePaid } from "@/lib/auth/gate";
import { fetchRedfinContact, isListingPageUrl } from "@/lib/live/redfin-contact";
import { resolveListingPage } from "@/lib/live/redfin-page";
import { reserveContact } from "@/lib/live/quota";
import { ScraperApiError } from "@/lib/live/scraperapi";

/**
 * Room for two protected reads in a row: finding the page by address
 * (up to fifty seconds, lib/live/redfin-page) and then reading it (the
 * vendor retries for about seventy before it gives up, lib/live/
 * scraperapi). The platform default would kill the second read
 * mid-flight and the panel would call a page it never saw unreadable.
 */
export const maxDuration = 180;

export async function GET(request: Request) {
  // A listing page is a billed read, made for one person's click.
  // Only accounts on a plan that buys anything may spend it.
  const paid = await requirePaid();
  if (!paid.ok) return paid.response;

  const { searchParams } = new URL(request.url);
  // Either the listing's page, or the address to find it by: a row the
  // market join never matched has no page on file, and its contact was
  // simply never looked up. See lib/live/redfin-page.
  let url = searchParams.get("url");
  let page: string | null = null;
  if (!url) {
    const address = (searchParams.get("address") ?? "").trim();
    const city = (searchParams.get("city") ?? "").trim();
    const state = (searchParams.get("state") ?? "").trim().toUpperCase();
    const zip = (searchParams.get("zip") ?? "").trim() || undefined;
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const point =
      Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
        ? { lat, lon }
        : undefined;
    if (address.length >= 4 && city.length >= 2 && /^[A-Z]{2}$/.test(state)) {
      const found = await resolveListingPage({ address, city, stateCode: state, zip, point });
      if (!found.url) {
        // Nothing to read, and nothing was spent on a page. `blocked`
        // tells the two reasons apart: the portal answered that it has
        // no page for this address, or it never answered at all — a
        // clock that ran out is "try again", not "not here". `detail`
        // says what the lookup did answer, for whoever is checking why.
        return NextResponse.json({
          ok: true,
          contact: null,
          blocked: !found.answered,
          page: null,
          detail: found.detail,
        });
      }
      page = found.url;
      url = page;
    }
  }
  // Counts only — which strategies fired, never what the page said.
  // An empty extraction has half a dozen causes needing opposite fixes,
  // and this tells them apart in one billed read instead of six.
  const probe = searchParams.get("probe") !== null;

  // Checked here as well as in the module: this string arrives from a
  // browser and is about to become a URL somebody's money fetches.
  if (!url || !isListingPageUrl(url)) {
    return NextResponse.json(
      { ok: false, reason: "bad-url" },
      { status: 400 }
    );
  }

  const budget = reserveContact(url);
  if (!budget.allowed) {
    return NextResponse.json(
      { ok: false, reason: "daily-cap", cap: budget.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const { contact, credits, blocked, signals } = await fetchRedfinContact(
      url,
      { probe }
    );
    return NextResponse.json({
      ok: true,
      // Null with `blocked` false means the page published nothing.
      // Null with `blocked` true means we never got to see the page.
      contact,
      blocked,
      // The page, when this call had to find it — the panel's "View
      // photos" can open it from now on.
      page,
      credits,
      ...(signals ? { signals } : {}),
      remaining: budget.remaining,
      cap: budget.cap,
    });
  } catch (error) {
    if (error instanceof ScraperApiError) {
      return NextResponse.json(
        { ok: false, reason: error.reason, status: error.status ?? null },
        { status: error.reason === "no-key" ? 503 : 502 }
      );
    }
    return NextResponse.json(
      { ok: false, reason: "network", status: null },
      { status: 502 }
    );
  }
}
