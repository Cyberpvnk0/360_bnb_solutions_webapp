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
 * Costs a handful of credits per run and is not on any page's path.
 * Deliberately reports raw signals — counts, byte sizes, sample
 * addresses — rather than a verdict, because a probe that concludes
 * for you is a probe you can't check.
 */

import { NextResponse } from "next/server";
import { hasScrapflyKey, scrapflyPage } from "@/lib/live/scrapfly";
import { REDFIN_CITY_ID } from "@/lib/live/redfin-city";
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

interface Target {
  source: string;
  plain: string;
  furnished: string | null;
  /** How its furnished filter is expressed, for the write-up. */
  filterForm: string;
}

function targetsFor(market: Market): Target[] {
  const city = market.name.trim().replace(/\s+/g, "-");
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ error: "unknown market" }, { status: 404 });
  }
  if (!hasScrapflyKey()) {
    return NextResponse.json(
      { error: "no SCRAPFLY_SECRET_KEY on this deployment" },
      { status: 503 }
    );
  }
  const renderJs = searchParams.get("render") === "1";

  const results = [];
  let spent = 0;

  // Sequential: these go through the shared request gate anyway, and a
  // comparison that trips a rate limit measures the rate limit.
  for (const target of targetsFor(market)) {
    if (!target.plain) {
      results.push({ source: target.source, skipped: "no city id for this market" });
      continue;
    }

    const plain = await scrapflyPage(target.plain, { renderJs });
    const furnished = target.furnished
      ? await scrapflyPage(target.furnished, { renderJs })
      : null;
    spent += (plain.credits ?? 0) + (furnished?.credits ?? 0);

    const photos = count(plain.content, PHOTO_PATTERNS[target.source]);
    const cards = count(plain.content, CARD_PATTERNS[target.source]);
    const furnishedCards = furnished?.ok
      ? count(furnished.content, CARD_PATTERNS[target.source])
      : null;

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
        error: plain.error,
      },
      furnished: furnished && {
        url: target.furnished,
        ok: furnished.ok,
        status: furnished.status,
        bytes: furnished.bytes,
        cards: furnishedCards,
        error: furnished.error,
      },
      /** The only reading that matters, and it needs no interpretation:
       *  a filter that narrows returns fewer cards than the plain page.
       *  Equal counts mean the filter did nothing. */
      filterNarrows:
        furnishedCards === null || cards === 0
          ? null
          : furnishedCards < cards
            ? `yes — ${furnishedCards} of ${cards}`
            : `NO — ${furnishedCards} vs ${cards}, the filter is being ignored`,
    });
  }

  return NextResponse.json({
    market: market.slug,
    renderJs,
    creditsSpent: spent || null,
    results,
    howToRead:
      "cards and photoUrls are raw pattern counts, comparable BETWEEN sources on the same market rather than exact inventory. " +
      "filterNarrows is the decisive one: a furnished filter that returns the same card count as the plain page is not filtering. " +
      "A source with cards:0 was blocked or renders its listings in JavaScript — retry with &render=1 before concluding it has no data.",
  });
}
