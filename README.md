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

### Live rentals (RentCast)

Copy `.env.example` to `.env.local` and set `RENTCAST_API_KEY`. With the
key present, searching a single market in Deal Finder's Location filter
(e.g. "Jacksonville") swaps that market's preview inventory for today's
actual active rentals — a gold **Live** chip shows the fetch time.
Without a key, or when the feed is unreachable, the same search shows the
seeded preview with an honest **Preview inventory** chip.

The key stays server-side (`app/api/rentals` holds it; the browser never
sees it) and responses cache for 24 hours per market, so the free
50-requests/month tier comfortably covers daily browsing of a handful of
markets — one request per market per day, shared by every user.

A daily cap (`LIVE_SEARCH_DAILY_CAP`, default 50) bounds the bill: the
first search of a market or ZIP each day spends a slot, repeats ride the
cache for free, and failed requests spend nothing. Past the cap, new
areas fall back to preview inventory and say so; the count resets at
midnight UTC. The ledger lives in server memory, so with several
instances warm the true ceiling is a small multiple of the cap — move it
to a shared store (Vercel KV) if you need it exact.

#### Does this feed carry descriptions? (field probe)

`GET /api/rentals?market=jacksonville&shape=1` reports the field names
and value types RentCast actually ships — never their values — plus a
plain verdict on whether anything in the payload can answer "is this
unit furnished".

It reads the RAW vendor rows and unions every field across ALL of them.
Both details are load-bearing: describing our mapped row would only echo
back our own field names and could never reveal a field the mapper
ignores, and JSON feeds omit null fields per row, so a description
carried by one listing in fifty is invisible in `rows[0]`. Either
shortcut answers the question with a confident false no.

Read `proseFields` (free text long enough to mine) and `amenityFields`
(named like amenity data, whatever its length). Both empty means the
Furnished filter cannot work on live rows and correctly disables itself.
The probe shares the feed's Data-Cache entry, so probing a market already
searched today costs no extra vendor request, and it never spends a
daily-cap slot.

### Furnished rentals (Redfin, via ScraperAPI)

Turning on **Furnished** with a market searched swaps the result set for
Redfin's own furnished-filtered search, reached through ScraperAPI's
Redfin structured endpoint. The toolbar says **Furnished · via Redfin**
so a student always knows which inventory they're looking at.

**Why this and not description mining.** Redfin ships a Furnished filter
in its own search, so every row that comes back is furnished because
*Redfin* says so. The earlier approach — scrape a listing page, mine the
word out of the prose — was tried against Zillow and measured: the
standard tier was served an anti-bot interstitial on 8 of 8 addresses,
and mining those block screens tagged three listings "Pet friendly" and
"Renovated" off the site's own SEO footer. A filter answered at the
source beats a guess about a paragraph, and it costs one request per
market instead of one per property.

`REDFIN_MAX_PAGES` (default 4) bounds it: Redfin paginates at ~41 rows
and hands back next-page links, so a Jacksonville furnished search is
three pages, ~84 listings, about 30 credits, cached a day and shared by
every user.

Redfin's search rows carry no coordinates, so addresses are geocoded —
US Census first (free, keyless, US-only), Google only as a fallback and
only when that key already exists, cached 30 days. A listing that can't
be placed is dropped rather than pinned at the city centre.

#### City ids

Redfin keys cities by an opaque number in the URL path that can't be
derived from a name, so a market has to be matched to one before it can
be searched. Seeded ids in `REDFIN_CITY_ID` are used first; anything
else resolves once against Redfin's own location autocomplete and is
then cached for a year.

Resolution is **verified, not fuzzy**. Jacksonville FL, Jacksonville NC
and Jackson MS are one loose match apart, so a candidate is accepted
only when the city name matches whole (seeing through "St."/"Saint" and
hyphens) *and* the state appears as its own token — "MI" must not match
"Miami". No confident match means no search: the filter says "Couldn't
identify this city on Redfin", rows stay unfiltered, and each card is
marked "Amenities not listed". Showing another metro's rentals under
this market's name would be far worse than showing none.

`GET /api/redfin?market=<slug>&resolve=1` reports the id a market
resolves to and the URL it produces. Open that URL, confirm it's the
right city, and paste the pair into `REDFIN_CITY_ID` so the lookup never
runs again.

#### The description miner (kept, not wired)

`/api/enrich` and `lib/live/scraperapi` still exist and are still
tested — a page-level description reader with boilerplate rejection,
address-matched two-hop, and tier escalation. Nothing in the UI calls it
any more: it never got past Zillow's bot defence, and Redfin answers the
question it was built for. Keep it for a target that isn't defended, or
delete it; either way it costs nothing while nothing calls it.

### Live STR comps (AirROI)

Set `AIRROI_API_KEY` and the analyzer swaps its seeded comp set for live
short-term rentals near the address — which moves every derived figure
on the page, since ADR, occupancy, the revenue range and breakeven all
come from that one array. The header says which set is on screen
("Live comps" vs "Preview comps"), and the page falls back to seeded
comps whenever the feed is missing, capped, unreachable, or returns
fewer than four nearby rentals (too thin to underwrite on).

AirROI bills per call, so comps cache for a day, market analytics for a
week, and both share the `LIVE_SEARCH_DAILY_CAP` ledger with the rental
feed. Failed calls spend nothing.

**Pinning the field names:** the mapper accepts several plausible
spellings per figure because the payload shape hasn't been observed
yet. With a real key set, `GET /api/str?lat=30.33&lon=-81.66&shape=comps`
returns the vendor's own key names (types only, no listing data) — use
it to lock `pick*()` in `lib/live/airroi.ts` to reality, then delete the
unused aliases and their tests.

### Property imagery and "View photos"

Listing cards and the property panel show the address, never the
listing's own photos. In order: Google Street View of the kerb when
`GOOGLE_MAPS_API_KEY` is set and Google has imagery there; an aerial
from Mapbox (`MAPBOX_TOKEN`) when it does not; the seeded sketch,
tagged for what it is, when neither is available. The card's corner
tag says which one is on screen. Both images proxy through
`/api/property-image` so no key reaches the browser; Street View is
probed against Google's free metadata endpoint before any billed image
request, and each address is cached for 30 days. Preview inventory
shows no imagery at all — those addresses are invented, and dressing
them in a picture of a real building would be a lie.

The listing's photos stay where they were published. Every real row
carries a "View photos" link — to the listing's own page when the
furnished search hands us its URL, otherwise to a Zillow address search
— and nothing in this codebase fetches, stores, matches or renders
those images. A listing photo is copyrighted separately from the facts
around it (VHT v. Zillow put a price on each one), so the guarantee is
structural: `RentalListing` has no field that could hold a picture.
The only thing the furnished search takes from its source is whether
the unit is furnished, plus the facts the same search row carries.

## Map of the codebase

| Path | What lives there |
| --- | --- |
| `config/app.ts` | Product name, tagline, pricing tiers — the rename file |
| `lib/calc/arbitrage.ts` | All underwriting math, documented, unit-tested |
| `lib/calc/comps.ts` | Projection assumptions derived from displayed comps |
| `lib/mock/*` | Seeded, internally consistent mock world (409 markets, 6,900+ submarkets, 30 analyses, 25 deals, 40 landlords) |
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
