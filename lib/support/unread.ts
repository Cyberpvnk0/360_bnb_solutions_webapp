"use client";

/**
 * The unread count, held once per page rather than once per component.
 *
 * The rail and the mobile sheet both render the Support link and both
 * mount at the same time. Two copies of a hook with an effect would
 * mean two requests for the same number on every navigation; a module
 * store subscribed to with useSyncExternalStore means one, shared, and
 * no setState inside an effect body — the cascading-render pattern this
 * codebase already had to unpick twice.
 *
 * It is a badge. Every failure here is a zero: never a toast, never an
 * error state, never a reason for a page not to render.
 */

import { useSyncExternalStore } from "react";

let count = 0;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const notify of listeners) notify();
}

/** Ask the server again — after opening a thread, or sending a reply. */
export async function refreshUnread(): Promise<void> {
  try {
    const res = await fetch("/api/support/unread", { cache: "no-store" });
    const data = (await res.json()) as { unread?: number };
    const next = typeof data?.unread === "number" ? Math.max(0, data.unread) : 0;
    if (next === count) return;
    count = next;
    emit();
  } catch {
    // Leave whatever was last known. A network blip should not clear a
    // badge that is still true.
  }
}

/** Drop the count locally, so a dot disappears the moment its thread is
 *  opened rather than on the next round trip. */
export function clearOneUnread(): void {
  if (count === 0) return;
  count -= 1;
  emit();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // The first subscriber starts the one fetch; later ones join it.
  if (!started) {
    started = true;
    void refreshUnread();
  }
  return () => {
    listeners.delete(notify);
  };
}

const snapshot = () => count;
// The server has no session in this component and must render the same
// thing the client renders first: no badge.
const serverSnapshot = () => 0;

export function useSupportUnread(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
