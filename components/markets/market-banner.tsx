/**
 * Deterministic banner art for a market card — the photo slot without the
 * photo. Four terrain motifs drawn in hairlines with one gold accent,
 * seeded by slug so every market looks like itself on every load.
 */

import type { MarketTerrain } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const W = 320;
const H = 96;

function Metro({ seed }: { seed: number }) {
  const towers = Array.from({ length: 9 }, (_, i) => {
    const th = 22 + ((seed >>> (i * 3)) % 42);
    const tw = 22 + ((seed >>> (i * 2)) % 12);
    return { x: 8 + i * 34, y: H - th, w: tw, h: th };
  });
  const lit = seed % towers.length;
  return (
    <>
      {towers.map((t, i) => (
        <rect
          key={i}
          x={t.x}
          y={t.y}
          width={t.w}
          height={t.h}
          fill={i === lit ? "color-mix(in srgb, var(--gold-fill) 14%, transparent)" : "color-mix(in srgb, var(--border) 55%, transparent)"}
          stroke={i === lit ? "var(--gold)" : "var(--border)"}
          strokeWidth="1"
        />
      ))}
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--border)" />
    </>
  );
}

function Coastal({ seed }: { seed: number }) {
  const sunX = 44 + (seed % 150);
  return (
    <>
      <circle
        cx={sunX}
        cy={40}
        r={14}
        fill="color-mix(in srgb, var(--gold-fill) 18%, transparent)"
        stroke="var(--gold)"
        strokeWidth="1"
      />
      <line x1="0" y1="58" x2={W} y2="58" stroke="var(--border)" strokeWidth="1.25" />
      <path
        d={`M0 74 Q 26 68 52 74 T 104 74 T 156 74 T 208 74 T 260 74 T 312 74 T 364 74`}
        fill="none"
        stroke="var(--border)"
        strokeWidth="1"
      />
      <path
        d={`M0 86 Q 30 80 60 86 T 120 86 T 180 86 T 240 86 T 300 86 T 360 86`}
        fill="none"
        stroke="color-mix(in srgb, var(--border) 70%, transparent)"
        strokeWidth="1"
      />
    </>
  );
}

function Mountain({ seed }: { seed: number }) {
  const p1 = 30 + (seed % 14);
  const p2 = 16 + ((seed >>> 4) % 12);
  return (
    <>
      <path
        d={`M-10 ${H} L70 ${p1 + 18} L150 ${H}`}
        fill="color-mix(in srgb, var(--border) 40%, transparent)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      <path
        d={`M90 ${H} L200 ${p2} L310 ${H}`}
        fill="color-mix(in srgb, var(--border) 55%, transparent)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      {/* Gold summit light */}
      <path d={`M186 ${p2 + 26} L200 ${p2} L214 ${p2 + 26}`} fill="none" stroke="var(--gold)" strokeWidth="1.25" />
      <path
        d={`M230 ${H} L300 ${p1} L370 ${H}`}
        fill="color-mix(in srgb, var(--border) 45%, transparent)"
        stroke="var(--border)"
        strokeWidth="1"
      />
    </>
  );
}

function Desert({ seed }: { seed: number }) {
  const sunX = 40 + (seed % 120);
  return (
    <>
      <circle
        cx={sunX}
        cy={30}
        r={12}
        fill="color-mix(in srgb, var(--gold-fill) 18%, transparent)"
        stroke="var(--gold)"
        strokeWidth="1"
      />
      {/* Mesas */}
      <path
        d={`M-8 ${H} L20 56 L96 56 L120 ${H}`}
        fill="color-mix(in srgb, var(--border) 45%, transparent)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      <path
        d={`M132 ${H} L150 68 L206 68 L222 ${H}`}
        fill="color-mix(in srgb, var(--border) 35%, transparent)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      <line x1="0" y1={H - 10} x2={W} y2={H - 10} stroke="color-mix(in srgb, var(--border) 60%, transparent)" strokeWidth="1" />
    </>
  );
}

export const TERRAIN_LABEL: Record<MarketTerrain, string> = {
  metro: "Metro",
  coastal: "Coastal",
  mountain: "Mountain town",
  desert: "Desert",
};

export function MarketBanner({
  slug,
  terrain,
  className,
}: {
  slug: string;
  terrain: MarketTerrain;
  className?: string;
}) {
  const seed = hash(slug);
  return (
    <div
      aria-hidden
      className={cn("overflow-hidden bg-secondary/50", className)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMax slice"
        className="block h-full w-full"
      >
        {terrain === "metro" ? <Metro seed={seed} /> : null}
        {terrain === "coastal" ? <Coastal seed={seed} /> : null}
        {terrain === "mountain" ? <Mountain seed={seed} /> : null}
        {terrain === "desert" ? <Desert seed={seed} /> : null}
      </svg>
    </div>
  );
}
