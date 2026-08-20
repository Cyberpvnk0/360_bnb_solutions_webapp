import { getAnalysis } from "@/lib/data";
import { AnalyzeEntry } from "@/components/analyze/analyze-entry";

export const metadata = { title: "Analyze" };

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  const initialAnalysis = address ? await getAnalysis(address) : null;
  return <AnalyzeEntry initialAnalysis={initialAnalysis} />;
}
