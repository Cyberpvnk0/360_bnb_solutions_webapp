-- ArbiCore user data.
--
-- Everything a student saves lived in localStorage: lose the browser,
-- lose the work; open a phone, be a different person. These tables give
-- each account one home for its own data.
--
-- SECURITY MODEL. Row-level security with policies keyed on auth.uid(),
-- so the publishable key that reaches the browser can only ever touch
-- the signed-in user's rows. That is what makes it safe to ship. The
-- caching tables (market_cache, listing_cache) work the opposite way —
-- RLS on, NO policies, reachable only by the secret key server-side —
-- because they hold shared data no user owns.

/* ------------------------------------------------------------------ */
/* Profile: one row per account                                        */
/* ------------------------------------------------------------------ */

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  tier        text not null default 'free',
  -- Analyses used. Each costs real money at the data vendor, so the
  -- ceiling is per account rather than per browser, where clearing
  -- cookies reset it.
  pulls_used  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

/* A profile the moment an account exists, so nothing has to cope with
   a signed-in user who has no row yet. */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ------------------------------------------------------------------ */
/* Saved deals                                                         */
/* ------------------------------------------------------------------ */

create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  analysis_id text not null,
  address     text not null,
  city        text,
  state_code  text,
  market_slug text,
  stage       text not null default 'prospecting',
  -- The whole analysis and the inputs behind it, so a saved deal can be
  -- reopened exactly as it was rather than re-derived from figures that
  -- have since moved.
  snapshot    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, analysis_id)
);

alter table public.deals enable row level security;

drop policy if exists "own deals" on public.deals;
create policy "own deals" on public.deals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists deals_user_idx on public.deals (user_id, updated_at desc);

/* ------------------------------------------------------------------ */
/* Landlords                                                           */
/* ------------------------------------------------------------------ */

create table if not exists public.landlords (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  company    text,
  phone      text,
  email      text,
  notes      text,
  deal_ids   text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.landlords enable row level security;

drop policy if exists "own landlords" on public.landlords;
create policy "own landlords" on public.landlords
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists landlords_user_idx on public.landlords (user_id, updated_at desc);

/* ------------------------------------------------------------------ */
/* Watched markets                                                     */
/* ------------------------------------------------------------------ */

create table if not exists public.watched_markets (
  user_id     uuid not null references auth.users (id) on delete cascade,
  market_slug text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, market_slug)
);

alter table public.watched_markets enable row level security;

drop policy if exists "own watched markets" on public.watched_markets;
create policy "own watched markets" on public.watched_markets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  title      text not null,
  detail     text,
  href       text,
  created_at timestamptz not null default now()
);

alter table public.activity enable row level security;

drop policy if exists "own activity" on public.activity;
create policy "own activity" on public.activity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists activity_user_idx on public.activity (user_id, created_at desc);

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */
-- RLS decides which ROWS a role may touch; grants decide whether it may
-- touch the table at all. Missing grants are a second, invisible gate,
-- and one already cost a batch of paid API calls on this project when a
-- write failed silently against a table nobody had granted.

grant select, insert, update, delete
  on public.profiles, public.deals, public.landlords,
     public.watched_markets, public.activity
  to authenticated, service_role;
