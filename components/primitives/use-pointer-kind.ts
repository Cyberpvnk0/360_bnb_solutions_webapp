"use client";

import * as React from "react";
import { FINE_POINTER } from "@/lib/ui/pointer";

/**
 * True when this machine has a cursor that can hover.
 *
 * Subscribed rather than read once: a tablet with a keyboard case
 * attached mid-session changes the answer, and so does a phone cast to
 * a screen. useSyncExternalStore rather than an effect, so the server
 * renders the touch-safe version — the pill visible and the label
 * saying "Tap" — and a machine with a cursor upgrades on hydration.
 * The other way round would mean a phone briefly shows an affordance
 * it then hides, which is the one outcome worse than not having it.
 */
export function useFinePointer(): boolean {
  return React.useSyncExternalStore(subscribe, snapshot, () => false);
}

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(FINE_POINTER);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(FINE_POINTER).matches;
}
