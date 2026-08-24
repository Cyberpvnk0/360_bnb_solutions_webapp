import { notFound } from "next/navigation";
import { getAnalysis, getMarket } from "@/lib/data";
import { resolveLiveAnalysis } from "@/lib/live/resolve";
import { withLiveComps } from "@/lib/live/str-comps";
import { AnalyzeResult } from "@/components/analyze/analyze-result";

export default async function AnalyzeResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
