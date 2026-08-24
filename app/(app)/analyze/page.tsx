import { getAnalysis } from "@/lib/data";
import { resolveLiveAnalysis } from "@/lib/live/resolve";
import { AnalyzeEntry } from "@/components/analyze/analyze-entry";

export const metadata = { title: "Analyze" };

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  // A live listing's id resolves through the feed; seeded ids resolve
  // straight from the mock world.
  const initialAnalysis = address
    ? ((await getAnalysis(address)) ?? (await resolveLiveAnalysis(address)))
    : null;
  // Key by address so picking a new one from the top-bar search while
  // already on /analyze remounts the form with the fresh prefill.
  return (
    <AnalyzeEntry
      key={initialAnalysis?.id ?? "blank"}
      initialAnalysis={initialAnalysis}
    />
  );
}
