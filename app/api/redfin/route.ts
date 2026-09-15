/**
 * Redfin rentals for one market:
 *   /api/redfin?market=jacksonville&furnished=1
 *   /api/redfin?market=jacksonville&furnished=1&shape=1
 *
 * The furnished flag is passed through to Redfin's OWN search filter, so
 * what comes back is furnished because Redfin says so — the one amenity
 * claim in this codebase that isn't mined out of prose.
 *
 * One request per market per day, cached and shared. `shape=1` reports
 * the vendor's field names and value types (never values) so the mapper
 * can be pinned to the real schema in a single request.
 */

import { NextResponse } from "next/server";
import { claimMarket, monthlyCap, requireOperator } from "@/lib/auth/gate";
import { checkLiveSearch, commitLiveSearch } from "@/lib/live/quota";
import {
  fetchRedfinRentals,
  fetchRedfinSearchRows,
  redfinRentalsUrlFor,
  redfinScrapeTier,
  RedfinError,
} from "@/lib/live/redfin";
import { cityIdFor } from "@/lib/live/redfin-city";
import { probeCityId } from "@/lib/live/redfin-city";
import {
  amenityFields,
  arrayPaths,
  describeFields,
  proseFields,
  statusStrings,
} from "@/lib/live/shape";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";

/** A parsed search of a whole market is slower than a plain fetch. */
export const maxDuration = 60;

/**
 * Our own deadline, deliberately under maxDuration.
 *
 * When the platform kills a function at its limit, what reaches the
 * browser is a gateway error with no body — the client parses nothing,
 * falls back to "network", and the screen says the search was
 * unreachable when in fact it was slow. Answering ourselves a few
 * seconds early means the browser always gets JSON with a reason it
 * can name.
 */
const BUDGET_MS = 50_000;

