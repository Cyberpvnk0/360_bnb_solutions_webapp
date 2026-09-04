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
import { fetchRedfinContact, isListingPageUrl } from "@/lib/live/redfin-contact";
import { reserveContact } from "@/lib/live/quota";
import { ScraperApiError } from "@/lib/live/scraperapi";

/** A protected listing page takes seconds and may climb a tier ladder;
 *  the platform default would kill it mid-climb and read as a silent
 *  failure. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
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
