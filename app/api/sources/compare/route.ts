/**
 * Which listing source is worth using:  /api/sources/compare?market=tampa
 *
 * Three questions, asked of the same market on the same day, because
 * the answers decide what the product is built on and none of them can
 * be looked up:
 *
 *   1. How many rentals does each source carry here?
 *   2. How many carry a photo?
 *   3. Does its furnished filter FILTER, or is it decoration?
 *
 * The third is the one that matters most and the one nobody's docs
 * answer. A furnished filter that returns the same count as the
 * unfiltered search is not a filter — that exact failure already cost
 * a day here, when a property-type filter the vendor silently ignored
 * came back with the full result set and read as success. So this
 * fetches each source with and without its filter and compares.
 *
 * The same three questions are also asked of whichever VENDOR fetches
 * the pages, because they answer them at wildly different prices and
 * one of them may answer a fourth: Zyte's automatic extraction turns a
 * page into structured JSON with no site-specific endpoint behind it.
 * If that works on Realtor it is the only route to Realtor's photos
 * and furnished filter that exists anywhere, so `&vendor=zyte` runs
 * the identical measurements through it.
 *
 * Costs a handful of credits per run and is not on any page's path.
 * Deliberately reports raw signals — counts, byte sizes, sample
 * addresses — rather than a verdict, because a probe that concludes
 * for you is a probe you can't check.
 */

import { NextResponse } from "next/server";
import { hasScrapflyKey, scrapflyPage } from "@/lib/live/scrapfly";
import {
  hasZyteKey,
  zyteKeyMissingMessage,
  zytePage,
  type ZyteExtractFrom,
  type ZyteMode,
  type ZyteProduct,
} from "@/lib/live/zyte";
import { REDFIN_CITY_ID, REDFIN_CITY_PATH } from "@/lib/live/redfin-city";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";

export const maxDuration = 300;

/** Image URLs on the listing CDNs, which is what "has a photo" means
 *  before any parsing: a card with no image URL near it has no photo. */
const PHOTO_PATTERNS: Record<string, RegExp> = {
  redfin: /ssl\.cdn-redfin\.com\/photo\/[^"'\s]+/g,
  realtor: /(?:ap\.rdcpix\.com|rdcpix\.com)\/[^"'\s]+/g,
  zillow: /photos\.zillowstatic\.com\/[^"'\s]+/g,
};

/** A rough count of listing cards, from the markers each site repeats
 *  once per result. Rough on purpose — the comparison is between
 *  sources on the same measure, not an exact inventory. */
const CARD_PATTERNS: Record<string, RegExp> = {
  redfin: /"streetLine"|"address"\s*:/g,
  realtor: /data-testid="card-address"|"line"\s*:\s*"/g,
  zillow: /"detailUrl"|"addressStreet"/g,
};

/**
 * The site's OWN total, which is the only honest basis for comparing a
 * filtered search with an unfiltered one.
 *
 * Counting cards cannot do it: every one of these sites paginates at
 * roughly forty, so both pages fill and both counts match no matter how
 * well the filter works. The first run of this probe read that as
 * "Redfin's furnished filter is ignored" — about a filter we had
 * already watched working — purely because 41 is a page, not a total.
 *
 * Several patterns per site, all reported, because guessing which one
 * a page uses is the same mistake in a new place.
 */
const TOTAL_PATTERNS: Record<string, RegExp[]> = {
  redfin: [
    /"totalHomes"\s*:\s*(\d+)/,
    /"numHomes"\s*:\s*(\d+)/,
    /([\d,]+)\s+(?:rentals?|homes?)\s+(?:available|for rent)/i,
  ],
  realtor: [
    /"totalMatchingRowsCount"\s*:\s*(\d+)/,
    /"total"\s*:\s*(\d+)/,
    /([\d,]+)\s+(?:apartments?|rentals?|homes?)\s+for rent/i,
  ],
  zillow: [
    /"totalResultCount"\s*:\s*(\d+)/,
    /"categoryTotals".{0,80}?(\d+)/,
    /([\d,]+)\s+(?:results?|rentals?)/i,
  ],
};

/** Every total a page admits to, so a wrong pattern is visible rather
 *  than silently standing in for the right one. */
function totalsIn(text: string, source: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pattern of TOTAL_PATTERNS[source] ?? []) {
    const hit = text.match(pattern);
    if (hit?.[1]) {
      const n = Number(hit[1].replace(/,/g, ""));
      if (Number.isFinite(n)) out[pattern.source.slice(0, 34)] = n;
    }
  }
  return out;
}

/** The lowest plausible total, as the comparison figure. */
function pickTotal(totals: Record<string, number>): number | null {
  const values = Object.values(totals).filter((n) => n > 0);
  return values.length > 0 ? Math.min(...values) : null;
}

interface Target {
  source: string;
  plain: string;
  furnished: string | null;
  /** How its furnished filter is expressed, for the write-up. */
  filterForm: string;
}

function targetsFor(market: Market): Target[] {
  // Same override the live URL builder uses: a handful of cities are
  // filed under another name and the probe has to ask for the same URL
  // the app would, or it measures a page nobody visits.
  const city =
    REDFIN_CITY_PATH[market.slug] ?? market.name.trim().replace(/\s+/g, "-");
  const slug = market.name.trim().toLowerCase().replace(/\s+/g, "-");
  const cityId = REDFIN_CITY_ID[market.slug];
  const state = market.stateCode;

  return [
    {
      source: "redfin",
      plain: cityId
        ? `https://www.redfin.com/city/${cityId}/${state}/${city}/rentals`
        : "",
      furnished: cityId
        ? `https://www.redfin.com/city/${cityId}/${state}/${city}/rentals/filter/is-furnished`
        : null,
      filterForm: "/filter/is-furnished — a real search filter",
    },
    {
      source: "realtor",
      plain: `https://www.realtor.com/apartments/${city}_${state}`,
      // Realtor expresses amenities as a path segment. Whether it
      // genuinely narrows the set is the thing being measured.
      furnished: `https://www.realtor.com/apartments/${city}_${state}/type-furnished`,
      filterForm: "/type-furnished — unverified, this run tests it",
    },
    {
      source: "zillow",
      plain: `https://www.zillow.com/${slug}-${state.toLowerCase()}/rentals/`,
      furnished: `https://www.zillow.com/${slug}-${state.toLowerCase()}/furnished-apartments/`,
      filterForm: "/furnished-apartments/ — believed keyword-derived",
    },
  ];
}

function count(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, pattern.flags)) ?? []).length;
}

