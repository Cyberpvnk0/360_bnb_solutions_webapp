import { getAnalysis } from "@/lib/data";
import { resolveLiveAnalysis } from "@/lib/live/resolve";
import { AnalyzeEntry } from "@/components/analyze/analyze-entry";

export const metadata = { title: "Analyze" };

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string; lat?: string; lon?: string }>;
}) {
  const { address, lat, lon } = await searchParams;

  /**
   * The top-bar search sends a geocoded address with its coordinates
   * attached, so the form arrives ready to run rather than having to
   * geocode the same string again — which could resolve differently
   * from the row the person actually clicked.
   */
  const latNum = Number(lat);
  const lonNum = Number(lon);
  const prefill =
    address && Number.isFinite(latNum) && Number.isFinite(lonNum)
      ? { address, point: { lat: latNum, lon: lonNum } }
      : null;

  // Anything else in `address` is an analysis id: a listing handed over
  // from the Deal Finder, or a seeded pull.
  const initialAnalysis =
    address && !prefill
      ? ((await getAnalysis(address)) ?? (await resolveLiveAnalysis(address)))
      : null;

  // Key by whichever arrived, so picking a new address from the top bar
  // while already on this page remounts the form with the fresh prefill
  // instead of leaving the previous one on screen.
  return (
    <AnalyzeEntry
      key={prefill?.address ?? initialAnalysis?.id ?? "blank"}
      initialAnalysis={initialAnalysis}
      prefill={prefill}
    />
  );
}
