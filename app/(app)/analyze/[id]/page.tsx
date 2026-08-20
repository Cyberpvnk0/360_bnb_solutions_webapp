import { notFound } from "next/navigation";
import { getAnalysis } from "@/lib/data";
import { AnalyzeResult } from "@/components/analyze/analyze-result";

export default async function AnalyzeResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await getAnalysis(id);
  if (!analysis) notFound();
  return <AnalyzeResult analysis={analysis} />;
}
