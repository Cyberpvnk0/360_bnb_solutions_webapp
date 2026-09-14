-- Support tickets: the conversation between a member and the team.
--
-- Run once in the Supabase SQL editor, alongside auth-schema.sql. Safe
-- to re-run: every statement is guarded.
--
-- SECURITY MODEL — DELIBERATELY UNLIKE THE OTHER USER TABLES.
--
-- deals, landlords and listing_alerts carry RLS policies keyed on
-- auth.uid(), so the browser's publishable key reaches exactly one
-- person's rows and the app talks to the store directly. That cannot
-- work here, because a ticket has TWO audiences: the member who opened
-- it, and the staff who answer it. Who counts as staff is decided by
-- the ADMIN_EMAILS environment variable, which Postgres has never
-- heard of and cannot be told without a second copy of the answer that
-- would drift from the first.
--
-- So these tables work the way the cache tables work: RLS ON, NO
-- POLICIES. Nothing holding the publishable key can read a row, write
-- a row, or learn that a row exists. Every read and every write goes
-- through /api/support/*, where lib/auth/gate decides — once, in one
-- place — whether this caller is the ticket's owner, a member of
-- staff, or neither.
--
-- The practical consequence: a ticket's contents are exactly as
-- private as the service key, and adding a policy here would widen
-- that. Don't add one.

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  -- The short code a person reads out loud: "ticket 7KP4R2". Generated
  -- in the application (lib/support/ticket) from an alphabet with no
  -- confusable characters, because it gets retyped from a screenshot.
  ref text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The member's address and name AS THEY WERE when the ticket opened.
  -- Copied rather than joined: the staff list has to render without
  -- reaching into auth.users, and a ticket should still say who raised
  -- it after the account is closed.
  user_email text,
  user_name text,
  subject text not null,
  category text not null default 'other',
  status text not null default 'open',
  priority text not null default 'normal',
  -- Denormalised so the list renders from one round trip. Kept true by
  -- the writers in lib/support/store; nothing else writes these.
  message_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  last_message_role text not null default 'user',
  -- Whose turn it is to look. Set when the other side writes, cleared
  -- when this side opens the thread.
  unread_for_user boolean not null default false,
  unread_for_staff boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint support_tickets_status_check
    check (status in ('open', 'pending', 'resolved', 'closed')),
  constraint support_tickets_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_category_check
    check (category in ('billing', 'credits', 'data', 'bug', 'account', 'other')),
  constraint support_tickets_last_role_check
    check (last_message_role in ('user', 'staff', 'system')),
  constraint support_tickets_subject_length
    check (char_length(subject) between 1 and 160)
);

alter table public.support_tickets enable row level security;

-- Said explicitly, because the danger here is a policy arriving later
-- by habit: these tables are reachable only by the secret key.
drop policy if exists "own support tickets" on public.support_tickets;

-- The member's own list, newest activity first.
create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, last_message_at desc);

-- The staff queue: everything still live, oldest waiting first.
create index if not exists support_tickets_queue_idx
  on public.support_tickets (status, last_message_at desc);

create index if not exists support_tickets_ref_idx
  on public.support_tickets (ref);

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  -- Null once the author's account is gone; author_role and
  -- author_name still say who was speaking, so a thread stays readable.
  author_id uuid references auth.users (id) on delete set null,
  author_role text not null,
  author_name text,
  body text not null,
  -- A staff note the member never sees. The API strips these from
  -- every response that is not going to staff; this column is the
  -- record of intent, not the enforcement.
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint support_messages_role_check
    check (author_role in ('user', 'staff', 'system')),
  constraint support_messages_body_length
    check (char_length(body) between 1 and 8000),
  -- Only staff write notes. A member's message is never internal, and
  -- a system line never is either — both would be invisible to the one
  -- person who needs to read them.
  constraint support_messages_internal_is_staff
    check (internal = false or author_role = 'staff')
);

alter table public.support_messages enable row level security;

drop policy if exists "own support messages" on public.support_messages;

create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);
