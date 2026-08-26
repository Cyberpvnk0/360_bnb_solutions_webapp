-- ArbiCore market store. Run once in the Supabase SQL editor.
--
-- One row per market: the day's feed listings and the day's photo
-- merge, each with its own timestamp so the two writers never fight.
-- Payloads are the exact JSON the API routes already serve — the store
-- is a durable copy of work, not a second schema to keep in step.
--
-- Row level security is enabled with NO policies on purpose: the only
-- key that can read or write is the service role key, which lives in
-- Vercel env and never reaches a browser. The anon key has no access
-- at all, so there is nothing to lock down client-side later.

create table if not exists market_cache (
  market_slug     text primary key,
  listings        jsonb,
  listings_at     timestamptz,
  photo_merge     jsonb,
  photo_merge_at  timestamptz
);

alter table market_cache enable row level security;
