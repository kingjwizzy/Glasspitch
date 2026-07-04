-- Glass Pitch — Wave 1 backend foundations (extends 0001 -> ... -> 0008). Must
-- apply cleanly, in order, on a FRESH database and on the already-provisioned
-- live project. Purely ADDITIVE: new tables, new nullable/defaulted columns,
-- new functions, new RLS policies. Nothing here drops or alters an existing
-- column's type/nullability, and it does not touch the §7 ledger immutability
-- trigger (predictions.narrative is deliberately left OUTSIDE that trigger's
-- protected column set -- see (C) below).
--
-- This migration:
--   (A) Email-send throttle (audit fix #1: /api/email/subscribe had zero rate
--       limiting) -- a small `email_send_log` table plus an atomic
--       `request_email_send(p_email, p_ip_hash)` RPC the route handler calls,
--       server-side, over its own service-role client, BEFORE asking Resend
--       to actually send.
--   (B) Public opt-in "Beat the Model" leaderboard (improvement #5) --
--       `profiles.leaderboard_opt_in` (OFF by default) + a new
--       `leaderboard_display_name`, and a `leaderboard_standings` table
--       jobs/compute_leaderboard.py replaces wholesale every run.
--   (C) Free "what's driving this call" narrative (improvement #6) -- a
--       nullable `predictions.narrative` column the FREE match page already
--       selects `predictions(...)` columns from (src/lib/queries/match.ts),
--       so no new join is needed on the read side.

-- ============================================================================
-- (A) Email-send throttle (audit fix #1)
-- ============================================================================

create table public.email_send_log (
  id      bigint      generated always as identity primary key,
  email   text        not null,
  ip_hash text        not null,
  sent_at timestamptz not null default now()
);

comment on table public.email_send_log is
  'Throttle ledger backing public.request_email_send() (audit fix #1 -- /api/email/subscribe had zero rate limiting). One row per GRANTED send attempt only -- a request request_email_send() refuses is never recorded. service-role only; zero anon/authenticated access (mirrors job_runs/stripe_events/email_subscribers'' posture).';

create index idx_email_send_log_email_sent on public.email_send_log (email, sent_at desc);
create index idx_email_send_log_ip_sent    on public.email_send_log (ip_hash, sent_at desc);
create index idx_email_send_log_sent_at    on public.email_send_log (sent_at desc);

alter table public.email_send_log enable row level security;
-- No policies for anon/authenticated -> RLS denies all access by default.
-- Explicit belt-and-suspenders on top of that default-deny (mirrors
-- job_runs'/stripe_events'/email_subscribers' posture exactly):
revoke all on public.email_send_log from public, anon, authenticated;
grant all on public.email_send_log to service_role;

-- request_email_send(): the atomic "may I send?" check + record. Called by
-- the server-only /api/email/subscribe (and confirm/unsubscribe) route
-- handler over ITS OWN service-role client -- the same client that already
-- writes email_subscribers directly (ARCHITECTURE.md §5 v3 email-capture
-- amendment) -- BEFORE it asks Resend to actually send.
--
-- Deliberately SECURITY INVOKER (no `security definer`), unlike
-- teardown_season/join_pool/is_pool_member: this function is only ever
-- invoked by service_role, which already bypasses RLS and already holds a
-- direct `grant all` on email_send_log above -- there is no privilege this
-- function needs to borrow from a definer, so the least-privilege choice is
-- to not grant one. EXECUTE is still revoked from public/anon/authenticated
-- and granted to service_role ONLY, matching every other RPC in this repo.
--
-- Thresholds (ALL three must hold, else FALSE and NOTHING is recorded):
--   (a) per-address cooldown  -- no GRANTED send to p_email in the last 5 minutes.
--   (b) per-IP window         -- fewer than 5 GRANTED sends for p_ip_hash in
--                                 the last rolling hour.
--   (c) global daily ceiling  -- fewer than 300 GRANTED sends of ANY
--                                 address/IP in the last rolling 24h (protects
--                                 the Resend quota).
--
-- A pg_advisory_xact_lock keyed on the (lower-cased, trimmed) address
-- serialises two near-simultaneous calls for the SAME email so they can't
-- both observe "cooldown clear" and both pass -- released automatically at
-- the end of this call's (implicit, per-RPC) transaction.
create or replace function public.request_email_send(p_email text, p_ip_hash text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_email        text := lower(trim(p_email));
  v_cooldown_hit boolean;
  v_ip_count     integer;
  v_daily_count  integer;
begin
  if v_email is null or v_email = '' or p_ip_hash is null or p_ip_hash = '' then
    raise exception 'request_email_send requires a non-empty p_email and p_ip_hash.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('glasspitch.request_email_send:' || v_email, 0));

  select exists (
    select 1 from public.email_send_log
    where email = v_email and sent_at > now() - interval '5 minutes'
  ) into v_cooldown_hit;

  select count(*) into v_ip_count
    from public.email_send_log
    where ip_hash = p_ip_hash and sent_at > now() - interval '1 hour';

  select count(*) into v_daily_count
    from public.email_send_log
    where sent_at > now() - interval '1 day';

  if v_cooldown_hit or v_ip_count >= 5 or v_daily_count >= 300 then
    return false;
  end if;

  insert into public.email_send_log (email, ip_hash) values (v_email, p_ip_hash);
  return true;
end;
$$;

comment on function public.request_email_send(text, text) is
  'Atomic rate-limit gate for the email-capture writer (audit fix #1). Returns TRUE and records the attempt iff ALL hold: (a) no granted send to p_email in the last 5 minutes; (b) fewer than 5 granted sends for p_ip_hash in the last rolling hour; (c) fewer than 300 granted sends globally in the last rolling 24h. Returns FALSE (records nothing) otherwise. service_role EXECUTE only -- called by /api/email/subscribe''s server-only route handler over its own service-role client, BEFORE it asks Resend to actually send. SECURITY INVOKER by design (see the definition comment above) -- unlike teardown_season/join_pool, it borrows no privilege the caller (service_role) doesn''t already have directly.';

revoke execute on function public.request_email_send(text, text) from public, anon, authenticated;
grant execute on function public.request_email_send(text, text) to service_role;

-- ============================================================================
-- (B) Public opt-in "Beat the Model" leaderboard (improvement #5)
-- ============================================================================

alter table public.profiles
  add column leaderboard_opt_in       boolean not null default false,
  add column leaderboard_display_name text;

alter table public.profiles
  add constraint profiles_leaderboard_display_name_len_check
  check (leaderboard_display_name is null
         or char_length(leaderboard_display_name) between 1 and 24);

comment on column public.profiles.leaderboard_opt_in is
  'Opt-in flag (improvement #5) for the PUBLIC "Beat the Model" leaderboard (public.leaderboard_standings). OFF by default (privacy) -- a user must explicitly opt in before their display name + Brier record is ever published. Owner-writable via the EXISTING "Owner can update own profile" policy + `grant update` (migration 0004, table-level -- covers new columns automatically) -- no new RLS needed.';
comment on column public.profiles.leaderboard_display_name is
  'Optional public handle for the opt-in leaderboard, 1-24 chars (same length bound as pool_members.display_name). jobs/compute_leaderboard.py falls back to an anonymised placeholder derived from user_id (never an email or other PII) when this is null but leaderboard_opt_in is true.';

create table public.leaderboard_standings (
  user_id          uuid        primary key references public.profiles (id) on delete cascade,
  display_name     text        not null,
  picks_scored     integer     not null check (picks_scored >= 1),
  user_mean_brier  numeric     not null check (user_mean_brier >= 0 and user_mean_brier <= 2),
  model_mean_brier numeric     not null check (model_mean_brier >= 0 and model_mean_brier <= 2),
  beat_margin      numeric     not null,
  rank             integer     not null check (rank >= 1),
  updated_at       timestamptz not null default now()
);

comment on table public.leaderboard_standings is
  'Public opt-in "Beat the Model" leaderboard (improvement #5). Contains ONLY users with profiles.leaderboard_opt_in=true, plus their display_name -- no other PII. Written by jobs/compute_leaderboard.py, which REPLACES the whole table every run (upsert-then-prune, mirrors top_scorers'' convention, migration 0005): user_mean_brier/model_mean_brier are computed over the SAME fixture set per user, using the SAME source=''api-football''+status=''scored'' rule src/lib/queries/play.ts/match.ts use for the model''s displayed call (a scored row can never be void -- see those modules); beat_margin = model_mean_brier - user_mean_brier (positive = beat the model); rank is dense 1..N by beat_margin desc. Misses count honestly -- every one of a user''s scored picks with a comparable model score is included, never filtered for a flattering average. anon/authenticated SELECT (the whole point); service role writes only.';

create index idx_leaderboard_standings_rank on public.leaderboard_standings (rank);

alter table public.leaderboard_standings enable row level security;

create policy "Public read leaderboard standings"
  on public.leaderboard_standings for select to anon, authenticated using (true);

grant select on public.leaderboard_standings to anon, authenticated;
grant all on public.leaderboard_standings to service_role;

-- ============================================================================
-- (C) Free "what's driving this call" narrative (improvement #6)
-- ============================================================================
-- Nullable, additive, no backfill in SQL (jobs/backfill_narratives.py handles
-- existing rows in Python -- see that module). Lives on `predictions`, the
-- SAME table src/lib/queries/match.ts already selects columns from
-- (`predictions(prob_home, ..., scored_at)`) -- the frontend just adds
-- `narrative` to that existing column list; no new join, no new table.

alter table public.predictions add column narrative text;

comment on column public.predictions.narrative is
  'Free, plain-language "what''s driving this call" summary (improvement #6), <=~2 sentences, analysis framing only -- never odds/betting-market language, never a guaranteed edge (§9/§13). Deterministically derived (jobs/narrative.py''s build_free_narrative(), a pure template function -- never hallucinated free text) from signals ALREADY fetched/stored for this fixture: this row''s own H/D/A probabilities plus the SAME curated comparison/h2h_summary this fixture''s fixture_insights(kind=''prediction_detail'') row stores (ARCHITECTURE.md v2 §4/§7) -- never a new football-API call. Populated going forward by jobs/fetch_predictions.py for every NEWLY-inserted source=''api-football'' row (the one displayed model, §9 -- source=''inhouse-elo'' rows are never given a narrative, since that model is never displayed); existing rows are caught up by the one-off jobs/backfill_narratives.py, purely from already-stored data, zero API calls. Deliberately NOT one of the columns the migration 0001/0003 immutability trigger protects (mirrors `tier`''s deliberate mutability) -- exactly what lets the backfill populate it for rows that are already locked/scored.';
