# Design contract

Every screen in this product follows these rules. They are not suggestions.

## Voice

Plain investor language: rent, cash flow, occupancy, payback. Never
technical jargon. Direct investor-to-investor copy. No exclamation points.
No emoji. Never letter grades or 0–100 scores — the hero metric is always
**breakeven occupancy**.

## Palette

Defined as CSS variables in `app/globals.css`. **No other hues anywhere.**
Never green, never blue, never teal.

| Token / Tailwind class | Meaning |
| --- | --- |
| `bg-background` (= `--ink`) | page canvas |
| `bg-card` / `bg-surface` (= `--surface`) | cards |
| `bg-secondary` / `bg-surface-2` | raised / hover surfaces |
| `border-border` | 1px hairlines (the only border) |
| `text-foreground` | primary text |
| `text-muted-foreground` | secondary text |
| `bg-primary text-primary-foreground` / `text-brand` (= `--red`) | **brand + primary CTAs only** |
| `text-neg` / `border-neg` / `bg-neg/10` (= `--red-muted`) | negative signal, **always paired with an icon** |
| `text-gold` / `border-gold` (= `--gold`) | positive signal, key metrics, active state |
| `text-gold-bright` (= `--gold-bright`) | highlights, focus rings |
| `bg-gold-fill/…` (= `--gold-fill`) | gold chip/wash fills (stays warm in light mode) |

Color semantics — resolve the red conflict deliberately:
- **Gold = good deal / favorable movement.**
- **Muted red + icon = bad deal / unfavorable.** (`StatusChip tone="neg"` and
  `DeltaIndicator` already do this.)
- **Full-saturation `--red` is reserved for brand and primary action buttons.**
  Never use it as a data/signal color. One sanctioned exception, by product
  spec: the map's **actively selected pin** is brand red with the animated
  gold ring — selection is a brand state, not a deal-quality signal, and the
  ring + enlarged radius carry the meaning redundantly.

## Typography

- UI chrome, labels, nav, tables: Inter Tight (`font-sans`, default).
- Large display figures and page titles: Fraunces (`font-display` utility).
- Financial figures: `tabular` utility (tabular numerals + tracking).
- Metric labels: `metric-label` utility (11px, uppercase, wide tracking, muted)
  or the `MetricLabel` component.

## Craft rules

- 1px hairline borders (`border-border`); **never drop shadows**.
- 8px grid. Generous whitespace around key numbers; tight density in tables.
- Transitions 150ms (`duration-150`). Numbers animate with `AnimatedNumber`
  (200ms count-up).
- Active state = thin gold underline or left rule (`active-rule` utility,
  gold-bordered tabs are built into `TabsTrigger`).
- `rounded-sm` corners everywhere; `rounded-full` ONLY for `StatusChip`.
- No gradients except: `hero-radial` (dashboard hero only) and the 8% gold
  fill under the primary area chart (`CHART.areaFill` / `areaFillOpacity`).
- Every screen has a real empty state (`EmptyState`) and a skeleton loading
  state (`loading.tsx` route file mirroring the real layout; nothing shifts
  when data lands).
- Focus rings are gold and visible (global `:focus-visible` handles it —
  don't suppress outlines).
- Test at 1440 / 1024 / 390. Tables scroll inside `overflow-x-auto`.

## Layout

- Standard page container: `mx-auto max-w-6xl px-4 py-6 md:px-8`
  (markets split view is full-bleed instead; the /analyze entry form uses a
  narrow `max-w-3xl` column by design — it is a single-task form).
- Stat header rows: `StatHeader` + `StatCard` (hairline dividers built in).
- Comps/evidence always visible beneath projections — never behind a click.

## Shared primitives (import paths)

```tsx
import { MetricLabel } from "@/components/primitives/metric-label";
import { AnimatedNumber } from "@/components/primitives/animated-number"; // {value, format?, durationMs?}
import { DeltaIndicator } from "@/components/primitives/delta-indicator"; // {value, label, invert?}
import { StatCard, StatHeader } from "@/components/primitives/stat-card"; // {label, value, sub?, serif?}
import { StatusChip } from "@/components/primitives/status-chip"; // tone: gold|neutral|neg|outline
import { EmptyState } from "@/components/primitives/empty-state"; // {icon, title, description?, action?}
import { PageHeader } from "@/components/primitives/page-header"; // {title, description?, actions?}
import { BreakevenGauge } from "@/components/primitives/breakeven-gauge"; // {breakeven, marketOccupancy, size?, strokeWidth?, children}
import { DataTable } from "@/components/primitives/data-table"; // typed columns, sorting, skeleton + empty built in
```

Charts (Recharts): use `components/charts/kit.tsx` — `CHART` colors,
`AXIS_PROPS`, `GRID_PROPS`, `makeTooltip`, `ChartLegend`, `ChartTooltipCard`.
Gold primary series, grey comparison series (dash it when it's a line),
tabular 11px muted axis labels, hairline grid, no vertical gridlines, no
soft gradient fills. One y-axis per chart, always.

## Data + session

Components import data ONLY from `@/lib/data` (async, mock-backed, has
latency so skeletons show). Types from `@/lib/mock/types`. Math ONLY from
`@/lib/calc/arbitrage` and `@/lib/calc/comps` — never re-derive formulas
inline. RevPAR = `revpar(adr, occ)`; comp annual revenue =
`annualRevenueFromAdr(adr, occ)`.

Client session state (tier, pulls, deals, landlords, upgrade modal):

```tsx
import { useSession } from "@/components/providers/session-provider";
// { ready, user, tier, pullsUsed, pullLimit, pullsRemaining, canPull,
//   deals, landlords, activity, watchedMarketSlugs,
//   consumePull(), saveDeal(analysis), isAnalysisSaved(id),
//   moveDeal(id, stage), updateDeal(id, patch),
//   addLandlord(data), updateLandlord(id, patch), linkLandlordToDeal(llId, dealId),
//   toggleWatchMarket(slug), setTier(id), upgradeTo(id),
//   upgrade, openUpgrade({reason?, analysis?}), closeUpgrade() }
```

Formatting: `@/lib/format` — `fmtMoney`, `fmtMoneyCents`, `fmtPct`,
`fmtNum`, `fmtDeltaPts`, `fmtDeltaMoney`, `fmtDeltaPct`, `fmtDate`,
`fmtMonth`, `fmtMiles`, `fmtMonths`. Fractions in, formatted strings out.

Product name and pricing come from `@/config/app` (`APP_NAME`, `TIERS`,
`TIER_ORDER`, …). Never hardcode the name or a price.

## Pricing display rules

Anything unlimited is explicitly labeled **Unlimited** in the UI. Annual
billing shows the effective monthly price large with "/mo", "billed
annually at $X" muted below, a gold "2 months free" chip, and the yearly
savings. Pro is the recommended tier (gold border, "Most popular"). Use
`components/pricing/pricing-cards.tsx`.
