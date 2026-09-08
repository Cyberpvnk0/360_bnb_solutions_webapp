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

/* ------------------------------------------------------------------ */
/* Top-up credits: analyses bought outright, spent after the plan      */
/* ------------------------------------------------------------------ */

/* A BALANCE THE ACCOUNT CAN SEE AND NEVER TOUCH. Same posture as
   usage: readable under RLS so the header can show it, written only
   through the functions below with the secret key. Pack credits do not
   expire, so this is per account rather than per period. */
create table if not exists public.credit_balance (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  balance     integer not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now()
);

/* Every change to a balance, with what caused it. A grant carries the
   payment reference; a spend carries the analysis key. This is the
   audit trail a "where did my credits go" email is answered from. */
create table if not exists public.credit_ledger (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  delta       integer not null,
  reason      text not null,          -- 'pack:p25' | 'spend' | 'refund' | 'adjust'
  ref         text,                   -- payment id, analysis key, note
  created_at  timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
/* A payment reference grants once. A webhook retried by the processor
   must not hand out the pack twice. */
create unique index if not exists credit_ledger_grant_ref_idx
  on public.credit_ledger (ref) where reason like 'pack:%';

alter table public.credit_balance enable row level security;
alter table public.credit_ledger  enable row level security;

drop policy if exists "own balance" on public.credit_balance;
create policy "own balance" on public.credit_balance
  for select using (auth.uid() = user_id);
drop policy if exists "own ledger" on public.credit_ledger;
create policy "own ledger" on public.credit_ledger
  for select using (auth.uid() = user_id);

grant select on public.credit_balance, public.credit_ledger to authenticated;
revoke insert, update, delete on public.credit_balance, public.credit_ledger from authenticated, anon;
grant select, insert, update, delete on public.credit_balance, public.credit_ledger to service_role;

/* Add credits from a purchase. Idempotent on the payment reference:
   the second call with the same ref returns the balance and grants
   nothing. Server only. */
create or replace function public.grant_credits(
  p_user   uuid,
  p_amount integer,
  p_reason text,
  p_ref    text
)
returns table (balance integer, granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'grant_credits: amount must be positive';
  end if;

  insert into public.credit_balance (user_id) values (p_user)
  on conflict (user_id) do nothing;

  -- The partial unique index refuses a repeated grant ref; catch it and
  -- report the balance unchanged rather than failing the caller.
  begin
    insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user, p_amount, p_reason, p_ref);
  exception when unique_violation then
    select b.balance into v_balance from public.credit_balance b where b.user_id = p_user;
    return query select v_balance, false;
    return;
  end;

  update public.credit_balance
     set balance = credit_balance.balance + p_amount, updated_at = now()
   where user_id = p_user
  returning credit_balance.balance into v_balance;

  return query select v_balance, true;
end;
$$;

revoke execute on function public.grant_credits(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text)
  to service_role;

/* Atomically claim one key against a cap — and, for analyses, against
   the account's pack balance once the cap is spent.

   One statement, one row lock, so two tabs firing "Run the numbers" at
   the same instant cannot both squeeze in as the eleventh of ten. The
   cap is a PARAMETER rather than a column: the plan's limits live in
   the app's config beside its prices, and this function only ever runs
   with the secret key, so a caller cannot pass a cap it is not owed.

   ORDER OF SPEND: the plan first, then packs. The plan is the credit
   already paid for; a pack is the dearer one and goes second. A key
   already in the set is always allowed and never charged again — a
   reload is not a second purchase, from either pot.

   Returns where the account stands after the call: whether the key got
   in, how many distinct keys this period, the cap, which pot paid
   ('plan', 'pack', 'cached', or 'none'), and the pack balance left. */
drop function if exists public.consume_usage(uuid, text, text, text, integer);
create or replace function public.consume_usage(
  p_user   uuid,
  p_period text,
  p_kind   text,      -- 'analysis' | 'market'
  p_key    text,
  p_cap    integer
)
returns table (allowed boolean, used integer, cap integer, source text, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys    text[];
  v_balance integer := 0;
begin
  if p_kind not in ('analysis', 'market') then
    raise exception 'consume_usage: unknown kind %', p_kind;
  end if;

  insert into public.usage (user_id, period)
  values (p_user, p_period)
  on conflict (user_id, period) do nothing;

  -- Lock the usage row for the rest of this transaction.
  select case when p_kind = 'analysis' then analysis_keys else market_slugs end
    into v_keys
    from public.usage
   where user_id = p_user and period = p_period
   for update;

  if p_kind = 'analysis' then
    select coalesce(b.balance, 0) into v_balance
      from public.credit_balance b where b.user_id = p_user;
  end if;

  if p_key = any (v_keys) then
    return query select true, cardinality(v_keys), p_cap, 'cached'::text, v_balance;
    return;
  end if;

  if cardinality(v_keys) < p_cap then
    v_keys := array_append(v_keys, p_key);
    if p_kind = 'analysis' then
      update public.usage set analysis_keys = v_keys, updated_at = now()
       where user_id = p_user and period = p_period;
    else
      update public.usage set market_slugs = v_keys, updated_at = now()
       where user_id = p_user and period = p_period;
    end if;
    return query select true, cardinality(v_keys), p_cap, 'plan'::text, v_balance;
    return;
  end if;

  -- The plan is spent. An analysis may draw on a pack; a market may not.
  if p_kind = 'analysis' and v_balance > 0 then
    -- Lock and spend the balance; the check constraint refuses negative.
    update public.credit_balance
       set balance = credit_balance.balance - 1, updated_at = now()
     where user_id = p_user and credit_balance.balance > 0
    returning credit_balance.balance into v_balance;
    if found then
      insert into public.credit_ledger (user_id, delta, reason, ref)
      values (p_user, -1, 'spend', p_key);
      v_keys := array_append(v_keys, p_key);
      update public.usage set analysis_keys = v_keys, updated_at = now()
       where user_id = p_user and period = p_period;
      return query select true, cardinality(v_keys), p_cap, 'pack'::text, v_balance;
      return;
    end if;
  end if;

  return query select false, cardinality(v_keys), p_cap, 'none'::text, v_balance;
end;
$$;

/* Server only. The browser's role can read usage; it must never be able
   to spend it, and certainly not with a cap of its own choosing. */
revoke execute on function public.consume_usage(uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text, text, text, integer)
  to service_role;

/* ------------------------------------------------------------------ */
/* The profile is not the browser's to write                           */
/* ------------------------------------------------------------------ */

/* The "own profile" policy was `for all` and the grants above hand
   `authenticated` table-level UPDATE, INSERT and DELETE on profiles — so
   an account could write tier = 'scale' from devtools and every server
   meter, reading the same row, would believe it. A column-level revoke
   does NOT close that: PostgreSQL ignores column revokes while the
   table-level privilege stands. So the table-level privileges go, and
   the policy narrows to reading. Nothing in the app writes a profile
   from the browser: the signup trigger inserts (security definer), and
   the server writes the tier with the secret key (service_role), which
   none of this touches. */
revoke insert, update, delete on public.profiles from authenticated, anon;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

/* ------------------------------------------------------------------ */
/* Every account on the whole product                                  */
/* ------------------------------------------------------------------ */

/* The beta: registering and confirming an email is the whole of getting
   in, and what you get is the largest plan — every feature, the biggest
   caps, still metered. New profiles take the column default (the signup
   trigger does not name a tier); accounts made before this ran are
   moved up too. config/app DEFAULT_TIER says the same thing on the
   server side, and the two are meant to change together. */
alter table public.profiles alter column tier set default 'scale';
/* Only accounts nobody has ever re-planned: the signup trigger stamps
   created_at and updated_at in one statement, and setTier is the only
   thing that moves updated_at. So this reaches the accounts that
   predate the default and leaves alone any account somebody put on a
   plan on purpose — which is what lets this file stay safe to re-run. */
update public.profiles
   set tier = 'scale'
 where tier = 'free'
   and updated_at = created_at;

/* ------------------------------------------------------------------ */
/* Saved rental lists                                                  */
/* ------------------------------------------------------------------ */

/* Deal Finder's lists used to live in localStorage — one browser, one
   device, gone with the profile. They are the account's now, like its
   deals and landlords. A list is a name; an item is the rental as it
   stood when it was saved (a jsonb snapshot), because the live feed
   rolls daily and a saved address must still show its rent and size a
   month later. One row per rental per list. */
create table if not exists public.deal_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deal_list_items (
  list_id    uuid not null references public.deal_lists (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  listing_id text not null,
  listing    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (list_id, listing_id)
);

alter table public.deal_lists      enable row level security;
alter table public.deal_list_items enable row level security;

drop policy if exists "own lists" on public.deal_lists;
create policy "own lists" on public.deal_lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own list items" on public.deal_list_items;
create policy "own list items" on public.deal_list_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete
  on public.deal_lists, public.deal_list_items
  to authenticated, service_role;

create index if not exists deal_lists_user_idx      on public.deal_lists (user_id, created_at);
create index if not exists deal_list_items_user_idx on public.deal_list_items (user_id, list_id);
