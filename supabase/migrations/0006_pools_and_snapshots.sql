-- Glass Pitch — W5 backend: Beat the Model pools + Gameweek Board/Fixture
-- Ticker snapshots (extends 0001 -> 0002 -> 0003 -> 0004 -> 0005). Must apply
-- cleanly, in order, on a FRESH database and on the already-provisioned live
-- project.
--
-- ARCHITECTURE.md v3 §5 amendment (owner-approved 2026-07-03): authenticated
-- users may write THEIR OWN game picks (`user_predictions` + the pools
-- tables) through dedicated, owner-scoped RLS writer paths -- the football
-- tables and the model's ledger (`predictions`) remain jobs-only, full stop.
-- This migration touches ONLY the new game tables below; it does not alter
-- leagues/teams/fixtures/predictions in any way.
--
-- ROADMAP.md §2/§4: "Beat the Model" pools are PRIZE-FREE FOREVER (keeps the
-- product outside Gambling Commission licensing) and scoring favours
-- accuracy honesty (Brier, the SAME machinery as the model's own ledger) --
-- deliberately NO streak/current-streak/loss-aversion columns anywhere in
-- this schema (DESIGN.md §6). The Gameweek Board / Fixture Ticker are free,
-- anon-readable, jobs-only-derived surfaces -- same public-data access class
-- as `top_scorers` (migration 0005), never the ledger, never gated.
--
-- This migration adds five tables:
--   pools                       -- a named group a user creates and owns.
--   pool_members                -- membership + a per-pool display name
--                                  (shown to other members only).
--   user_predictions            -- a user's OWN H/D/A probability picks per
--                                  fixture ("Beat the Model"); owner-scoped
--                                  writes, closed at kickoff exactly like the
--                                  model's own ledger; scored by a new jobs
--                                  script reusing scoring.brier_score.
--   fixture_pick_aggregates     -- crowd-vs-model aggregate (n_picks,
--                                  avg_prob_*), written by the jobs ONLY --
--                                  the one sanctioned way anon ever sees
--                                  anything pick-shaped, so anon NEVER
--                                  touches `user_predictions` directly.
--   team_probability_snapshots  -- nightly Elo-derived per-team/per-fixture
--                                  probabilities (win/draw/loss, clean sheet,
--                                  expected goals) + day-over-day deltas.
--                                  Public data (like top_scorers) powering
--                                  the free Gameweek Board + Fixture Ticker.
--
-- Grants mirror 0004's premium-table posture for the three game/user tables
-- (pools/pool_members/user_predictions get ZERO anon access -- every grant is
-- explicit, nothing relies on the platform default ACL) and 0005's
-- public-data posture for the two jobs-derived read surfaces
-- (fixture_pick_aggregates/team_probability_snapshots -- anon SELECT,
-- service-role-only writes).

-- ============================================================================
-- 1. pools
-- ============================================================================

create table public.pools (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null check (char_length(name) between 1 and 60),
  -- Short, URL-friendly, server-generated join code (48 bits of entropy --
  -- comparable to a typical short-link token). Never user-suppliable: there
  -- is deliberately no client-writable column grant for it (see the grants
  -- section below), so a pool's code can never be spoofed to collide with,
  -- or overwrite, another pool's.
  invite_code   text        not null unique default encode(gen_random_bytes(6), 'hex'),
  owner_user_id uuid        not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now()
);

comment on table public.pools is
  'A "Beat the Model" pool (ARCHITECTURE.md v3 §5, ROADMAP.md §2/§4) -- prize-free forever (DESIGN.md §6). Owner-scoped RLS: any authenticated user may create one (owning it); members (resolved via public.is_pool_member()) may view it; only the owner may rename/delete it. Zero anon access.';
comment on column public.pools.invite_code is
  'Server-generated join code (gen_random_bytes(6) -- 48 bits of entropy), resolved by public.join_pool(). Not client-writable (no column grant) -- only the DEFAULT ever populates it.';

create index idx_pools_owner on public.pools (owner_user_id);

-- ============================================================================
-- 2. pool_members
-- ============================================================================

create table public.pool_members (
  pool_id      uuid        not null references public.pools (id) on delete cascade,
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  -- Shown to OTHER members of the same pool only (never anon, never
  -- cross-pool) -- deliberately separate from any real-name field.
  display_name text        not null check (char_length(display_name) between 1 and 24),
  joined_at    timestamptz not null default now(),
  primary key (pool_id, user_id)
);

comment on table public.pool_members is
  'Pool membership + per-pool display name (ARCHITECTURE.md v3 §5). Joining by invite code goes through the SECURITY DEFINER public.join_pool() RPC (which also lets a caller resolve a pool they are not YET a member of, by code, despite pools'' own owner/member-only SELECT policy); a user may also insert/delete their OWN row directly (e.g. the owner adding themselves right after creating a pool). Zero anon access.';

create index idx_pool_members_user on public.pool_members (user_id);

-- ----------------------------------------------------------------------------
-- is_pool_member(): SECURITY DEFINER on purpose (NOT the SECURITY INVOKER
-- default recommended elsewhere) -- pool_members' own "members can see other
-- members" SELECT policy needs to check pool_members membership, and an
-- INVOKER helper would re-apply that SAME policy to its own internal lookup,
-- recursing forever. DEFINER bypasses RLS for this one narrow, read-only
-- existence check (mirrors the documented exception in the security
-- checklist: "bypassing RLS on an internal lookup table"). EXECUTE is
-- revoked from PUBLIC/anon immediately -- this is the standard mitigation
-- this repo already applies to every SECURITY DEFINER helper (is_premium(),
-- teardown_season(), handle_new_user()) so a DEFINER function in `public`
-- never becomes an accidental public API. search_path pinned empty; every
-- reference below is schema-qualified.
-- ----------------------------------------------------------------------------
create or replace function public.is_pool_member(p_pool_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pool_members m
    where m.pool_id = p_pool_id
      and m.user_id = p_user_id
  );
$$;

comment on function public.is_pool_member(uuid, uuid) is
  'True if p_user_id is a member of p_pool_id. SECURITY DEFINER (unlike is_premium()) specifically to avoid pool_members'' SELECT policy recursing into itself -- see the definition comment above.';

revoke execute on function public.is_pool_member(uuid, uuid) from public, anon;
grant execute on function public.is_pool_member(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- join_pool(): the sanctioned way to join BY INVITE CODE. SECURITY DEFINER so
-- it can look up a pool by its code even though the caller isn't a member yet
-- (pools' own SELECT policy would otherwise hide that row from them) and so
-- it can perform the pool_members insert in one atomic step. Always acts on
-- auth.uid() (the CALLING user) -- there is no "join on behalf of someone
-- else" parameter, and a null auth.uid() (no session) is rejected outright
-- (the security-checklist-recommended defensive check for any public.
-- SECURITY DEFINER function). EXECUTE is revoked from PUBLIC/anon and granted
-- to authenticated only -- anon can never call this, and neither can it ever
-- reach the underlying tables directly (see grants below).
-- ----------------------------------------------------------------------------
create or replace function public.join_pool(p_invite_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool  public.pools;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'join_pool() requires an authenticated caller.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_pool from public.pools where invite_code = p_invite_code;
  if not found then
    raise exception 'Invalid invite code.'
      using errcode = 'no_data_found';
  end if;

  -- Idempotent: re-submitting the same invite code (e.g. a double-tap on
  -- "join") simply refreshes the caller's own display name rather than
  -- erroring on the (pool_id, user_id) primary key.
  insert into public.pool_members (pool_id, user_id, display_name)
  values (v_pool.id, v_uid, p_display_name)
  on conflict (pool_id, user_id) do update set display_name = excluded.display_name;

  return jsonb_build_object('pool_id', v_pool.id, 'pool_name', v_pool.name);
end;
$$;

comment on function public.join_pool(text, text) is
  'Join a pool by its invite_code (ARCHITECTURE.md v3 §5) -- the app-facing join flow (as opposed to pool_members'' own direct self-insert policy, which exists mainly so an owner can add themselves right after creating a pool). SECURITY DEFINER: bypasses pools'' owner/member-only SELECT policy just long enough to resolve the code, and performs the membership insert atomically. Always acts on auth.uid(); rejects a null (unauthenticated) caller.';

revoke execute on function public.join_pool(text, text) from public, anon;
grant execute on function public.join_pool(text, text) to authenticated;

-- ============================================================================
-- 3. user_predictions -- "Beat the Model" picks (ARCHITECTURE.md v3 §5)
-- ============================================================================

create table public.user_predictions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  fixture_id  bigint      not null references public.fixtures (id) on delete cascade,
  prob_home   numeric     not null check (prob_home >= 0 and prob_home <= 1),
  prob_draw   numeric     not null check (prob_draw >= 0 and prob_draw <= 1),
  prob_away   numeric     not null check (prob_away >= 0 and prob_away <= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- scoring fields -- service-role-only (column grants below + the trigger's
  -- belt-and-suspenders check); nullable until scored. Deliberately NO streak
  -- / current-streak / longest-streak column anywhere in this table
  -- (DESIGN.md §6 -- no loss-aversion mechanics in the data model).
  result      text        check (result in ('home', 'draw', 'away')),
  brier_score numeric,
  scored_at   timestamptz,

  constraint user_predictions_user_fixture_unique unique (user_id, fixture_id),

  -- Same sum-to-~1.0 epsilon as the ledger's own CHECK (migration 0001) --
  -- 0.01 in the DB, 0.02 in Python (jobs/scoring.py's PROB_SUM_TOLERANCE),
  -- so anything the DB accepts also passes scoring.py's own guard.
  constraint user_predictions_prob_sum_check
    check (abs((prob_home + prob_draw + prob_away) - 1.0) <= 0.01)
);

comment on table public.user_predictions is
  'A user''s OWN H/D/A picks per fixture -- "Beat the Model" (ARCHITECTURE.md v3 §5, ROADMAP.md §2/§4). Owner may insert/update their own row ONLY while the fixture is still open (public.enforce_user_prediction_write_window(), mirroring the ledger''s own kickoff-lock discipline); nobody may delete a pick, ever (accuracy-honesty ethos -- DESIGN.md §6, same "misses stay visible" spirit as the model''s ledger). Scored by jobs/score_user_predictions.py using the SAME scoring.brier_score machinery as the model''s own ledger; scoring fields are service-role-only. Pool members may see EACH OTHER''s picks, but only once the fixture has locked (anti-copying). Zero anon access.';
comment on column public.user_predictions.result is
  'home/draw/away, written ONLY by jobs/score_user_predictions.py once the fixture is finished -- mirrors public.predictions.result.';

create index idx_user_predictions_fixture on public.user_predictions (fixture_id);
create index idx_user_predictions_user on public.user_predictions (user_id);
-- jobs/score_user_predictions.py's self-draining scan (mirrors migration
-- 0003's idx_predictions_due): only unscored rows are ever candidates.
create index idx_user_predictions_unscored
  on public.user_predictions (fixture_id) where scored_at is null;

create trigger user_predictions_set_updated_at
  before update on public.user_predictions
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- enforce_user_prediction_write_window(): the trigger half of "owner can
-- insert/update own rows ONLY while the fixture is still open". Column-level
-- grants (below) are the primary, table-level defence restricting
-- `authenticated` to prob_home/prob_draw/prob_away only -- this trigger is
-- the belt-and-suspenders check the task calls for (rejects any write that
-- also tries to touch a scoring field) PLUS the one check column grants
-- cannot express at all: "is this fixture's kickoff still in the future".
--
-- current_user is the ACTUAL connecting Postgres role that PostgREST sets
-- per request (anon / authenticated / service_role) -- the same mechanism
-- migration 0003's teardown escape hatch and every `to service_role` grant in
-- this repo already rely on. jobs/score_user_predictions.py's service-role
-- writer legitimately writes result/brier_score/scored_at AFTER kickoff (once
-- the fixture has finished), so it is exempted outright rather than made to
-- satisfy the same "still open" rule it is scoring against.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_user_prediction_write_window()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kickoff timestamptz;
begin
  if current_user = 'service_role' then
    return new;
  end if;

  select f.kickoff_utc into v_kickoff
  from public.fixtures f
  where f.id = new.fixture_id;

  if v_kickoff is null then
    raise exception 'user_predictions.fixture_id % does not reference a known fixture.', new.fixture_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_kickoff <= now() then
    raise exception
      'Fixture % has already kicked off (kickoff_utc=%); picks are closed once a fixture locks (ARCHITECTURE.md v3 §5).',
      new.fixture_id, v_kickoff
      using errcode = 'check_violation';
  end if;

  if new.result is not null or new.brier_score is not null or new.scored_at is not null then
    raise exception
      'user_predictions scoring fields (result/brier_score/scored_at) may only be written by the service role.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger user_predictions_enforce_write_window
  before insert or update on public.user_predictions
  for each row
  execute function public.enforce_user_prediction_write_window();

-- ============================================================================
-- Row Level Security -- pools / pool_members / user_predictions
-- ============================================================================
-- Every USING/WITH CHECK wraps auth.uid() in a scalar subquery per Supabase's
-- RLS performance guidance (evaluated once per statement, not per row). NO
-- anon policy exists anywhere in this section -- anon gets zero access,
-- reinforced by the grants below.

alter table public.pools             enable row level security;
alter table public.pool_members      enable row level security;
alter table public.user_predictions  enable row level security;

-- ----- pools -----------------------------------------------------------------

create policy "Members can view their pools"
  on public.pools for select
  to authenticated
  using (
    owner_user_id = (select auth.uid())
    or public.is_pool_member(id, (select auth.uid()))
  );

create policy "Authenticated users can create a pool they own"
  on public.pools for insert
  to authenticated
  with check (owner_user_id = (select auth.uid()));

create policy "Owner can update their pool"
  on public.pools for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
-- (Column grant below narrows this to `name` only -- invite_code/owner_user_id
-- stay immutable even though the row-level policy would otherwise permit it.)

create policy "Owner can delete their pool"
  on public.pools for delete
  to authenticated
  using (owner_user_id = (select auth.uid()));

-- ----- pool_members ----------------------------------------------------------

create policy "Members can view pool member rows"
  on public.pool_members for select
  to authenticated
  using (
    public.is_pool_member(pool_id, (select auth.uid()))
    -- Also let the OWNER see their pool's (possibly still-empty) member list
    -- even before they've explicitly joined it themselves.
    or exists (
      select 1 from public.pools p
      where p.id = pool_members.pool_id
        and p.owner_user_id = (select auth.uid())
    )
  );

create policy "Users can add themselves to a pool"
  on public.pool_members for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can leave a pool"
  on public.pool_members for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----- user_predictions -------------------------------------------------------

create policy "Owner can view own predictions"
  on public.user_predictions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Anti-copying (ARCHITECTURE.md v3 §5): a shared-pool member's picks become
-- visible ONLY once the fixture has locked (kickoff passed) -- never before.
-- Membership is deliberately NOT pool-scoped on user_predictions itself
-- (there is no pool_id column here) -- picks are per-user/per-fixture, and
-- "sharing ANY pool" with the picker is what grants (post-lock) visibility,
-- matching a Superbru-style global pick history rather than a per-pool copy
-- of each prediction.
create policy "Pool members can view each other's locked picks"
  on public.user_predictions for select
  to authenticated
  using (
    exists (
      select 1
      from public.pool_members mine
      join public.pool_members theirs on theirs.pool_id = mine.pool_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = user_predictions.user_id
    )
    and exists (
      select 1 from public.fixtures f
      where f.id = user_predictions.fixture_id
        and f.kickoff_utc <= now()
    )
  );

create policy "Owner can submit own predictions"
  on public.user_predictions for insert
  to authenticated
  with check (user_id = (select auth.uid()));
-- (Column grant below narrows this to user_id/fixture_id/prob_* -- result/
-- brier_score/scored_at have no INSERT grant for authenticated at all, and
-- the trigger above is a second, independent check against the same rule.)

create policy "Owner can update own predictions"
  on public.user_predictions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- (Column grant below narrows this to prob_* only. No DELETE policy at all --
-- picks are never erasable, matching the ledger's own "misses stay visible"
-- ethos; DESIGN.md §6.)

-- ============================================================================
-- Grants -- pools / pool_members / user_predictions (zero anon access;
-- explicit, narrow grants for authenticated; full access for service_role)
-- ============================================================================

revoke all on public.pools, public.pool_members, public.user_predictions
  from public, anon, authenticated;

grant select, insert, delete on public.pools to authenticated;
grant update (name) on public.pools to authenticated;

grant select, insert, delete on public.pool_members to authenticated;
-- No UPDATE grant on pool_members for authenticated at all -- a re-join via
-- join_pool() (SECURITY DEFINER, bypasses RLS/grants) is how a display name
-- is ever changed after the initial join.

grant select on public.user_predictions to authenticated;
grant insert (user_id, fixture_id, prob_home, prob_draw, prob_away)
  on public.user_predictions to authenticated;
grant update (prob_home, prob_draw, prob_away)
  on public.user_predictions to authenticated;
-- No DELETE grant on user_predictions for authenticated at all (see the "no
-- delete, ever" policy comment above).

grant all on public.pools, public.pool_members, public.user_predictions
  to service_role;

-- ============================================================================
-- 4. fixture_pick_aggregates -- crowd-vs-model, anon-readable, jobs-written only
-- ============================================================================
-- The ONLY way anon ever sees anything pick-shaped: rather than expose ANY
-- policy on user_predictions to anon (however narrow), jobs/
-- score_user_predictions.py pre-computes a small, PII-free aggregate
-- (n_picks + avg_prob_*) into this plain table once a fixture LOCKS --
-- matching user_predictions' own anti-copying visibility rule (pre-kickoff
-- aggregates are never published either). One row per fixture; once written
-- it never needs to change again, because no further user_predictions writes
-- are possible for that fixture after lock (the trigger above forbids them).

create table public.fixture_pick_aggregates (
  fixture_id    bigint      primary key references public.fixtures (id) on delete cascade,
  n_picks       integer     not null default 0 check (n_picks >= 0),
  avg_prob_home numeric     check (avg_prob_home is null or (avg_prob_home >= 0 and avg_prob_home <= 1)),
  avg_prob_draw numeric     check (avg_prob_draw is null or (avg_prob_draw >= 0 and avg_prob_draw <= 1)),
  avg_prob_away numeric     check (avg_prob_away is null or (avg_prob_away >= 0 and avg_prob_away <= 1)),
  updated_at    timestamptz not null default now(),
  constraint fixture_pick_aggregates_prob_sum_check
    check (
      avg_prob_home is null
      or abs((avg_prob_home + avg_prob_draw + avg_prob_away) - 1.0) <= 0.01
    )
);

comment on table public.fixture_pick_aggregates is
  'Crowd-vs-model aggregate, no PII (ARCHITECTURE.md v3 §5): n_picks + avg_prob_home/draw/away, written ONLY by jobs/score_user_predictions.py, ONLY once a fixture has locked (mirrors user_predictions'' own anti-copying rule -- never published pre-kickoff). PUBLIC data, same access class as top_scorers (migration 0005) -- anon/authenticated read, service role writes.';

create trigger fixture_pick_aggregates_set_updated_at
  before update on public.fixture_pick_aggregates
  for each row
  execute function public.set_updated_at();

alter table public.fixture_pick_aggregates enable row level security;

create policy "Public read fixture pick aggregates"
  on public.fixture_pick_aggregates for select to anon, authenticated using (true);

grant select on public.fixture_pick_aggregates to anon, authenticated;
grant all on public.fixture_pick_aggregates to service_role;

-- ============================================================================
-- 5. team_probability_snapshots -- nightly Elo snapshots (Gameweek Board / Ticker)
-- ============================================================================
-- Explicit columns (not a jsonb blob): this powers sortable/filterable board
-- and ticker UI (e.g. "sort by clean-sheet probability", "biggest movers
-- today") -- the same rationale that keeps `predictions`' probabilities as
-- plain numeric columns rather than jsonb. One row per (snapshot_date,
-- team_id, fixture_id) -- TWO rows per fixture (one per side), written by the
-- new jobs/snapshot_probabilities.py from jobs/elo.py's Elo-derived
-- probabilities (see that module's docstrings for the clean-sheet/expected-
-- goals maths). day-over-day deltas are computed ONCE at write time (against
-- the prior day's row for the same team_id/fixture_id) and stored alongside,
-- so the board/ticker never needs a self-join at read time.

create table public.team_probability_snapshots (
  snapshot_date          date        not null,
  team_id                bigint      not null references public.teams (id) on delete cascade,
  fixture_id             bigint      not null references public.fixtures (id) on delete cascade,
  opponent_team_id       bigint      not null references public.teams (id) on delete cascade,
  is_home                boolean     not null,
  elo_rating             numeric     not null,
  prob_win               numeric     not null check (prob_win >= 0 and prob_win <= 1),
  prob_draw              numeric     not null check (prob_draw >= 0 and prob_draw <= 1),
  prob_loss              numeric     not null check (prob_loss >= 0 and prob_loss <= 1),
  prob_clean_sheet       numeric     not null check (prob_clean_sheet >= 0 and prob_clean_sheet <= 1),
  expected_goals_for     numeric     not null check (expected_goals_for >= 0),
  expected_goals_against numeric     not null check (expected_goals_against >= 0),
  -- Day-over-day deltas vs this SAME team_id/fixture_id's snapshot exactly
  -- one day earlier; null on that pair's first-ever snapshot (nothing to
  -- diff against yet).
  delta_elo_rating       numeric,
  delta_prob_win         numeric,
  created_at             timestamptz not null default now(),
  primary key (snapshot_date, team_id, fixture_id),
  constraint team_probability_snapshots_prob_sum_check
    check (abs((prob_win + prob_draw + prob_loss) - 1.0) <= 0.01)
);

comment on table public.team_probability_snapshots is
  'Nightly per-team/per-fixture Elo-derived probabilities (ARCHITECTURE.md v3 §5, ROADMAP.md §2/§4): win/draw/loss, clean-sheet, and expected-goals estimates from jobs/elo.py, plus day-over-day deltas computed at write time. Powers the free Gameweek Board + Fixture Ticker. PUBLIC data, same access class as top_scorers (migration 0005) -- anon/authenticated read, service role (jobs/snapshot_probabilities.py) writes.';

create index idx_team_prob_snapshots_fixture on public.team_probability_snapshots (fixture_id);
create index idx_team_prob_snapshots_team_date on public.team_probability_snapshots (team_id, snapshot_date desc);

alter table public.team_probability_snapshots enable row level security;

create policy "Public read team probability snapshots"
  on public.team_probability_snapshots for select to anon, authenticated using (true);

grant select on public.team_probability_snapshots to anon, authenticated;
grant all on public.team_probability_snapshots to service_role;
