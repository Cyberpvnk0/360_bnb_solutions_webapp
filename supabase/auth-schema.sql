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

/* Added after the first cut. `create table if not exists` does nothing
   to an existing table, so new columns need saying explicitly — and
   this file has to stay safe to re-run, because it will be. */
alter table public.landlords
  add column if not exists units_controlled integer not null default 0,
  add column if not exists allows_str text not null default 'unknown',
  add column if not exists last_contacted timestamptz;

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

/* ------------------------------------------------------------------ */
/* Monthly usage: what each account has spent of its plan             */
/* ------------------------------------------------------------------ */

/* THE SERVER OWNS THIS TABLE. The old meter was `profiles.pulls_used`,
   a column the browser could write under the "own profile" policy —
   which meant anybody could zero their own count from devtools, and it
   never reset, so a January pull counted against August. Every
   analysis costs real money at the data vendor, so the count has to be
   one the account cannot edit and the month has to be part of the key.

   Distinct SETS, not counters. An analysis is keyed by the property
   and its size, a market by its slug, and the cap applies to how many
   DISTINCT ones the account has touched this period. Reloading the
   same analysis, or opening a market twice, is one against the plan
   rather than two — the second look costs the vendor nothing and it
   would be a poor trade to charge the plan for it. */
create table if not exists public.usage (
  user_id        uuid not null references auth.users (id) on delete cascade,
  period         text not null,                       -- 'YYYY-MM'
  analysis_keys  text[] not null default '{}',
  market_slugs   text[] not null default '{}',
  updated_at     timestamptz not null default now(),
  primary key (user_id, period)
);

alter table public.usage enable row level security;

/* Read your own, so the meter in the header is the truth. Never write:
   there is deliberately no insert/update policy, and the grant below
   matches. Writes come through consume_usage with the secret key. */
drop policy if exists "own usage" on public.usage;
create policy "own usage" on public.usage
  for select using (auth.uid() = user_id);

grant select on public.usage to authenticated;
revoke insert, update, delete on public.usage from authenticated, anon;
grant select, insert, update, delete on public.usage to service_role;

/* Atomically claim one key against a cap, and report where that leaves
   the account.

   One statement, one row lock, so two tabs firing "Run the numbers" at
   the same instant cannot both squeeze in as the eleventh of ten. The
   cap is a PARAMETER rather than a column: the plan's limits live in
   the app's config beside its prices, and this function only ever runs
   with the secret key, so a caller cannot pass a cap it is not owed.

   Returns the count AFTER the call and whether the key got in. A key
   already in the set is always allowed and never counted twice — a
   reload is not a second purchase. */
create or replace function public.consume_usage(
  p_user   uuid,
  p_period text,
  p_kind   text,      -- 'analysis' | 'market'
  p_key    text,
  p_cap    integer
)
returns table (allowed boolean, used integer, cap integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys text[];
begin
  if p_kind not in ('analysis', 'market') then
    raise exception 'consume_usage: unknown kind %', p_kind;
  end if;

  insert into public.usage (user_id, period)
  values (p_user, p_period)
  on conflict (user_id, period) do nothing;

  -- Lock the row for the rest of this transaction.
  select case when p_kind = 'analysis' then analysis_keys else market_slugs end
    into v_keys
    from public.usage
   where user_id = p_user and period = p_period
   for update;

  if p_key = any (v_keys) then
    return query select true, cardinality(v_keys), p_cap;
    return;
  end if;

  if cardinality(v_keys) >= p_cap then
    return query select false, cardinality(v_keys), p_cap;
    return;
  end if;

  v_keys := array_append(v_keys, p_key);

  if p_kind = 'analysis' then
    update public.usage
       set analysis_keys = v_keys, updated_at = now()
     where user_id = p_user and period = p_period;
  else
    update public.usage
       set market_slugs = v_keys, updated_at = now()
     where user_id = p_user and period = p_period;
  end if;

  return query select true, cardinality(v_keys), p_cap;
end;
$$;

/* Server only. The browser's role can read usage; it must never be able
   to spend it, and certainly not with a cap of its own choosing. */
revoke execute on function public.consume_usage(uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text, text, text, integer)
  to service_role;
