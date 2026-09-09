"use client";

/**
 * The Deal Finder while a market's furnished rentals are being read.
 *
 * The first Furnished search of a market reads every rental listed
 * there, live, which takes half a minute — long enough that a grid of
 * grey placeholder cards read as a page that had hung. This takes the
 * results pane for that wait: the market named, a ring whose arc
 * sweeps, one line crossfading through what is happening, a clock
 * that visibly runs, and a plain note on why it takes as long as it
 * does and that it is saved after.
 *
 * THE CLOCK IS THE ONLY MEASURED THING HERE and the only one that
 * moves on its own; the bar sweeps rather than fills, because there is
 * no measured progress to draw and a bar that filled on a timer would
 * be a fiction that happened to end when the page did.
 */

import * as React from "react";

/** What is happening, in the order it happens. */
const PHRASES = [
  "Reading every rental listed there",
  "Keeping only the ones that come furnished",
  "Placing them on the map",
] as const;

function SweepRing() {
  return (
    <div className="relative flex size-[104px] items-center justify-center">
      <span
        aria-hidden
        className="working-glow absolute inset-3 rounded-full bg-select/25 blur-xl"
      />
      <svg viewBox="0 0 48 48" className="working-ring relative size-14" aria-hidden>
        <circle className="track" cx="24" cy="24" r="20" />
        <circle className="arc" cx="24" cy="24" r="20" />
      </svg>
    </div>
  );
}

/** Seconds since this wait began, as m:ss, ticking. */
function Elapsed() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(t);
  }, []);
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return (
    <span className="tabular" aria-label={`${seconds} seconds elapsed`}>
      {m}:{s}
    </span>
  );
}

export function FurnishedSearching({ market }: { market: string }) {
  return (
    <div
      role="status"
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center"
    >
      <SweepRing />
      <p className="metric-label mt-2">Furnished search</p>
      <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-foreground md:text-3xl">
        Finding furnished rentals in {market}
      </h2>
      <div className="working-phrases relative mt-2 h-5 w-full max-w-sm text-sm text-muted-foreground">
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
      <div className="working-bar mt-6 w-full max-w-xs" aria-hidden />
      <p className="mt-3 text-xs text-muted-foreground">
        <Elapsed /> elapsed
      </p>
      <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted-foreground">
        The first furnished search of a market reads all of its listings,
        which takes about half a minute. It is saved after that, so the
        next look is quick.
      </p>
    </div>
  );
}
