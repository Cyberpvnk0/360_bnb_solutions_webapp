-- ArbiCore shared cache. Run in the Supabase SQL editor.
--
-- IDEMPOTENT: safe to re-run any time. Every statement is create-if-
-- not-exists, add-column-if-not-exists, or a grant that can be issued
-- twice. Re-running is the fix for most "the store cannot be written
-- to" reports, so it must never be scary to run.
--
-- One row per market: the day's feed listings and the market's measured
-- KPIs, each with its own timestamp so the writers never fight. Plus a
-- keyed table for anything that belongs to a property rather than a
-- market: estimates, resolved city ids.
--
-- SECURITY MODEL. Row level security is on with NO policies, on
-- purpose: the only key that can reach these tables is the SECRET key,
-- which lives in Vercel env and never reaches a browser. A publishable
-- key gets nothing. That is the opposite of the user tables in
-- auth-schema.sql, which are policy-guarded precisely so the browser
-- CAN touch them.
--
-- Note that RLS-with-no-policies still requires table GRANTs for the
-- role to act at all. service_role bypasses RLS but is not
-- automatically granted on tables created later, which is exactly how
-- a write can succeed and a read come back empty.

/* ------------------------------------------------------------------ */
/* One row per market                                                  */
/* ------------------------------------------------------------------ */

create table if not exists public.market_cache (
  market_slug     text primary key,
  listings        jsonb,
  listings_at     timestamptz
);

-- photo_merge / photo_merge_at once lived here: thumbnails borrowed from
-- a listing site and matched onto rows by address. Nothing writes or
-- reads them now — a listing photo is copyrighted separately from the
-- facts around it and this product holds none, which has to include
-- the ones a database collected before the rule. Dropping the columns
-- is idempotent, so re-running this file on a fresh database is a
-- no-op and re-running it on an old one is the purge.
alter table public.market_cache drop column if exists photo_merge;
alter table public.market_cache drop column if exists photo_merge_at;

-- Added after the first release. A deployment created before this
-- migration has the table without them, and a select naming a missing
-- column fails the WHOLE query — which is why the reader falls back to
-- the core columns rather than assuming.
alter table public.market_cache add column if not exists stats jsonb;
alter table public.market_cache add column if not exists stats_at timestamptz;

alter table public.market_cache enable row level security;

/* ------------------------------------------------------------------ */
/* Keyed blobs: property estimates, resolved city ids                 */
/* ------------------------------------------------------------------ */

-- Keyed by an opaque string rather than by market, because these
-- belong to a property or a lookup, not to a city. The most expensive
-- calls in the product land here, so losing this table means re-buying
-- comp sets somebody already paid for.
create table if not exists public.listing_cache (
  listing_url  text primary key,
  detail       jsonb,
  detail_at    timestamptz
);

-- The column is still called listing_url because the table's first job
-- was caching a listing page — its photos and amenities — under the
-- page's URL. That reader is gone and so must those rows be. Every key
-- the product writes today is namespaced ("estimate:…", "redfin-city:…"),
-- so anything that still starts with a scheme is a leftover from the
-- old job and nothing else. Idempotent: a second run deletes nothing.
delete from public.listing_cache where listing_url like 'http%';

alter table public.listing_cache enable row level security;

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */

-- RLS decides which ROWS a role may see; grants decide whether it may
-- touch the table at all. Both are needed, and the second one is the
-- quiet failure: Postgres answers 42501 with the exact grant to run,
-- and an app that prints its own guess over that message costs an
-- afternoon.
grant select, insert, update, delete on public.market_cache  to service_role;
grant select, insert, update, delete on public.listing_cache to service_role;

-- Explicitly nothing for the browser-facing roles. Stated rather than
-- left to the default, so a later `grant all on all tables` cannot
-- widen these by accident without somebody deleting a line that says
-- not to.
revoke all on public.market_cache  from anon, authenticated;
revoke all on public.listing_cache from anon, authenticated;
