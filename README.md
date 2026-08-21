# ArbiCore

A short-term rental arbitrage analysis platform. One question drives every
screen: **does the nightly revenue beat the lease?** The hero metric
everywhere is breakeven occupancy — never a letter grade, never a score.

> The product name is a placeholder. Change `APP_NAME` in `config/app.ts`
> and the whole app follows — nothing else hardcodes it.

## Status

UI-only pass. Every feature is a fully interactive screen backed by typed,
seeded mock data. No database, no billing, no auth provider, no external
APIs. All data access is stubbed behind `lib/data/*` so real services can
drop in later without touching a component.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # calc engine unit tests (vitest)
npm run build   # production build
```

The top-right avatar menu has a **Demo: view as** switcher to preview the
product as Free / Starter / Pro / Scale — the fastest way to see the
upgrade flow (submit an address on /analyze as a Free user).

## Map of the codebase

| Path | What lives there |
| --- | --- |
| `config/app.ts` | Product name, tagline, pricing tiers — the rename file |
| `lib/calc/arbitrage.ts` | All underwriting math, documented, unit-tested |
| `lib/calc/comps.ts` | Projection assumptions derived from displayed comps |
| `lib/mock/*` | Seeded, internally consistent mock world (387 markets, 6,500+ submarkets, 30 analyses, 25 deals, 40 landlords) |
| `lib/data/*` | Async data-access stubs (swap bodies for real APIs) |
| `components/ui/*` | Vendored shadcn-style Radix components |
| `components/primitives/*` | StatCard, MetricLabel, DataTable, StatusChip, BreakevenGauge, EmptyState, … |
| `components/shell/*` | Sidebar, top bar, address search, pull counter |
| `components/providers/session-provider.tsx` | Client session state: tier, pulls, deals, landlords |
| `docs/DESIGN-CONTRACT.md` | The binding design rules for every screen |

## Consistency guarantees

- RevPAR is always computed (`revpar(adr, occ)`), never stored.
- Every revenue projection derives its ADR/occupancy from the comp rows
  rendered directly beneath it (`lib/calc/comps.ts`) — the math cannot
  contradict its evidence.
- Pipeline cards compute breakeven and cash flow through the same engine
  as the analysis screen.
- Mock data is generated with fixed seeds: identical on server and client,
  and across reloads.
