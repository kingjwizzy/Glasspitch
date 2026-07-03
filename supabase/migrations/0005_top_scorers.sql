-- Glass Pitch — top scorers migration (extends 0001_init_schema.sql ->
-- 0002_harden_function_search_path.sql -> 0003_harden_db.sql ->
-- 0004_premium.sql). Must apply cleanly, in order, on a FRESH database
-- (0001 -> 0002 -> 0003 -> 0004 -> 0005) and on the already-provisioned live
-- database.
--
-- Adds `public.top_scorers`: one row per (league, player) leaderboard entry,
-- written by the new jobs/fetch_topscorers.py (GET /players/topscorers, one
-- request per tracked league per run, idempotent full-replace per league --
-- see jobs/db.py's `replace_top_scorers`). This is PUBLIC data, the same
-- compliance/access class as `leagues`/`teams`/`fixtures` (ARCHITECTURE.md
-- §7/§13) -- NOT premium, NOT the ledger: anon/authenticated get a plain
-- SELECT policy, and only the service role (the jobs) may write.
--
-- Plain-text only (§13): `player_name`/`team_name`/`nationality` are text
-- fields sourced from the API's player/team NAME strings only -- the job that
-- populates this table never reads, and this table can never store, a player
-- photo or team crest/logo URL.
--
-- Grants: migration 0003(a) already revoked INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER from anon/authenticated's DEFAULT privileges in schema
-- public, so this brand-new table inherits that deny-by-default automatically
-- (no bespoke revoke needed here, unlike 0004's premium tables which had to
-- revoke ALL because they also don't want the default SELECT). What 0003's
-- default-privilege revoke does NOT cover is SELECT -- a stock Supabase
-- project's original default ACL still auto-grants that to anon/authenticated
-- on any new `public` table, but nothing here relies on that default either:
-- the SELECT grant below is explicit, mirroring 0001's "public read" tables.

-- ============================================================================
-- Table
-- ============================================================================

create table public.top_scorers (
  league_id     bigint      not null references public.leagues (id) on delete cascade,
  api_player_id bigint      not null,
  player_name   text        not null,   -- plain text only, no player photo (§13)
  team_name     text        not null,   -- plain text only, no team crest (§13)
  nationality   text,
  goals         integer     not null,
  assists       integer,
  penalties     integer,
  rank          integer     not null,
  updated_at    timestamptz not null default now(),
  primary key (league_id, api_player_id)
);

comment on table public.top_scorers is
  'Top-scorers leaderboard per league (ARCHITECTURE.md §8, jobs/fetch_topscorers.py) -- one /players/topscorers request per tracked league per run, top 15 by rank, idempotent full-replace via jobs/db.py''s replace_top_scorers (upsert current rows + prune anyone who has fallen out of the top N). PUBLIC data, same access class as leagues/teams/fixtures -- anon/authenticated read, service role writes. Plain text only: no photo/logo URL is ever stored (§13).';
comment on column public.top_scorers.rank is
  'List order from the API-Football response (already sorted by goals desc) -- 1 is the league''s top scorer.';

-- Keep updated_at fresh on every upsert, reusing 0001''s trigger function
-- (hardened with an empty search_path by 0002) -- no redefinition needed.
create trigger top_scorers_set_updated_at
  before update on public.top_scorers
  for each row
  execute function public.set_updated_at();

-- The jobs' + web's hot read path: "top scorers for league X, ordered by rank".
create index idx_top_scorers_league_rank on public.top_scorers (league_id, rank);

-- ============================================================================
-- Row Level Security (ARCHITECTURE.md §7) -- public data, mirrors 0001's
-- leagues/teams/fixtures posture exactly.
-- ============================================================================

alter table public.top_scorers enable row level security;

create policy "Public read top scorers"
  on public.top_scorers for select to anon, authenticated using (true);

-- Explicit, self-documenting privileges (belt-and-suspenders alongside RLS,
-- same convention as 0001 -- see header comment on why the DML side needs no
-- bespoke revoke here but SELECT is still spelled out explicitly).
grant select on public.top_scorers to anon, authenticated;
grant all on public.top_scorers to service_role;
