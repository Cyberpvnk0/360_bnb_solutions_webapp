/**
 * Which structured endpoints the scraping vendor actually has:
 *   /api/sources/endpoints?market=jacksonville
 *
 * The Redfin one bills 1 credit and returns parsed JSON, which is why
 * it beats a raw fetch plus anti-bot bypass by roughly forty to one.
 * Whether the same exists for Realtor decides whether Realtor — better
 * photos, a furnished filter that genuinely narrows — is affordable as
 * a source or a luxury at 38 credits a page.
 *
 * Their docs don't list it and their marketing pages say "Realtor
 * scraper" about what may just be raw HTML, so it gets measured. Each
 * candidate path is tried once; a path that doesn't exist answers 404
 * and bills nothing, so the probe costs about as much as the endpoints
 * that DO exist, which is the information being bought.
 *
 * Reports the response shape rather than a verdict: an endpoint that
 * answers 200 with an error body inside is not a working endpoint, and
 * that distinction has already cost a day here.
 */

import { NextResponse } from "next/server";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import { REDFIN_CITY_ID } from "@/lib/live/redfin-city";

export const maxDuration = 120;

const BASE = "https://api.scraperapi.com/structured";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = MARKET_BY_SLUG.get(searchParams.get("market") ?? "");
  if (!market) {
    return NextResponse.json({ error: "unknown market" }, { status: 404 });
  }
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) {
    return NextResponse.json({ error: "no SCRAPERAPI_KEY" }, { status: 503 });
  }

  const city = market.name.trim().replace(/\s+/g, "-");
  const state = market.stateCode;
  const cityId = REDFIN_CITY_ID[market.slug];

  const realtorUrl = `https://www.realtor.com/apartments/${city}_${state}`;
  const candidates: { label: string; endpoint: string; target: string }[] = [
    // The known-good one, as a control: if this fails too, the answer
    // is "no credits", not "no such endpoint".
    ...(cityId
      ? [
          {
            label: "redfin/search/v1 (control — known to work)",
            endpoint: `${BASE}/redfin/search/v1`,
            target: `https://www.redfin.com/city/${cityId}/${state}/${city}/rentals`,
          },
        ]
      : []),
    { label: "realtor/search/v1", endpoint: `${BASE}/realtor/search/v1`, target: realtorUrl },
    { label: "realtor/forrent/v1", endpoint: `${BASE}/realtor/forrent/v1`, target: realtorUrl },
    { label: "realtor/search", endpoint: `${BASE}/realtor/search`, target: realtorUrl },
    { label: "realtorcom/search/v1", endpoint: `${BASE}/realtorcom/search/v1`, target: realtorUrl },
  ];

  const results = [];
  for (const { label, endpoint, target } of candidates) {
    const params = new URLSearchParams({ api_key: key, url: target });
    let status = 0;
    let bytes = 0;
    let head = "";
    let rows: number | null = null;
    let arrays: string[] = [];
    try {
      const res = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
      status = res.status;
      const text = await res.text();
      bytes = text.length;
      head = text.replace(/\s+/g, " ").slice(0, 160);
      if (text.startsWith("{") || text.startsWith("[")) {
        const body: unknown = JSON.parse(text);
        // Name every array and its length: "where are the records" is
        // the only question a new endpoint's shape has to answer.
        const seen: string[] = [];
        const walk = (value: unknown, path: string, depth: number) => {
          if (depth > 3 || seen.length > 12) return;
          if (Array.isArray(value)) {
            seen.push(`${path || "(root)"}[${value.length}]`);
            if (rows === null || value.length > rows) rows = value.length;
            return;
          }
          if (value && typeof value === "object") {
            for (const [k, v] of Object.entries(value)) {
              walk(v, path ? `${path}.${k}` : k, depth + 1);
            }
          }
        };
        walk(body, "", 0);
        arrays = seen;
      }
    } catch (error) {
      head = error instanceof Error ? error.message.slice(0, 120) : "failed";
    }
    results.push({
      label,
      status,
      bytes,
      /** Arrays found and their lengths — records, if there are any. */
      arrays,
      biggestArray: rows,
      head,
      exists: status === 200 && (rows ?? 0) > 0,
    });
  }

  const control = results.find((r) => r.label.startsWith("redfin"));
  return NextResponse.json({
    market: market.slug,
    results,
    howToRead:
      control && !control.exists
        ? "The Redfin control FAILED, so this run says nothing about Realtor — read its `head`. Almost certainly the plan is out of credits; top up and run again."
        : "The Redfin control worked, so a Realtor path that returns 404 or an empty body genuinely does not exist. `exists` means 200 AND records found — a 200 carrying an error message is not an endpoint.",
  });
}
