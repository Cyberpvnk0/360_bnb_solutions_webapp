/**
 * Deterministic placeholder for the property photo. Real street imagery
 * arrives with the live data integration; this keeps the slot honest —
 * an abstract roofline sketch seeded by the analysis id, never a fake
 * photograph.
 */

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
}: {
  seed: string;
  className?: string;
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
        Preview
      </span>
    </div>
  );
}
