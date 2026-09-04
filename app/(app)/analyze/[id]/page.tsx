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

/** What a two-bedroom, two-bath unit is: the shape most of this
 *  strategy is run on, and the least surprising thing to assume when
 *  nobody has said. */
const ASSUMED_BEDROOMS = 2;
const ASSUMED_BATHROOMS = 2;

/** The band a monthly residential lease lives in. Below it is a nightly
 *  rate or a typo; above it is not a lease this product analyses. */
const MIN_RENT = 100;
const MAX_RENT = 100_000;

/**
 * A searched address arrives as query parameters rather than a stored
 * row: the parameters ARE the analysis, so the URL is shareable, needs
 * no table, and survives a deploy without a migration.
 *
 * Bedrooms and baths are OPTIONAL. A listing handed over from the Deal
 * Finder knows both and says so; somebody typing a street address into
 * a box does not, and making them answer before seeing anything is a
 * form standing between a person and the thing they came for. Assume
 * the common shape, run the numbers, and let them correct it on the
 * result — where they can see what the correction changes.
 *
 * So is the RENT, and it matters more than the rest. A listing knows
 * what it asks; a typed address does not, and the analyzer estimates it
 * from comparable leases. Both are legitimate, they are not the same
 * kind of fact, and the page has to say which one it is holding — every
 * figure below the fold is computed off this number.
 */
function specFrom(
  sp: Record<string, string | string[] | undefined>
): (AddressSpec & { assumedSize: boolean }) | null {
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
  const rent = Number(one("r"));

  if (!address || address.length < 4) return null;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;

  // Out-of-range is treated as absent rather than fatal: a bad size in
  // a hand-edited URL should still produce an analysis someone can fix,
  // not a 404 with no explanation.
  const bd =
    Number.isFinite(bedrooms) && bedrooms >= 0 && bedrooms <= 20
      ? Math.round(bedrooms)
      : null;
  const ba =
    Number.isFinite(bathrooms) && bathrooms > 0 && bathrooms <= 20
      ? bathrooms
      : null;

  // A residential lease, or nothing. Out of band means a typo or a
  // hand-edited URL, and a nightly rate read as a monthly one would
  // silently make every deal on the page look extraordinary.
  const rentMonthly =
    Number.isFinite(rent) && rent >= MIN_RENT && rent <= MAX_RENT
      ? Math.round(rent)
      : undefined;

  return {
    address,
    lat,
    lon,
    bedrooms: bd ?? ASSUMED_BEDROOMS,
    bathrooms: ba ?? ASSUMED_BATHROOMS,
    propertyType: type && TYPES.includes(type) ? type : "house",
    rentMonthly,
    city: one("c")?.trim() || undefined,
    stateCode: one("s")?.trim().slice(0, 2).toUpperCase() || undefined,
    /** True when nobody told us the size and we picked one. The result
     *  page says so rather than presenting a guess as a reading. */
    assumedSize: bd === null || ba === null,
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
        // The searched address IS the property, so the curb shot is of
        // the building somebody typed rather than of a city centre.
        propertyPoint={point}
        liveComps={liveComps}
        searchedAddress={{
          market,
          milesAway,
          assumedSize: spec.assumedSize,
          // Which kind of number the calculator opened on. Measured and
          // modelled are never blended here, and never shown alike.
          rentSource: spec.rentMonthly === undefined ? "market" : "listing",
        }}
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
