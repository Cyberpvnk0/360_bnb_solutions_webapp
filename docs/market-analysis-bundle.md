# Automatic market analysis

Opening a market completes its headline figures, trailing monthly history and
forward booked-ahead figures in one client-initiated POST. Server rendering and
Next link prefetching only read the existing store. The existing chart layout,
metric controls and chart calculations are preserved.

A new complete analysis costs **3 credits**, one for each successful uncached
section. An older market pays only for missing sections; a completed fresh cache
opens free even with no remaining credits. Existing cache TTLs and monthly credit
keys remain in force. No database migration is required.

The server checks the combined cost of missing sections before calling the
provider, runs those requests concurrently, then records successful section
purchases through the existing atomic credit ledger. Failed sections cost
nothing and produce a visible error. Successful sections remain usable if another
fails. A total provider failure returns HTTP 502. Duplicate ledger keys and
insufficient balance races retain the existing spend behavior.

The client displays all returned facts immediately and refreshes server props in
the background. Loading notices appear both above the headline figures and in
empty chart headers. Requests have a finite timeout and never automatically
retry an ambiguous purchase. A user can explicitly retry missing figures.

Validation: TypeScript, full ESLint, and 1,285 tests pass, including new route and
display coverage for the three-credit total, parallel provider calls, free cached
reads, inline backfilled history, completing older markets, insufficient balance,
partial and total failures, authorization and ledger results. Production build
and deployed browser verification are recorded with the release.
