-- Glass Pitch — v2 premium migration (extends 0001_init_schema.sql ->
-- 0002_harden_function_search_path.sql -> 0003_harden_db.sql). Must apply
-- cleanly, in order, on a FRESH database (0001 -> 0002 -> 0003 -> 0004) and on
-- the already-provisioned live project.
--
-- ARCHITECTURE.md §0/§5 (2026-07-03 v2 amendment): the Stripe webhook route
-- handler (server-only, signature-verified) is the ONE sanctioned writer of
-- billing/account data, using the service-role client. The scheduled jobs
-- remain the ONLY writer of football data and NEVER touch these tables; the
-- web app's read-only role (anon/authenticated) never writes ANY table.
--
-- §4/§7 (premium scope): premium gates DEPTH CONTENT ONLY. The full prediction
-- set and the complete scored ledger stay free forever -- `predictions.tier`
-- is NOT the gating mechanism and this migration does not touch `predictions`
-- at all. Premium data lives ONLY in the new `fixture_insights` table, which
-- is never joined into anything anon-readable.
--
-- This migration adds four tables:
--   profiles          -- one row per Supabase Auth user (age attestation +
--                        marketing opt-in only; zero anon access; owner
--                        select/update; row auto-created by a SECURITY
--                        DEFINER trigger on auth.users, the standard Supabase
--                        "handle_new_user" pattern).
--   subscriptions     -- Stripe subscription state per user; owner SELECT own
--                        row(s) only; NO authenticated write policy at all --
--                        writes are exclusively the webhook handler's
--                        service-role client. Zero anon access.
--   stripe_events     -- webhook idempotency ledger (Stripe event id as PK).
--                        service-role only; zero anon/authenticated access,
--                        not even SELECT.
--   fixture_insights  -- premium depth content (curated /predictions detail +
--                        post-match stats), written once by the jobs
--                        (service role) per (fixture_id, kind), same
--                        fetch-once discipline as `predictions` (§8). Readable
--                        ONLY by an authenticated user with an active
--                        subscription, via the `public.is_premium()` helper.
--                        Zero anon access.
--
-- Grants mirror 0003(a)'s deny-by-default posture, but go a step further:
-- 0003 revoked DML privileges from anon/authenticated on football tables
-- while deliberately KEEPING their SELECT grant (those tables are meant to be
-- publicly readable). These four tables are the opposite case -- anon gets
-- ZERO access to any of them, and authenticated gets only the exact, narrow
-- grants listed below. 0003's `ALTER DEFAULT PRIVILEGES` only revoked
-- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from the default ACL, not
-- SELECT -- so a fresh Supabase project's stock default ACL would still
-- auto-grant SELECT to anon/authenticated on any table created here. Nothing
-- is left to that default: every grant below is explicit.

-- ============================================================================
-- Tables
-- ============================================================================

-- profiles --------------------------------------------------------------
create table public.profiles (
  id               uuid        primary key references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  is_18_plus       boolean     not null default false,  -- age attestation (§13)
  marketing_opt_in boolean     not null default false
);

comment on table public.profiles is
  'One row per Supabase Auth user (ARCHITECTURE.md v2 §7). Age attestation + marketing opt-in only -- no other personal data (§13). Auto-created by public.handle_new_user() on auth.users signup (see trigger below); the owner may SELECT/UPDATE their own row over the publishable-key client (RLS-gated), never anyone else''s. Zero anon access.';
comment on column public.profiles.is_18_plus is
  'Self-attested age confirmation (§13 responsible-gambling guardrail) -- not a verified age check.';