/** The work, or a `timeout` reason — never a silent death. */
async function withinBudget<T>(job: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RedfinError("timeout")), BUDGET_MS);
  });
  try {
    return await Promise.race([job, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function failure(error: unknown) {
  if (error instanceof RedfinError) {
    return NextResponse.json(
      {
        live: false,
        reason: error.reason,
        status: error.status ?? null,
        detail: error.detail ?? null,
      },
      {
        status:
          error.reason === "no-key" || error.reason === "no-city"
            ? 503
            : error.reason === "timeout"
              ? 504
              : 502,
      }
    );
  }
  return NextResponse.json(
    { live: false, reason: "network", status: null },
    { status: 502 }
  );
}

/** The supplier's refusal wording, without importing the matcher's
 *  whole module graph into this route. */
function needsPremiumText(detail: string | null | undefined): boolean {
  return Boolean(detail && /premium=true|ultra_premium|protected domains?/i.test(detail));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json(
      { live: false, reason: "unknown-market" },
      { status: 404 }
    );
  }
  const furnished = searchParams.get("furnished") === "1";
  const shape = searchParams.get("shape");

  // The two diagnostics spend vendor credits on purpose, skip every
  // ledger, and print the vendor's own schema: operator-only, and never
  // open by default. The furnished search below is a product feature
  // and answers to the account's plan.
  if (shape || searchParams.get("resolve") || searchParams.get("probe")) {
    const op = await requireOperator(request);
    if (!op.ok) return op.response;
  }

  /**
   * THE FILTERED URL AND THE BARE ONE, SIDE BY SIDE.
   *
   *   /api/redfin?market=boston&probe=1
   *
   * Boston has hundreds of furnished rentals listed and this product
   * said it had none. Two questions decide why, and neither can be
   * answered by reading code: does the city's own rentals URL work,
   * and does the same URL with /filter/is-furnished on the end work?
   * This asks the site both, in one request, and prints the URLs, the
   * statuses and the row counts.
   *
   * Two billed page reads, on purpose, operator-only. That is the
   * price of an answer instead of another guess — and the whole
   * furnished feature for 409 markets rests on the filter segment
   * being spelled the way the site spells it today.
   */
  if (searchParams.get("probe")) {
    const cityId = await cityIdFor(market);
    if (cityId === null) {
      return NextResponse.json({
        market: market.slug,
        cityId: null,
        verdict:
          "No city id — the resolver could not place this market. Try ?resolve=1.",
      });
    }
    const look = async (opts: { furnished?: boolean }) => {
      const url = redfinRentalsUrlFor(market, cityId, opts);
      try {
        const walk = await fetchRedfinSearchRows(url, 1);
        return {
          url,
          ok: true,
          status: 200,
          reason: null,
          rows: walk.raw.length,
          // What the supplier says this cost. The premium tier is
          // several times a standard request and nobody should have to
          // take my word for the multiplier.
          credits: walk.credits,
        };
      } catch (e) {
        const err = e instanceof RedfinError ? e : null;
        return {
          url,
          ok: false,
          status: err?.status ?? null,
          reason: err?.reason ?? "unknown",
          detail: err?.detail?.slice(0, 200) ?? null,
          rows: 0,
        };
      }
    };
    // Sequential, not parallel: the second answer only means something
    // if the first one was allowed through, and two at once against a
    // throttling supplier reads as a throttle rather than a verdict.
    const bare = await look({});
    const filtered = await look({ furnished: true });
    return NextResponse.json({
      market: market.slug,
      name: `${market.name}, ${market.stateCode}`,
      cityId,
      /**
       * Which tier these two requests went out on — and, because this
       * field did not exist before the tier did, whether the build
       * answering you is the one that sends the flag at all.
       *
       * Two identical probe results, before and after a fix, are
       * either a fix that did not work or a deploy that did not land,
       * and nothing in the old response could tell those apart.
       */
      scrapeTier: redfinScrapeTier(),
      bare,
      filtered,
      verdict: !bare.ok
        ? `The city's own rentals URL fails (${bare.reason} ${bare.status ?? ""}). Open bare.url in a browser — if the site serves it, the path shape is wrong, not the filter.`
        : bare.rows === 0
          ? "The city's rentals URL answered but parsed no rows. The path may be right and the extractor wrong — compare against a browser."
          : filtered.ok && filtered.rows > 0
            ? "Both work. Furnished search is healthy for this market."
            : filtered.ok
              ? "The filtered URL works and genuinely returned no rows for page 1."
              : `The city works (${bare.rows} rows) and the FILTERED url fails (${filtered.reason} ${filtered.status ?? ""}). Open filtered.url in a browser: if it 404s there too, "is-furnished" is not how the site spells this filter any more and redfinRentalsUrlFor needs the real segment.`,
      note:
        !bare.ok && "detail" in bare && needsPremiumText(bare.detail)
          ? `The supplier refused the domain. This probe ran on the "${redfinScrapeTier()}" tier — if that is "standard", set REDFIN_SCRAPE_TIER=premium; if it is already premium, try ultra.`
          : undefined,
    });
  }

  // Resolver check: which city id this market lands on, and the URL it
  // produces — cheap, and the answer worth pasting into the seeded map
  // so the lookup never has to run again.
  if (searchParams.get("resolve")) {
    const probe = await probeCityId(market);
    const { cityId } = probe;
    return NextResponse.json({
      market: market.slug,
      name: `${market.name}, ${market.stateCode}`,
      cityId,
      searchUrl:
        cityId === null
          ? null
          : redfinRentalsUrlFor(market, cityId, { furnished: true }),
      /** Every step, so a null answer says WHICH thing went wrong:
       *  blocked, unparseable, or matched nothing. */
      diagnostics: {
        autocompleteUrl: probe.autocompleteUrl,
        status: probe.status,
        tier: probe.tier,
        tiersTried: probe.tiersTried,
        parsed: probe.parsed,
        bytes: probe.bytes,
        head: probe.head,
        candidatesFound: probe.candidates.length,
        candidates: probe.candidates,
      },
      verdict:
        cityId !== null
          ? `Open searchUrl in a browser: it must be ${market.name}, ${market.stateCode}. If it is, add "${market.slug}: ${cityId}" to REDFIN_CITY_ID.`
          : probe.status === null
            ? "The resolver never got a response — check SCRAPERAPI_KEY."
            : !probe.parsed
              ? "No tier returned parseable JSON. Read `head` and `tiersTried`: a plan that refuses premium shows a 403 here, a protected domain shows ScraperAPI's own advice."
              : probe.candidates.length === 0
                ? "Parsed, but no rows looked like cities. The payload shape differs from what extractCandidates expects."
                : "Rows came back but none matched this city AND state — see `candidates`.",
    });
  }

  // Setup diagnostic: the vendor's own field names, so the provisional
  // aliases in lib/live/redfin can be pinned and the rest deleted.
  if (shape) {
    try {
      const {
        raw,
        listings,
        skipped,
        geocodedBy,
        pages,
        morePages,
        body,
        parsed,
        bytes,
        credits,
        searchUrl,
      } = await fetchRedfinRentals(market, { furnished });
      const fields = describeFields(raw);
      // Describe the WHOLE response, not just the rows we managed to
      // extract: when extraction finds nothing, the rows are empty and
      // describing them explains nothing at all.
      const found = arrayPaths(body);
      // Deep enough to see inside the objects Redfin wraps its price in.
      const shapeOfBody = describeFields([body], 7);
      return NextResponse.json({
        searchUrl,
        parsed,
        bytes,
        credits,
        rowsReturned: raw.length,
        rowsMapped: listings.length,
        /** Why unusable rows were dropped — a zero result that explains
         *  itself instead of looking like an empty market. */
        skipped,
        /** Pages followed, and whether the cap cut the market short. */
        pages,
        morePages,
        /** Which geocoder placed the rows we kept. Redfin ships no
         *  coordinates, so this is the real gate on how many show. */
        geocodedBy,
        /** Every array in the payload, by path and length — the answer
         *  to "where are the listings?" without knowing the schema. */
        arrays: found,
        /** The vendor explaining itself, when it carries no records. */
        status: statusStrings(body),
        /** Top-level shape of the response. */
        responseShape: shapeOfBody,
        /** Fields of the rows our extractor did find, if any. */
        vendorFields: fields,
        proseFields: proseFields(fields),
        amenityFields: amenityFields(fields),
        sample: listings.slice(0, 3),
        verdict: !parsed
          ? "Response wasn't JSON. Read `status` and `bytes` — this is usually an error page, not a payload."
          : listings.length === 0 && raw.length > 0
            ? "Rows came back but none mapped — pin the aliases in lib/live/redfin to vendorFields."
            : raw.length === 0 && found.some((a) => a.length > 0)
              ? `The payload DOES carry records, at: ${found
                  .filter((a) => a.length > 0)
                  .map((a) => `${a.path} (${a.length})`)
                  .join(", ")}. Point extractListings at that path.`
              : raw.length === 0
                ? "The payload genuinely carries no records. Either this search has no results, or the URL is wrong — open searchUrl in a browser to tell which."
                : `Mapped ${listings.length} of ${raw.length}.`,
      });
    } catch (error) {
      return failure(error);
    }
  }

  // Same key as the rentals feed, so a market the account has already
  // opened this month is not charged again for its furnished search —
  // and a plan with no markets is told so before anything is spent.
  const plan = await claimMarket(`market:${market.slug}`);
  if (!plan.allowed) return monthlyCap(plan.used, plan.cap);

  const cacheKey = `redfin:${market.slug}:${furnished ? "furnished" : "all"}`;
  const gate = checkLiveSearch(cacheKey);
  if (!gate.allowed) {
    return NextResponse.json(
      { live: false, reason: "daily-cap", cap: gate.cap, remaining: 0 },
      { status: 429 }
    );
  }

  try {
    const { listings, credits, searchUrl } = await withinBudget(
      fetchRedfinRentals(market, { furnished })
    );
    const spent = commitLiveSearch(cacheKey);
    return NextResponse.json({
      live: true,
      asOf: new Date().toISOString(),
      source: "redfin",
      market: market.slug,
      furnished,
      center: { lat: market.lat, lon: market.lon },
      listings,
      credits,
      searchUrl,
      remaining: spent.remaining,
      cap: spent.cap,
    });
  } catch (error) {
    return failure(error);
  }
}