/**
 * One page, from whichever vendor is being measured, flattened to the
 * fields the comparison actually reads. Vendors bill in their own
 * units and report it in their own places, so `cost` is deliberately a
 * string: printing what each one said beats inventing a shared number
 * neither of them quoted.
 */
interface Fetched {
  ok: boolean;
  status: number;
  content: string;
  bytes: number;
  cost: string | null;
  error: string | null;
  products: ZyteProduct[] | null;
}

/** What an extraction saw, when one ran. The photo figure here is the
 *  apples-to-apples partner of photosPerCard: same question, asked of
 *  structured output instead of a regex over HTML. */
function extractionOf(products: ZyteProduct[] | null) {
  if (products === null) return null;
  const withPhoto = products.filter((p) => p.images > 0).length;
  const images = products.reduce((sum, p) => sum + p.images, 0);
  return {
    products: products.length,
    withPhoto,
    imagesPerProduct:
      products.length > 0 ? Number((images / products.length).toFixed(1)) : null,
    /** A couple of rows verbatim, so "it worked" can be checked rather
     *  than taken on the count alone. */
    sample: products.slice(0, 3),
    note:
      products.length === 0
        ? "extraction ran and found nothing — a rental grid is not a product grid to this model, or the page was blocked"
        : null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ error: "unknown market" }, { status: 404 });
  }

  const vendor = searchParams.get("vendor") === "zyte" ? "zyte" : "scrapfly";
  if (vendor === "scrapfly" && !hasScrapflyKey()) {
    return NextResponse.json(
      { error: "no SCRAPFLY_SECRET_KEY on this deployment" },
      { status: 503 }
    );
  }
  if (vendor === "zyte" && !hasZyteKey()) {
    return NextResponse.json({ error: zyteKeyMissingMessage() }, { status: 503 });
  }

  const renderJs = searchParams.get("render") === "1";
  // Anti-bot bypass is the expensive setting — a measured 38 credits a
  // page against 1 for a plain fetch. Off-able, because whether these
  // sites actually need it is worth knowing before sizing a plan
  // around the assumption that they do.
  const asp = searchParams.get("asp") !== "0";

  // Zyte's three ways of fetching the same URL, which cost differently
  // and are the point of pointing this at Zyte at all.
  const modeParam = (searchParams.get("mode") ?? "").toLowerCase();
  const zyteMode: ZyteMode =
    modeParam === "productlist"
      ? "productList"
      : modeParam === "browser"
        ? "browser"
        : "http";

  // Where the extractor reads from, and the setting that decided the
  // first run: asking for the cheap HTTP path against Realtor returned
  // a ban, so extraction never ran and the run measured nothing except
  // that choice. Browser by default now; &extract=http to price the
  // cheap path deliberately rather than by accident.
  const zyteExtractFrom: ZyteExtractFrom =
    (searchParams.get("extract") ?? "").toLowerCase() === "http"
      ? "httpResponseBody"
      : "browserHtml";

  // Six fetches inside a five-minute ceiling is tight once a vendor
  // renders JavaScript, so one source at a time has to be possible or
  // the slow configurations can never be measured at all.
  const only = (searchParams.get("sources") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const fetchPage = (url: string): Promise<Fetched> =>
    vendor === "zyte"
      ? zytePage(url, zyteMode, {
          extractFrom: zyteExtractFrom,
          geolocation: "US",
        }).then((page) => ({
          ok: page.ok,
          status: page.status,
          content: page.content,
          bytes: page.bytes,
          cost: page.cost,
          error: page.error,
          products: page.products,
        }))
      : scrapflyPage(url, { renderJs, asp }).then((page) => ({
          ok: page.ok,
          status: page.status,
          content: page.content,
          bytes: page.bytes,
          cost: page.credits === null ? null : `${page.credits} credits`,
          error: page.error,
          products: null,
        }));

  const results = [];
  const costs: string[] = [];

  // Sequential: these go through the shared request gate anyway, and a
  // comparison that trips a rate limit measures the rate limit.
  for (const target of targetsFor(market)) {
    if (only.length > 0 && !only.includes(target.source)) continue;
    if (!target.plain) {
      results.push({ source: target.source, skipped: "no city id for this market" });
      continue;
    }

    const plain = await fetchPage(target.plain);
    const furnished = target.furnished ? await fetchPage(target.furnished) : null;
    for (const c of [plain.cost, furnished?.cost]) if (c) costs.push(c);

    const photos = count(plain.content, PHOTO_PATTERNS[target.source]);
    const cards = count(plain.content, CARD_PATTERNS[target.source]);
    const furnishedCards = furnished?.ok
      ? count(furnished.content, CARD_PATTERNS[target.source])
      : null;
    const plainTotals = totalsIn(plain.content, target.source);
    const furnishedTotals = furnished?.ok
      ? totalsIn(furnished.content, target.source)
      : {};
    const plainTotal = pickTotal(plainTotals);
    const furnishedTotal = pickTotal(furnishedTotals);

    // Extracted rows are a second, independent count of the same page,
    // so when the HTML patterns come back empty they still say whether
    // anything was there.
    const plainProducts = plain.products?.length ?? null;
    const furnishedProducts = furnished?.ok ? (furnished.products?.length ?? null) : null;

    results.push({
      source: target.source,
      filterForm: target.filterForm,
      plain: {
        url: target.plain,
        ok: plain.ok,
        status: plain.status,
        bytes: plain.bytes,
        cards,
        photoUrls: photos,
        /** Photos per listing — the comparison that decides which
         *  source dresses a card best. */
        photosPerCard: cards > 0 ? Number((photos / cards).toFixed(1)) : null,
        totals: plainTotals,
        total: plainTotal,
        extraction: extractionOf(plain.products),
        cost: plain.cost,
        error: plain.error,
      },
      furnished: furnished && {
        url: target.furnished,
        ok: furnished.ok,
        status: furnished.status,
        bytes: furnished.bytes,
        cards: furnishedCards,
        totals: furnishedTotals,
        total: furnishedTotal,
        extraction: extractionOf(furnished.products),
        cost: furnished.cost,
        error: furnished.error,
      },
      /**
       * Totals first, extracted rows next, cards last — and whenever
       * the answer rests on a page rather than a total it can say
       * "narrows" but never "ignored", because two full pages look
       * identical however good the filter.
       */
      filterNarrows:
        plainTotal !== null && furnishedTotal !== null
          ? furnishedTotal < plainTotal
            ? `yes — ${furnishedTotal} of ${plainTotal} total`
            : `NO — ${furnishedTotal} vs ${plainTotal} total, the filter is being ignored`
          : plainProducts !== null &&
              furnishedProducts !== null &&
              plainProducts > 0 &&
              furnishedProducts < plainProducts
            ? `yes — ${furnishedProducts} of ${plainProducts} extracted on page one`
            : furnishedCards !== null && cards > 0 && furnishedCards < cards
              ? `yes — ${furnishedCards} of ${cards} on page one`
              : "unknown — no total found, and one page of results looks the same filtered or not",
    });
  }

  return NextResponse.json({
    market: market.slug,
    vendor,
    ...(vendor === "zyte"
      ? { mode: zyteMode, extractFrom: zyteExtractFrom, geolocation: "US" }
      : { renderJs, asp }),
    /** Verbatim, per request, in whatever unit the vendor quoted. */
    costs: costs.length > 0 ? costs : null,
    results,
    howToRead:
      "filterNarrows compares the site's OWN totals, not page-one cards — every one of these paginates near forty, so card counts match whether the filter works or not. That flaw made the first run report Redfin's furnished filter as ignored, which it is not. " +
      "photosPerCard is the photo-quality comparison across sources. " +
      "`totals` lists every count each pattern found, so a wrong pattern is visible instead of quietly standing in for the right one. " +
      "cards:0 means blocked or JavaScript-rendered, not empty. " +
      "&vendor=zyte swaps the fetcher; with it, &mode=http|browser|productlist chooses how Zyte fetches. " +
      "productlist is the one worth running: it asks Zyte's automatic extraction to read the rental grid as a product grid, and `extraction.imagesPerProduct` is then the photo figure with no site-specific parsing behind it — the only route to Realtor's photos that would not need one. extraction.products:0 means the extractor ran and found nothing, which is an answer, not an error. " +
      "&sources=realtor limits the run to one site, which the slower Zyte modes need to finish inside the five-minute ceiling. " +
      "&asp=0 (scrapfly only) turns off the anti-bot bypass: it is the expensive setting, and whether these sites need it is worth measuring rather than assuming.",
  });
}
