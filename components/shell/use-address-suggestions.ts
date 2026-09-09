"use client";

/**
 * Live address suggestions for an input, shared by every address box.
 *
 * Debounced, cancellable, and steady: a keystroke waits a beat before
 * asking, a newer keystroke aborts the request in flight, and the last
 * good list stays on screen until the next one lands so the menu does
 * not blink empty between letters.
 */

import * as React from "react";
import type { AddressSuggestion } from "@/lib/live/address-suggest";

export type { AddressSuggestion };

/** Short enough to feel live, long enough that a fast typist's middle
 *  letters never reach the server. */
const DEBOUNCE_MS = 220;
export const MIN_QUERY_LENGTH = 3;

export interface SuggestionsState {
  suggestions: AddressSuggestion[];
  /** A request is in flight for the current text. */
  searching: boolean;
  /** The current text was looked up and matched nothing. */
  noMatch: boolean;
}

export function useAddressSuggestions(
  query: string,
  { enabled = true }: { enabled?: boolean } = {}
): SuggestionsState {
  const [state, setState] = React.useState<SuggestionsState & { forQuery: string }>({
    suggestions: [],
    searching: false,
    noMatch: false,
    forQuery: "",
  });

  const q = query.trim();
  const active = enabled && q.length >= MIN_QUERY_LENGTH;

  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => null)) as
          | { matches?: AddressSuggestion[] }
          | null;
        if (controller.signal.aborted) return;
        const matches = Array.isArray(body?.matches) ? body.matches : [];
        setState({ suggestions: matches, searching: false, noMatch: matches.length === 0, forQuery: q });
      } catch {
        if (controller.signal.aborted) return;
        // A failed lookup is not "no such address"; keep what we had.
        setState((prev) => ({ ...prev, searching: false }));
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [q, active]);

  if (!active) return { suggestions: [], searching: false, noMatch: false };
  // Between keystrokes: the previous list, flagged as being refreshed.
  const stale = state.forQuery !== q;
  return {
    suggestions: state.suggestions,
    searching: stale,
    noMatch: !stale && state.noMatch,
  };
}

/**
 * Where a suggestion is. Most arrive with a point; a text-only one is
 * placed by a single geocode when it is picked, never before.
 */
export async function resolveSuggestionPoint(
  s: AddressSuggestion
): Promise<{ lat: number; lon: number } | null> {
  if (s.point) return s.point;
  return resolveAddressPoint(s.address);
}

/** Where a typed line is — one geocode, null when nothing matched. */
export async function resolveAddressPoint(
  address: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`/api/geocode?resolve=${encodeURIComponent(address)}`);
    const body = (await res.json().catch(() => null)) as
      | { point?: { lat: number; lon: number } | null }
      | null;
    return body?.point ?? null;
  } catch {
    return null;
  }
}
