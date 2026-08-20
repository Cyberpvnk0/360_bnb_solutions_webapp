/**
 * Analysis (address pull) data access. Mock-backed today.
 */

import { ADDRESS_SUGGESTIONS, ANALYSES, ANALYSIS_BY_ID } from "@/lib/mock/analyses";
import type { Analysis } from "@/lib/mock/types";
import { simulateLatency } from "./latency";

export async function getAnalysis(id: string): Promise<Analysis | null> {
  await simulateLatency();
  return ANALYSIS_BY_ID.get(id) ?? null;
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
  const found = ANALYSIS_BY_ID.get(analysisId);
  return { id: found?.id ?? ANALYSES[0].id };
}
