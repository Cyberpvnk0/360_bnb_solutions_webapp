"use client";

/**
 * A property's own listing page, found by its address when the row
 * arrived without one.
 *
 * For the surfaces that show ONE property: the lookup is a billed
 * vendor request the first time an address is asked about, so it runs
 * for the property somebody is looking at, never across a grid. Pass
 * `enabled` false anywhere that is not that.
 *
 * Answers are kept for the session by address, so the same property
 * opened twice asks once, and a settled "no page" is kept too rather
 * than retried on every render. A lookup that never got through is
 * kept only until the next mount: the next open may get through.
 *
 * THE ANSWER IS DERIVED, NOT STORED — read out of the session cache
 * during render, with the effect only starting a request that is not
 * there yet. See use-listing-contact for why.
 */

import * as React from "react";
import type { Addressed } from "@/lib/live/listing-links";

export type PageStatus = "idle" | "looking" | "found" | "none";

export interface PageLookup {
  status: PageStatus;
  page: string | null;
}

interface Settled extends PageLookup {
  /** True when the lookup never got through: worth asking again on
   *  the next open, not on the next render. */
  retry: boolean;
}

const answers = new Map<string, Settled>();
const pending = new Map<string, Promise<Settled>>();

function keyFor(place: Addressed): string {
  return `${place.address}|${place.city}|${place.stateCode}`.toLowerCase();
}

const NONE: Settled = { status: "none", page: null, retry: false };
const NO_ANSWER: Settled = { status: "none", page: null, retry: true };

async function lookup(place: Addressed, key: string): Promise<Settled> {
  const running = pending.get(key);
  if (running) return running;

  const request = (async (): Promise<Settled> => {
    try {
      const query = new URLSearchParams({
        address: place.address,
        city: place.city,
        state: place.stateCode,
      });
      const res = await fetch(`/api/listing-page?${query}`);
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        page?: string | null;
        answered?: boolean;
      } | null;
      if (!res.ok || !body?.ok) return NO_ANSWER;
      if (typeof body.page === "string") {
        return { status: "found", page: body.page, retry: false };
      }
      // "No such page" is worth remembering; "never got through" is not.
      return body.answered === true ? NONE : NO_ANSWER;
    } catch {
      return NO_ANSWER;
    }
  })();
  pending.set(key, request);
  const settled = await request;
  pending.delete(key);
  answers.set(key, settled);
  return settled;
}

const IDLE: PageLookup = { status: "idle", page: null };
const LOOKING: PageLookup = { status: "looking", page: null };

export function useListingPage(place: Addressed, enabled: boolean): PageLookup {
  const key = enabled ? keyFor(place) : null;
  const [, settled] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!key) return;
    const had = answers.get(key);
    if (had && !had.retry) return;
    // A lookup that never got through last time is asked again on
    // this open, and forgotten so the link shows it is being asked.
    if (had) answers.delete(key);
    let live = true;
    void lookup(place, key).then(() => {
      if (live) settled();
    });
    return () => {
      live = false;
    };
    // The place is rebuilt each render; its key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return IDLE;
  return answers.get(key) ?? LOOKING;
}

/** Tests only. */
export function resetListingPageCache(): void {
  answers.clear();
  pending.clear();
}
