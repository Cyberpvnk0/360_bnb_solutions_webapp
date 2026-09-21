# Redfin furnished search fallback

Boston's structured rental search fails even though other cities work. The
fallback uses ScraperAPI's generic endpoint for the exact same furnished URL:

`https://www.redfin.com/city/1826/MA/Boston/rentals/filter/is-furnished`

Live measurements on 2026-09-21:

- Both `/apartments-for-rent/filter/is-furnished` and `/rentals/filter/is-furnished`
  returned HTTP 200 on the generic premium endpoint.
- The measured charge was **20 credits** per successful generic page read.
- The final adapter pass returned **237 furnished listings in 9.4 seconds**:
  one structured attempt, one generic request, no geocoding requests.
- The original three structured attempts delayed the working fallback to
  49.5 seconds. Furnished searches now reserve time for fallback: a 20-second
  structured opening deadline and a 27-second generic deadline, under the
  route's 50-second budget. Other structured callers keep their retry ladder.

After support reported a price-format parser fix, a fresh structured-only
retest at **2026-09-21 15:18 UTC** still returned HTTP 500 and the same
upstream-failure wording for all four paths: `/rentals`,
`/apartments-for-rent`, and each with `/filter/is-furnished`. All completed
with HTTP responses rather than local timeouts. The fallback therefore
remains necessary for these requests; it automatically stays unused when
the structured parser starts returning successful results.

## Measured schema

The operator-only diagnostic is:

`/api/redfin?market=boston&pageShape=1&path=rentals`

It always uses a furnished URL. `path=apartments-for-rent` (the default) and
`tier=standard|premium|ultra` are supported. It reports keys, types, counts,
and request metadata, never listing values. It decodes JSON response strings
and handles literal dotted keys rather than mistaking them for nested paths.

The page's `root.__reactServerState.InitialContext` assignment contains
`["ReactServerAgent.cache"].dataCache`. Entries keyed by
`/stingray/api/v1/search/rentals?...` carry a JSON string at `res.text` with
`homes`, `numMatchedHomes`, and `numMatchedUnits`.

The parser requires the cached request to have `isRentals=true`,
`is_furnished=true`, and the requested city's `region_id` and `region_type=6`.
It prefers individual homes over the duplicate `consolidateBuildings=true`
response and deduplicates listing URLs. It reads these measured fields:

| Page field | Existing mapper input |
| --- | --- |
| `homeData.addressInfo.formattedStreetLine` | `address` |
| `homeData.addressInfo.city`, `.state`, `.zip` | `city`, `state`, `zip` |
| `homeData.addressInfo.centroid.centroid.latitude`, `.longitude` | `latitude`, `longitude` |
| `homeData.url` | `url` |
| `rentalExtension.rentPriceRange.min` | `price` |
| `rentalExtension.bedRange.min` | `beds` |
| `rentalExtension.bathRange.min` | `baths` |
| `rentalExtension.sqftRange.min` | `sqFt` |

Numeric property-type enums remain unknown rather than being guessed. No
descriptions, photos, contact details, or amenity prose enter the mapped rows.
Furnished status comes only from the source search filter.

## Failure and cache behavior

Successful structured searches do not invoke the generic endpoint. Furnished
city searches fall back after the opening structured failure; auth, credits,
and quota failures do not cause a second billed path. The fallback does not
change unfiltered or property-type searches.

An unrecognized payload, a mismatched city/filter, all unusable rows, or a
generic failure is an error. Prior domain success is insufficient to call an
ambiguous generic failure empty. Explicit missing pages retain the existing
bare-city safeguards. A recognized filtered payload with both an empty
`homes` array and zero `numMatchedHomes` can legitimately return none.

The generic document is local and fetched with `cache: no-store`. Only mapped
listing facts enter the existing `furnishedKey` / `readFurnished` /
`writeFurnished` store, with its unchanged seven-day TTL. Failed results are
neither stored nor charged to the successful-search meter.

One generic page currently embeds up to 350 homes. If `numMatchedHomes`
exceeds the embedded row count, the adapter sets `morePages=true`; it does
not invent pagination URLs or claim the search is complete.
