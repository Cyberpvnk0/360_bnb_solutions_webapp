# Navigation performance — September 2026

Catalogue reads no longer simulate network latency. The async data interfaces
and returned catalogue data are unchanged; the 60–600 ms timers are gone.

MapLibre loads in separate client chunks for Deal Finder, Markets, and the
analysis comps map. Loading placeholders reserve the existing map dimensions.
Viewport filtering lives in `lib/map/viewport.ts` so using it does not pull the
WebGL renderer back into the initial page bundle. The maps themselves, styles,
camera behavior, and interactions are unchanged.

Markets prefetches the selected row's route after 150 ms of interest. Moving to
another row cancels the pending timer. Server rendering only reads stored data; it does
not buy a measurement. The purchase still starts from the mounted client page.

## First-time market analysis

- The route loading boundary says “Opening market”.
- An unmeasured market shows an indeterminate “Analyzing” notice explaining the
  provider wait. It does not invent a completion percentage or delay results.
- The successful POST response contains the stats and timestamp. These render
  immediately; the background route refresh no longer gates their display.
- The detail component is keyed by market, keeping purchase state scoped to that
  market when navigating between detail pages.
- Failed requests and insufficient credits leave the loading state. Requests
  have a 35-second client deadline against the route's 30-second server limit,
  and are never retried automatically. An ambiguous failure does not claim that
  nothing was charged.
- Pricing, authorization, storage, and server credit accounting are unchanged.

## Build measurements

Measured with the same local production build setup (`next build` / `next start`),
using the initial script tags in the HTML. Gzip sizes are calculated locally,
not observed transfer sizes. These are initial bundles, not all code eventually
loaded: visible maps still download their separate renderer chunk.

| Route | Initial JS before | Initial JS after | Reduction |
| --- | ---: | ---: | ---: |
| Deal Finder | 2,280,230 bytes | ~1,326,400 bytes | 42% |
| Markets | 2,085,353 bytes | ~1,132,700 bytes | 46% |

Deal Finder initial gzip estimate fell from 655 KB to 406 KB. Markets fell from
593 KB to 344 KB. Other measured routes' initial script sizes were effectively
unchanged. Neither optimized route includes the MapLibre engine in its initial
script tags.

Three warm local Deal Finder HTML requests took 438/461/450 ms before and
117/92/110 ms after. The removed 350 ms catalogue timer explains that difference.
These timings exclude live Supabase/provider latency and are not a production
latency guarantee. The local environment does not contain the production auth
configuration, so signed-in behavior is verified separately in the browser.

Validation: TypeScript, ESLint, 1,269 tests, and a production build. Added coverage
checks immediate display of purchased stats before refreshed props, loading and
failure states, no automatic purchase retries, and viewport boundary behavior.
