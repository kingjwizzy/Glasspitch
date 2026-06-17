-- Glass Pitch — initial schema (ARCHITECTURE.md §7).
--
-- Tables: leagues, teams, fixtures, and the predictions ledger.
-- Integrity: probability-sum CHECK, the kickoff immutability trigger, and Row
-- Level Security (anon read-only; only the service role writes).
-- All times are timestamptz in UTC.

-- ============================================================================
-- Tables
-- ============================================================================

-- leagues -------------------------------------------------------------------
create table public.leagues (
  id            bigint generated always as identity primary key,
  api_league_id bigint  not null unique,
  name          text    not null,
  slug          text    not null unique,
  country       text    not null,
  season        integer not null
);

-- teams ---------------------------------------------------------------------
create table public.teams (
  id          bigint generated always as identity primary key,
  api_team_id bigint not null unique,
  name        text   not null,          -- plain text only, no crest (§13)
  slug        text   not null unique,
  league_id   bigint not null references public.leagues (id) on delete cascade
);

-- fixtures ------------------------------------------------------------------
create table public.fixtures (
  id               bigint generated always as identity primary key,
  api_fixture_id   bigint      not null unique,
  league_id        bigint      not null references public.leagues (id) on delete cascade,
  home_team_id     bigint      not null references public.teams (id),
  away_team_id     bigint      not null references public.teams (id),
  kickoff_utc      timestamptz not null,
  status           text        not null default 'scheduled'
                     check (status in ('scheduled', 'live', 'finished', 'postponed')),
  final_home_goals integer,
  final_away_goals integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fixtures_distinct_teams check (home_team_id <> away_team_id)
);

-- predictions (the ledger — this is the product) ----------------------------
create table public.predictions (
  id                   uuid primary key default gen_random_uuid(),
  fixture_id           bigint      not null references public.fixtures (id) on delete cascade,
  model_version        text        not null,     -- e.g. 'api-football-v1', 'elo-v1'
  source               text        not null check (source in ('api-football', 'inhouse-elo')),
  prob_home            numeric     not null check (prob_home >= 0 and prob_home <= 1),
  prob_draw            numeric     not null check (prob_draw >= 0 and prob_draw <= 1),
  prob_away            numeric     not null check (prob_away >= 0 and prob_away <= 1),
  predicted_home_goals integer     not null,
  predicted_away_goals integer     not null,
  published_at         timestamptz not null default now(),
  locked_at            timestamptz not null,     -- = kickoff; row immutable once locked_at <= now()
  status               text        not null default 'published'
                         check (status in ('published', 'locked', 'scored', 'unlocked_void')),
  -- Monetisation-ready gating field; 'free' at launch (§4, §7). Constrained to
  -- match the TS PredictionTier union ('free' | 'premium').
  tier                 text        not null default 'free'
                         check (tier in ('free', 'premium')),

  -- scoring fields (written post full-time; nullable until scored) ----------
  final_home_goals     integer,
  final_away_goals     integer,
  result               text        check (result in ('home', 'draw', 'away')),
  brier_score          numeric,
  log_loss             numeric,
  scored_at            timestamptz,

  created_at           timestamptz not null default now(),

  -- one prediction per fixture per model_version (§7)
  constraint predictions_fixture_model_unique unique (fixture_id, model_version),

  -- the three probabilities sum to ~1.0 within a small epsilon (§7)
  constraint predictions_prob_sum_check
    check (abs((prob_home + prob_draw + prob_away) - 1.0) <= 0.01)
);

comment on table public.predictions is
  'The prediction ledger. Locked at kickoff and immutable thereafter; only scoring fields are written post-match (ARCHITECTURE.md §7, §10).';
comment on column public.predictions.tier is
  'Monetisation-ready gating field; ''free'' at launch, premium is built-ready but off in v1 (§4).';

-- Indexes for the common read paths -----------------------------------------
create index idx_teams_league        on public.teams (league_id);
create index idx_fixtures_league      on public.fixtures (league_id);
create index idx_fixtures_kickoff     on public.fixtures (kickoff_utc);
create index idx_fixtures_status      on public.fixtures (status);
create index idx_fixtures_home_team   on public.fixtures (home_team_id);
create index idx_fixtures_away_team   on public.fixtures (away_team_id);
create index idx_predictions_fixture  on public.predictions (fixture_id);
create index idx_predictions_status   on public.predictions (status);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Keep fixtures.updated_at fresh on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fixtures_set_updated_at
  before update on public.fixtures
  for each row
  execute function public.set_updated_at();

-- Prediction immutability (ARCHITECTURE.md §7).
-- Once a prediction is locked (locked_at <= now()), reject any UPDATE that
-- changes the prediction itself: prob_*, predicted_*, model_version, source, or
-- published_at. The scoring fields (final_*, result, brier_score, log_loss,
-- scored_at, status) and tier remain writable so the scoring job can finish the
-- row.
--
-- We ALSO protect locked_at and the identity columns (id, fixture_id,
-- created_at). locked_at must be frozen, otherwise a writer could push it into
-- the future to flip `old.locked_at <= now()` back to false and re-open the row
-- on a later UPDATE — defeating the §7/§10 "immutable after kickoff" guarantee.
-- fixture_id is frozen so a locked prediction cannot be re-pointed at a
-- different match (which would corrupt ledger/score attribution). This extends
-- the spec's literal column list to actually deliver the immutability it
-- promises.
create or replace function public.enforce_prediction_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at <= now() then
    if new.prob_home            is distinct from old.prob_home
       or new.prob_draw         is distinct from old.prob_draw
       or new.prob_away         is distinct from old.prob_away
       or new.predicted_home_goals is distinct from old.predicted_home_goals
       or new.predicted_away_goals is distinct from old.predicted_away_goals
       or new.model_version     is distinct from old.model_version
       or new.source            is distinct from old.source
       or new.published_at      is distinct from old.published_at
       or new.locked_at         is distinct from old.locked_at
       or new.fixture_id        is distinct from old.fixture_id
       or new.id                is distinct from old.id
       or new.created_at        is distinct from old.created_at
    then
      raise exception
        'Prediction % is locked (locked_at=%); prob_*/predicted_*/model_version/source/published_at/locked_at/fixture_id/id/created_at are immutable (ARCHITECTURE.md §7).',
        old.id, old.locked_at
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger predictions_enforce_immutability
  before update on public.predictions
  for each row
  execute function public.enforce_prediction_immutability();

-- ============================================================================
-- Row Level Security (ARCHITECTURE.md §7)
-- ============================================================================
-- The anon/public role is read-only. There are NO write policies for anon /
-- authenticated, so inserts/updates/deletes by those roles are denied. The
-- service role bypasses RLS and is the only writer (used by the Python jobs).

alter table public.leagues     enable row level security;
alter table public.teams       enable row level security;
alter table public.fixtures    enable row level security;
alter table public.predictions enable row level security;

create policy "Public read leagues"
  on public.leagues for select to anon, authenticated using (true);
create policy "Public read teams"
  on public.teams for select to anon, authenticated using (true);
create policy "Public read fixtures"
  on public.fixtures for select to anon, authenticated using (true);
create policy "Public read predictions"
  on public.predictions for select to anon, authenticated using (true);

-- Explicit, self-documenting privileges (belt-and-suspenders alongside RLS).
grant select on public.leagues, public.teams, public.fixtures, public.predictions
  to anon, authenticated;
grant all on public.leagues, public.teams, public.fixtures, public.predictions
  to service_role;
grant usage, select on all sequences in schema public to service_role;
