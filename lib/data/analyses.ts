/**
 * Analysis lookup by id.
 *
 * There is no seeded history any more. An analysis is either a live
 * listing handed over from the Deal Finder in this browser session
 * (`r--live--…`, registered when its market was fetched) or a typed
 * address, which travels as query parameters to /analyze/new and needs
 * no lookup at all. Anything else is not an analysis this account ran
 * and resolves to nothing — the page 404s rather than showing a
 * plausible street no building stands on.
 */

import { analysisForListing } from "@/lib/mock/analyses";
import { liveListingByAnalysisId } from "@/lib/mock/rentals";
import type { Analysis } from "@/lib/mock/types";

export async function getAnalysis(id: string): Promise<Analysis | null> {
  if (!id.startsWith("r--live--")) return null;
  const listing = liveListingByAnalysisId(id);
  return listing ? analysisForListing(listing) : null;
}
