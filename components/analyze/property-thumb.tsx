"use client";

/**
 * The analyzer's property image, and the sketch it falls back to.
 *
 * CurbShot draws whatever imagery the server can get for the property's
 * own coordinates — a Street View kerb shot where Google is working, an
 * aerial otherwise — and says which, from the stage whose image actually
 * loaded rather than from what the deployment has keys for. PropertyThumb
 * is the honest placeholder for everything else: an abstract roofline
 * seeded by the analysis id, never a fake photograph.
 *
 * Never the listing's own photo. A listing cannot carry one — the type
 * has no field for it — because a photo is copyrighted separately from
 * the facts around it and this product holds no licence to show one.
 * The card links to the listing's page and lets the source do the
 * showing.
 *
 * A point is required, not optional-with-a-default. The market's centre
 * is several miles from most properties, and a picture of city hall
 * captioned with somebody's address is worse than no picture at all.
 */

import * as React from "react";
import {
  firstStage,
  imagerySources,
  nextStage,
  propertyImageSrc,
  STAGE_LABEL,
  type ImagerySources,
  type ImageryStage,
} from "@/lib/live/property-imagery";
import { cn } from "@/lib/utils";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function PropertyThumb({
  seed,
  className,
  label = "Preview",
}: {
  seed: string;
  className?: string;
  /** Corner tag. "Preview" for seeded data; a real listing with no
   *  imagery for its coordinate says "No imagery" — what is missing is
   *  the kerb shot, and a card never claims to know about photos. */
  label?: string;
}) {
  const h = hash(seed);
  // Three gable peaks with seeded heights and offsets.
  const p1 = 34 + (h % 14); // 34–47
  const p2 = 22 + ((h >> 4) % 12); // 22–33 (tallest)
  const p3 = 38 + ((h >> 8) % 10); // 38–47
  const x2 = 62 + ((h >> 12) % 10);

  return (
    <div
      role="img"
      aria-label="Street photo placeholder"
      className={cn(
        "relative flex items-end justify-center overflow-hidden rounded-sm border border-border bg-secondary/60",
        className
      )}
    >
      <svg viewBox="0 0 168 116" className="block h-full w-full" aria-hidden>
        {/* Ground line */}
        <line x1="0" y1="96" x2="168" y2="96" stroke="var(--border)" strokeWidth="1" />
        {/* Back house */}
        <path
          d={`M14 96 V${p1 + 18} L44 ${p1} L74 ${p1 + 18} V96`}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1.5"
        />
        {/* Front house — the gold accent */}
        <path
          d={`M${x2 - 26} 96 V${p2 + 26} L${x2 + 6} ${p2} L${x2 + 38} ${p2 + 26} V96`}
          fill="color-mix(in srgb, var(--gold-fill) 6%, transparent)"
          stroke="var(--gold)"
          strokeWidth="1.5"
        />
        {/* Door */}
        <rect
          x={x2 - 2}
          y={78}
          width={12}
          height={18}
          fill="none"
          stroke="var(--gold)"
          strokeWidth="1.25"
        />
        {/* Side house */}
        <path
          d={`M118 96 V${p3 + 14} L140 ${p3} L162 ${p3 + 14} V96`}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1.5"
        />
      </svg>
      <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </span>
    </div>
  );
}

export function CurbShot({
  seed,
  point,
  alt,
  className,
  /** Above the fold. Loads eagerly and asks the browser to hurry — the
   *  analyzer's one picture is; a grid of cards passes false and lets
   *  the browser pace them. */
  priority = true,
  /** What the sketch says when the chain runs out. */
  sketchLabel = "No imagery",
}: {
  /** Seeds the sketch when there is no imagery. */
  seed: string;
  /** The PROPERTY's coordinates. Null falls straight through to the
   *  sketch rather than guessing at the market's centre. */
  point: { lat: number; lon: number } | null;
  alt: string;
  className?: string;
  priority?: boolean;
  sketchLabel?: string;
}) {
  const lat = point?.lat;
  const lon = point?.lon;
  const [sources, setSources] = React.useState<ImagerySources | null>(null);
  // Null until the deployment has said what it can draw; then the best
  // stage it has, walking down on each 404 until the sketch.
  const [stage, setStage] = React.useState<ImageryStage | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  // A new property in the same slot starts its own chain from the top.
  const slot = `${seed}:${lat}:${lon}`;
  const [lastSlot, setLastSlot] = React.useState(slot);
  if (slot !== lastSlot) {
    setLastSlot(slot);
    setStage(sources ? firstStage(sources) : null);
    setLoaded(false);
  }

  React.useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    let cancelled = false;
    imagerySources().then((got) => {
      if (cancelled) return;
      setSources(got);
      setStage((current) => current ?? firstStage(got));
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  if (!point || stage === "sketch") {
    return <PropertyThumb seed={seed} className={className} label={sketchLabel} />;
  }

  const src =
    stage === null ? null : propertyImageSrc(point.lat, point.lon, stage);

  return (
    <div className={cn("relative overflow-hidden rounded-sm bg-secondary/60", className)}>
      {/* Served by our own route so the key stays on the server;
          next/image would add a second hop for no benefit. */}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          // Off the main thread, so a batch of images arriving together
          // can't stutter the scroll while they decode.
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() =>
            setStage((current) =>
              current && current !== "sketch" && sources
                ? nextStage(current, sources)
                : "sketch"
            )
          }
          className={cn(
            "size-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      ) : null}
      {/* Said out loud: this is the kerb or the roof, not the listing's
          own photos — and WHICH. Written from the stage whose image
          loaded, so a roof is never labelled "Street View". */}
      {loaded && stage ? (
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] uppercase tracking-[0.14em] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          {STAGE_LABEL[stage]}
        </span>
      ) : null}
    </div>
  );
}
