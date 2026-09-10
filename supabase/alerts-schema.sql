-- New-listing alerts and the browser push subscriptions that carry them.
-- Run once in the Supabase SQL editor. Both tables belong to the account
-- that made them: the browser writes them with the publishable key under
-- these policies, and the daily run reads every row with the secret key.

create table if not exists public.listing_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Where to watch: one of the two.
  market_slug text,
  zip text,
  -- "Jacksonville, FL" or "ZIP 33604", as the Deal Finder printed it.
  label text not null,
  -- The address the mail goes to, as it was when the alert was set.
  email text,
  -- What a new rental must be: lib/alerts/criteria.
  criteria jsonb not null default '{}'::jsonb,
  wants_email boolean not null default true,
  wants_push boolean not null default false,
  -- Every listing id in the area at the last run: a rental is "new"
  -- when it was not among them.
  seen_ids text[] not null default '{}',
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  constraint listing_alerts_scope check (market_slug is not null or zip is not null)
);

alter table public.listing_alerts enable row level security;

drop policy if exists "own listing alerts" on public.listing_alerts;
create policy "own listing alerts" on public.listing_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists listing_alerts_user_idx on public.listing_alerts (user_id);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  -- { "p256dh": "...", "auth": "..." }, as the browser hands them over.
  keys jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
