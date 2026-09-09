"use client";

/**
 * What the result page shows while the numbers are being run.
 *
 * Buying the comps for an address takes a few seconds, and a page of
 * grey blocks for those seconds read as "broken" more than "working".
 * This is the same hero card the result draws, with the property named
 * and one live element in it: a ring whose arc sweeps around while one
 * line of copy crossfades through what the page is doing.
 *
 * INDETERMINATE, DELIBERATELY. The work has no measured progress to
 * report — the comps arrive all at once or not at all — and a bar that
 * filled up on a timer would be a fiction that happened to end when
 * the page did. The ring says "working"; the copy says on what; neither
 * claims to know how far along it is.
 *
 * Everything below the card keeps the result's exact layout in
 * skeletons, so nothing shifts when the numbers land.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

/** What the page is doing, in the order it does it. */
const PHRASES = [
  "Finding short-term rentals nearby",
  "Reading their nightly rates and occupancy",
  "Running the numbers on this lease",
] as const;

/** The sweeping ring, with a soft breathing glow behind it. */
function AnalyzingRing() {
  return (
    <div className="relative flex size-[104px] shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="working-glow absolute inset-3 rounded-full bg-select/25 blur-xl"
      />
      <svg
        viewBox="0 0 48 48"
        className="working-ring relative size-14"
        aria-hidden
      >
        <circle className="track" cx="24" cy="24" r="20" />
        <circle className="arc" cx="24" cy="24" r="20" />
      </svg>
    </div>
  );
}

/** The one line of copy, crossfading through the phrases in CSS. */
function AnalyzingPhrases() {
  return (
    <div
      className="working-phrases relative mt-2 h-5 text-sm text-muted-foreground"
    >
      {PHRASES.map((phrase, i) => (
        <span
          key={phrase}
          className="working-phrase absolute inset-0 truncate"
          style={{ "--i": i } as React.CSSProperties}
        >
          {phrase}
        </span>
      ))}
    </div>
  );
}

function AnalyzingHero({
  address,
  place,
}: {
  address: string | null;
  place: string | null;
}) {
  return (
    <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
      <AnalyzingRing />
      <div className="min-w-0 flex-1">
        <p className="metric-label">Analyzing</p>
        <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {address ?? "This property"}
        </h1>
        {place ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{place}</p>
        ) : null}
        <AnalyzingPhrases />
      </div>
      <div className="flex shrink-0 gap-2">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}

/**
 * The hero with the property named, read off the URL the result is
 * about to render — the same parameters the page itself reads, so the
 * name here is the name there. A stored analysis carries no address in
 * its URL and gets the unnamed version.
 */
function AddressedHero() {
  const sp = useSearchParams();
  const address = sp.get("a")?.trim() || null;
  const city = sp.get("c")?.trim() || null;
  const state = sp.get("s")?.trim() || null;
  const place = city ? `${city}${state ? `, ${state}` : ""}` : null;
  return <AnalyzingHero address={address} place={place} />;
}

export function AnalyzingScreen() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      {/* Hero card */}
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        {/* URL hooks may suspend during prerendering; the unnamed hero
            stands in for the instant that takes. */}
        <React.Suspense fallback={<AnalyzingHero address={null} place={null} />}>
          <AddressedHero />
        </React.Suspense>
        <div className="overflow-hidden border-t border-border">
          <div className="flex min-w-max items-stretch divide-x divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-6 py-5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-2 h-8 w-28" />
                <Skeleton className="mt-1.5 h-3 w-36" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border px-6 py-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-[88px] w-full" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
      </div>

      {/* Calculator + projection */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>

      {/* Comps explorer + lease evidence */}
      <div className="mt-14 space-y-14 pb-14">
        <div>
          <Skeleton className="h-12 w-full" />
          <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,42%)]">
            <Skeleton className="h-96" />
            <Skeleton className="h-[480px] w-full xl:h-[640px]" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
