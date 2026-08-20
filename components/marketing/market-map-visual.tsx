import { MetricLabel } from "@/components/primitives/metric-label";

/**
 * A hand-built SVG suggestion of the market explorer's split view:
 * dark map with gold (spread clears) and muted-red (doesn't) dots on the
 * left, the ranked-spread list abstracted as bars on the right.
 * Pure SVG, theme tokens only — flips with light mode automatically.
 */
export function MarketMapVisual({ className }: { className?: string }) {
  const goldDots: Array<[number, number, number]> = [
    [58, 74, 4.5],
    [96, 132, 3],
    [142, 96, 5.5],
    [188, 152, 3.5],
    [120, 196, 4],
    [226, 108, 3],
    [252, 176, 5],
    [286, 84, 3.5],
    [206, 232, 3],
    [300, 214, 4],
    [76, 246, 3],
    [318, 148, 2.5],
  ];
  const redDots: Array<[number, number, number]> = [
    [168, 58, 3],
    [262, 250, 3.5],
    [40, 168, 2.5],
  ];
  const rows: Array<{ label: number; bar: number }> = [
    { label: 44, bar: 112 },
    { label: 56, bar: 94 },
    { label: 38, bar: 80 },
    { label: 50, bar: 62 },
    { label: 42, bar: 46 },
  ];

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <MetricLabel>Market explorer</MetricLabel>
          <MetricLabel>Ranked by spread</MetricLabel>
        </div>
        <svg
          viewBox="0 0 560 300"
          role="img"
          aria-label="Split map of covered markets beside a list ranked by spread"
          className="block h-auto w-full"
        >
          {/* Map side */}
          <rect x="0" y="0" width="360" height="300" fill="var(--map-water)" />
          <path
            d="M-10 66 C 60 34, 128 58, 176 42 C 224 26, 268 52, 316 44 L 372 40 L 372 128 C 322 142, 296 118, 252 138 C 208 158, 232 196, 190 210 C 148 224, 116 190, 82 212 C 52 231, 40 268, 6 262 L -10 258 Z"
            fill="var(--map-land)"
            stroke="var(--map-stroke)"
            strokeWidth="1"
          />
          <path
            d="M232 310 C 244 268, 292 262, 322 276 C 348 288, 366 284, 372 278 L 372 310 Z"
            fill="var(--map-land)"
            stroke="var(--map-stroke)"
            strokeWidth="1"
          />
          <path
            d="M28 296 C 44 278, 84 274, 104 288 C 118 298, 130 302, 138 310 L 20 310 Z"
            fill="var(--map-land)"
            stroke="var(--map-stroke)"
            strokeWidth="1"
          />
          {goldDots.map(([cx, cy, r], i) => (
            <circle key={`g${i}`} cx={cx} cy={cy} r={r} fill="var(--gold)" opacity={0.9} />
          ))}
          {redDots.map(([cx, cy, r], i) => (
            <circle key={`r${i}`} cx={cx} cy={cy} r={r} fill="var(--red-muted)" opacity={0.9} />
          ))}
          {/* Highlighted market: thin gold ring */}
          <circle cx="142" cy="96" r="11" fill="none" stroke="var(--gold)" strokeWidth="1" opacity="0.55" />

          {/* Split hairline */}
          <line x1="360" y1="0" x2="360" y2="300" stroke="var(--border)" strokeWidth="1" />

          {/* Ranked list side */}
          <rect x="360" y="0" width="200" height="300" fill="var(--surface)" />
          {rows.map((row, i) => {
            const y = 38 + i * 52;
            return (
              <g key={i}>
                <rect x="384" y={y} width={row.label} height="5" rx="1" fill="var(--border)" />
                <rect x="384" y={y + 14} width={row.bar} height="5" rx="1" fill="var(--gold)" opacity={0.9} />
                {i > 0 ? (
                  <line x1="384" y1={y - 14} x2="536" y2={y - 14} stroke="var(--border)" strokeWidth="1" />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