-- subscriptions -----------------------------------------------------------
create table public.subscriptions (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references public.profiles (id) on delete cascade,
  stripe_customer_id     text        not null unique,
  stripe_subscription_id text        unique,
  status                 text        not null
                           check (status in (
                             'trialing', 'active', 'past_due', 'canceled',
                             'incomplete', 'incomplete_expired', 'unpaid', 'paused'
                           )),
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.subscriptions is
  'Stripe subscription state per user (ARCHITECTURE.md v2 §5/§7). Written EXCLUSIVELY by the Stripe webhook route handler''s service-role client (idempotent via stripe_events) -- there is deliberately NO authenticated INSERT/UPDATE/DELETE policy anywhere in this migration. The owner may SELECT their own row(s) only (e.g. to render "manage billing" / link to the Stripe Customer Portal). Zero anon access. One row per Stripe customer (stripe_customer_id UNIQUE) -- a re-subscribe after cancelling updates the same row rather than inserting a second one.';

create index idx_subscriptions_user on public.subscriptions (user_id);

-- stripe_events ---------------------------------------------------------------
create table public.stripe_events (
  id          text        primary key,  -- the Stripe event id (evt_...) -- the idempotency key
  type        text        not null,
  received_at timestamptz not null default now(),
  payload     jsonb
);

comment on table public.stripe_events is
  'Webhook idempotency ledger (ARCHITECTURE.md v2 §5): the webhook route handler inserts one row per processed Stripe event id BEFORE acting on it (INSERT fails on a UNIQUE/PK violation for a re-delivered event, so the handler no-ops instead of double-applying it). Purely operational -- service-role only, zero anon/authenticated access, not even SELECT (mirrors job_runs'' posture in migration 0003).';

-- fixture_insights --------------------------------------------------------------
create table public.fixture_insights (
  fixture_id bigint      not null references public.fixtures (id) on delete cascade,
  kind       text        not null check (kind in ('prediction_detail', 'post_match_stats')),
  payload    jsonb       not null,
  source     text        not null default 'api-football',
  fetched_at timestamptz not null default now(),
  primary key (fixture_id, kind)
);

comment on table public.fixture_insights is
  'Premium depth content (ARCHITECTURE.md v2 §4/§7): a curated subset of the /predictions payload (kind=''prediction_detail'', written by jobs/fetch_predictions.py in the SAME run as the ledger row -- never a second fetch) and post-match stats (kind=''post_match_stats'', written by the new jobs/fetch_insights.py). Same fetch-once-and-cache discipline as the predictions ledger (§8) -- one row per (fixture_id, kind), never re-fetched once present. This table is NEVER the gating mechanism and NEVER duplicates ledger data: the full prediction set and the complete scored ledger stay free forever in `public.predictions` (§4). Readable only by an authenticated user with an active subscription (public.is_premium()); zero anon access; writes are service-role (jobs) only.';

create index idx_fixture_insights_kind on public.fixture_insights (kind, fixture_id);

-- ============================================================================
-- Functions
-- ============================================================================

-- handle_new_user(): the standard Supabase "auto-provision a profile row on
-- signup" pattern. SECURITY DEFINER (owner-privileged) because the trigger
-- fires as part of the auth.users INSERT, executed by Supabase's own auth
-- service role -- NOT by the new user's session -- so it needs to bypass
-- profiles' RLS to insert the bootstrap row. search_path pinned EMPTY and
-- every reference schema-qualified (pg_catalog is always implicitly
-- searched, per 0002's rationale, so `new.id` / the INSERT below need no
-- further qualification). `on conflict do nothing` makes it idempotent if the
-- trigger is ever re-fired for the same user (defensive; mirrors this repo's
-- "every write is idempotent" convention).
--
-- Why a trigger rather than an "owner can INSERT own row" RLS policy: a
-- trigger guarantees there is NEVER a window where an authenticated user
-- exists but has no profiles row (subscriptions.user_id FKs to profiles, and
-- is_premium()/paywall checks assume the row exists the moment a session is
-- authenticated) -- with an owner-insert policy that guarantee would depend
-- on the client remembering to call it, immediately, every time, with no
-- retry gap. It also removes an entire class of "insert a row for an id that
-- isn't mine" attack surface that an owner-insert policy would otherwise need
-- a `with check` clause to close. EXECUTE is revoked from PUBLIC/anon/
-- authenticated below so the function can't be invoked directly outside the
-- trigger it's attached to.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_premium(uid): the single source of truth for "does this user currently
-- have paid access", used by fixture_insights' SELECT policy. SECURITY
-- INVOKER (deliberately NOT DEFINER): it runs with the CALLING role's own
-- privileges, so its internal query against public.subscriptions is subject
-- to that role's OWN "owner can view own subscriptions" RLS policy. Called
-- the only way it's ever used here -- is_premium((select auth.uid())) -- the
-- invoking role is always checking its OWN row, which its own RLS policy
-- already permits it to see, so no DEFINER bypass is needed. This also means
-- calling it with any uid OTHER than one's own auth.uid() can never leak
-- another user's subscription status: RLS filters that row out before
-- is_premium ever sees it, so the function safely (and correctly) reports
-- false rather than needing a privileged short-circuit. search_path pinned
-- EMPTY; `public.subscriptions` is schema-qualified and `now()` resolves via
-- the always-implicit pg_catalog (see 0002).
create or replace function public.is_premium(uid uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

comment on function public.is_premium(uuid) is
  'True if uid has an active/trialing subscription that has not passed current_period_end. SECURITY INVOKER by design -- see the definition comment above this migration''s "Functions" section.';

revoke execute on function public.is_premium(uuid) from public, anon;
grant execute on function public.is_premium(uuid) to authenticated, service_role;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Keep subscriptions.updated_at fresh on every update, reusing the same
-- function 0001 defined for fixtures (hardened with an empty search_path by
-- 0002) -- no redefinition needed, just another trigger pointed at it.
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- anon gets ZERO access to all four tables -- there are no `to anon` policies
-- anywhere below, and the grants section revokes anon's default SELECT
-- outright. authenticated gets only the narrow, owner-scoped reads (and, for
-- profiles, an owner-scoped update) listed here; every USING clause wraps
-- auth.uid() in a scalar subquery per Supabase's RLS performance guidance
-- (evaluated once per statement, not re-evaluated per row).

alter table public.profiles         enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.stripe_events    enable row level security;
alter table public.fixture_insights enable row level security;

create policy "Owner can view own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Owner can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- (No INSERT/DELETE policy: rows are created only by handle_new_user() and
-- removed only via the ON DELETE CASCADE from auth.users.)

create policy "Owner can view own subscriptions"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);
-- (Deliberately no INSERT/UPDATE/DELETE policy for authenticated at all --
-- see the table comment: writes are service-role-only, full stop.)

-- stripe_events: no policies at all for anon/authenticated -> RLS denies
-- every operation, including SELECT, by default.

create policy "Premium subscribers can view fixture insights"
  on public.fixture_insights for select
  to authenticated
  using (public.is_premium((select auth.uid())));
-- (No INSERT/UPDATE/DELETE policy for authenticated -- written only by the
-- jobs' service-role client.)

-- ============================================================================
-- Grants (explicit; see the header comment on why nothing here relies on the
-- platform's stock default ACL)
-- ============================================================================

revoke all on public.profiles, public.subscriptions, public.stripe_events, public.fixture_insights
  from public, anon, authenticated;

grant select, update on public.profiles         to authenticated;
grant select         on public.subscriptions    to authenticated;
grant select         on public.fixture_insights to authenticated;
-- public.stripe_events: NO grant to authenticated at all (service-role only,
-- not even SELECT -- see the table comment).

grant all on public.profiles, public.subscriptions, public.stripe_events, public.fixture_insights
  to service_role;
