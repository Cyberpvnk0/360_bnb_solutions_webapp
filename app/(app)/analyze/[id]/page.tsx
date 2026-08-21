import { notFound } from "next/navigation";
import { getAnalysis, getMarket } from "@/lib/data";
import { AnalyzeResult } from "@/components/analyze/analyze-result";

export default async function AnalyzeResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await getAnalysis(id);
  if (!analysis) notFound();
  const market = await getMarket(analysis.marketSlug);
  return (
    <AnalyzeResult
      analysis={analysis}
      marketCenter={market ? { lat: market.lat, lon: market.lon } : null}
    />
  );
}
