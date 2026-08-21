/**
 * Analysis (address pull) data access. Mock-backed today.
 */

import {
  ADDRESS_SUGGESTIONS,
  ANALYSES,
  ANALYSIS_BY_ID,
  analysisForListing,
} from "@/lib/mock/analyses";
import {
  allRentals,
  liveListingByAnalysisId,
  RENTAL_BY_ANALYSIS_ID,
} from "@/lib/mock/rentals";
import type { Analysis } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

/** Seeded pulls first; `r--` ids resolve lazily through the Deal Finder's
 *  listing set — seeded inventory or live rows registered this session —
 *  so handing any listing to the analyzer just works. */
function resolveAnalysis(id: string): Analysis | null {
  const seeded = ANALYSIS_BY_ID.get(id);
  if (seeded) return seeded;
  if (id.startsWith("r--")) {
    allRentals(); // ensure the lazy by-analysis-id index is built
    const listing =
      RENTAL_BY_ANALYSIS_ID.get(id) ?? liveListingByAnalysisId(id);
    if (listing) return analysisForListing(listing);
  }
  return null;
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  await simulateLatency();
  return resolveAnalysis(id);
}

export async function getRecentAnalyses(limit = 5): Promise<Analysis[]> {
  await simulateLatency();
  return [...ANALYSES]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export interface AddressSuggestion {
  analysisId: string;
  label: string;
  city: string;
  stateCode: string;
}

/** Mocked address autocomplete: substring match over seeded addresses. */
export async function searchAddresses(query: string): Promise<AddressSuggestion[]> {
  await simulateLatency(180);
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return ADDRESS_SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 6);
}

/**
 * "Run" a pull. Real implementation will hit the data vendor; the mock
 * pretends to work for ~2s and resolves to an existing analysis id.
 */
export async function runAddressPull(analysisId: string): Promise<{ id: string }> {
  await simulateLatency(2000);
  const found = resolveAnalysis(analysisId);
  return { id: found?.id ?? ANALYSES[0].id };
}
