import { notFound } from "next/navigation";
import { getAnalysis, getMarket } from "@/lib/data";
import { resolveLiveAnalysis } from "@/lib/live/resolve";
import { withLiveComps } from "@/lib/live/str-comps";
import {
  buildAddressAnalysis,
  type AddressSpec,
} from "@/lib/live/address-analysis";
import { buildStrCompsFor } from "@/lib/mock/analyses";
import type { PropertyType } from "@/lib/mock/types";
import { AnalyzeResult } from "@/components/analyze/analyze-result";

const TYPES: PropertyType[] = ["apartment", "house", "condo", "townhome"];

/**
 * A searched address arrives as query parameters rather than a stored
 * row: the parameters ARE the analysis, so the URL is shareable, needs
 * no table, and survives a deploy without a migration.
 */
function specFrom(sp: Record<string, string | string[] | undefined>): AddressSpec | null {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const address = one("a")?.trim();
  const lat = Number(one("lat"));
  const lon = Number(one("lon"));
  const bedrooms = Number(one("bd"));
  const bathrooms = Number(one("ba"));
  const type = one("t") as PropertyType | undefined;

  if (!address || address.length < 4) return null;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(bedrooms) || bedrooms < 0 || bedrooms > 20) return null;
  if (!Number.isFinite(bathrooms) || bathrooms <= 0 || bathrooms > 20) return null;

  return {
    address,
    lat,
    lon,
    bedrooms: Math.round(bedrooms),
    bathrooms,
    propertyType: type && TYPES.includes(type) ? type : "house",
  };
}

export default async function AnalyzeResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  /* ---------------- A property someone typed in ---------------- */
  if (id === "new") {
    const spec = specFrom(sp);
    if (!spec) notFound();

    const { analysis: skeleton, market, milesAway } = buildAddressAnalysis(spec);
    // The property's OWN coordinates, not the market's centre. This is
    // the whole advantage of a searched address: comps drawn around the
    // actual street rather than around a city hall several miles away.
    const point = { lat: spec.lat, lon: spec.lon };
    const { analysis, liveComps } = await withLiveComps(skeleton, point);

    // No live comps means an empty set, and every derived figure would
    // divide by zero. Fall back to the market model and say so — the
    // page is labelled `liveComps={false}`, which is what drives the
    // "modelled, not measured" language throughout.
    const withComps =
      analysis.strComps.length > 0
        ? analysis
        : {
            ...analysis,
            strComps: buildStrCompsFor(market, spec.bedrooms, analysis.id),
          };

    return (
      <AnalyzeResult
        analysis={withComps}
        marketCenter={point}
        liveComps={liveComps}
        searchedAddress={{ market, milesAway }}
      />
    );
  }

  /* ---------------- A seeded or saved analysis ---------------- */
  const seeded = (await getAnalysis(id)) ?? (await resolveLiveAnalysis(id));
  if (!seeded) notFound();
  const market = await getMarket(seeded.marketSlug);
  const center = market ? { lat: market.lat, lon: market.lon } : null;
  // Live comps replace the seeded set before render, so every figure the
  // page derives — ADR, occupancy, breakeven, the revenue range — is real.
  const { analysis, liveComps } = await withLiveComps(seeded, center);
  return (
    <AnalyzeResult
      analysis={analysis}
      marketCenter={center}
      liveComps={liveComps}
    />
  );
}
