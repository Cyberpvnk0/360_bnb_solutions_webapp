"use client";

/**
 * The analyzer's property image, and the sketch it falls back to.
 *
 * CurbShot draws whatever imagery the server can get for the property's
 * own coordinates — a Street View kerb shot where Google is working, an
 * aerial otherwise — and says which. PropertyThumb is the honest
 * placeholder for everything else: an abstract roofline seeded by the
 * analysis id, never a fake photograph.
 *
 * A point is required, not optional-with-a-default. The market's centre
 * is several miles from most properties, and a picture of city hall
 * captioned with somebody's address is worse than no picture at all.
 */

import * as React from "react";
import {
  imagerySources,
  propertyImageSrc,
  type ImagerySources,
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
  /** Corner tag. "Preview" for seeded data; live listings pass
   *  "No photo" — the listing is real, only the image is pending. */
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
}: {
  /** Seeds the sketch when there is no imagery. */
  seed: string;
  /** The PROPERTY's coordinates. Null falls straight through to the
   *  sketch rather than guessing at the market's centre. */
  point: { lat: number; lon: number } | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const [sources, setSources] = React.useState<ImagerySources | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!point) return;
    let cancelled = false;
    imagerySources().then((got) => {
      if (!cancelled) setSources(got);
    });
    return () => {
      cancelled = true;
    };
  }, [point]);

  const nothingToDraw = sources !== null && !sources.street && !sources.aerial;
  if (!point || failed || nothingToDraw) {
    return <PropertyThumb seed={seed} className={className} label="No photo" />;
  }

  return (
    <div className={cn("relative overflow-hidden rounded-sm bg-secondary/60", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by
          our own route so the key stays on the server; next/image would
          add a second hop for no benefit. */}
      <img
        src={propertyImageSrc(point.lat, point.lon)}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "size-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
      {/* Said out loud: this is the kerb or the roof, not the listing's
          own photos — and WHICH, because a roof labelled "Street View"
          makes somebody think the kerb shot is broken. */}
      {sources ? (
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] uppercase tracking-[0.14em] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          {sources.street ? "Street View" : "Aerial"}
        </span>
      ) : null}
    </div>
  );
}
