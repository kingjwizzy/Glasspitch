-- Glass Pitch — World Cup Chances + email capture + ledger integrity ops
-- (extends 0001 -> 0002 -> 0003 -> 0004 -> 0005 -> 0006). Must apply cleanly,
-- in order, on a FRESH database and on the already-provisioned live project.
-- Validated on a scratch local Postgres 16 cluster (roles anon/authenticated/
-- service_role + stub auth.users/auth.uid()/extensions.pgcrypto, mirroring
-- this repo's 0003-0006 convention) with as-role SELECT/INSERT proofs for
-- every new table -- see the backend-jobs session notes for the exact log.
--
-- ARCHITECTURE.md v3 amendments this migration backs (ROADMAP.md §4 items
-- 5 + 7):
--   "World Cup Chances" (item 7)     -- jobs/simulate_chances.py, a DB-only
--                                        Monte Carlo tournament simulation.
--   "Ledger integrity ops" (item 5)  -- jobs/ledger_integrity.py, nightly
--                                        private backups + a public SHA-256
--                                        hash chain over the scored ledger.
--   "Email capture" (v3 amendment)   -- the dedicated server-only route
--                                        handler writer (the third narrow
--                                        writer alongside the Stripe webhook
--                                        and game-picks paths, ARCHITECTURE.md
--                                        §5).
--
-- This migration:
--   (a) Extends `fixtures` with `round`/`api_round` (bracket/round-of-32..
--       final tracking for the WC Chances sim) AND `winner_team_id` -- see the
--       note below; NOT part of the original task list, added here with full
--       justification because the sim cannot be correct without it.
--   (b) Adds `tournament_chances` -- the WC Chances snapshot table. PUBLIC
--       data (top_scorers/team_probability_snapshots posture): anon +
--       authenticated SELECT, service role writes. THIS IS A FIXED CONTRACT a
--       concurrent frontend workflow is building against -- column
--       names/types/nullability/PK exactly as specified, no renames.
--   (c) Adds `email_subscribers` -- the double-opt-in mailing list backing
--       the v3 email-capture writer. ZERO anon/authenticated access of any
--       kind (not even SELECT) -- only the server-only route handler's
--       service-role client and the jobs ever touch it.
--   (d) Adds `ledger_checkpoints` -- the public, verifiable spine of the
--       nightly SHA-256 hash chain over the scored ledger. Anon +
--       authenticated SELECT (it's the whole point -- a third party verifies
--       the record was never rewritten); written by jobs/ledger_integrity.py
--       only.
--
-- (a) winner_team_id -- WHY beyond the task's literal column list:
-- API-Football's `/fixtures` response carries the DEFINITIVE match winner as
-- `teams.home.winner` / `teams.away.winner` (true/false/null) -- a SEPARATE
-- signal from `goals`/`score.fulltime`, which is the NORMAL-TIME score only.
-- Verified live 2026-07-03 against the actual WC 2026 feed: fixture 1565176
-- (Germany v Paraguay, Round of 32) finished `score.fulltime: {home:1,
-- away:1}` (a 90-minute draw) but `score.penalty: {home:3, away:4}` and
-- `teams.away.winner: true` -- Paraguay advanced on penalties. Our own
-- `final_home_goals`/`final_away_goals` deliberately stay the 90-minute score
-- (correct and unchanged -- the ledger's H/D/A prediction market is a
-- standard 90-minute 1X2 market, ARCHITECTURE.md §9/§10), which means a
-- knockout bracket simulator CANNOT derive "who actually advanced" from
-- final_home_goals/final_away_goals alone for any match decided by extra
-- time or penalties -- roughly 1 in 7 of the FIRST round of WC 2026 knockout
-- fixtures, in the live data checked. jobs/simulate_chances.py needs the true
-- winner to treat an ALREADY-DECIDED shootout as a certainty (not a 50/50
-- coin flip) when tracing who is still alive. This column is populated by
-- jobs/fetch_fixtures.py from data it ALREADY fetches every run (zero extra
-- API cost) -- see that module's `_parse_winner_team_id`. Null for a
-- genuine draw (group-stage fixtures, which are never resolved by
-- ET/penalties) or a not-yet-decided match.

-- ============================================================================
-- (a) fixtures: round / api_round / winner_team_id
-- ============================================================================
-- Nullable, no backfill here -- jobs/fetch_fixtures.py backfills `round`/
-- `api_round`/`winner_team_id` for every fixture it upserts from now on
-- (existing rows stay null until their next fetch_fixtures sweep, which is
-- every 6h per scheduler.yml -- effectively immediate).

alter table public.fixtures
  add column round           text,
  add column api_round       text,
  add column winner_team_id  bigint references public.teams (id);

comment on column public.fixtures.round is
  'Normalised round label (jobs/fetch_fixtures.py''s normalize_round()), e.g. ''Round of 32''/''Round of 16''/''Quarter-finals''/''Semi-finals''/''3rd Place Final''/''Final'' for a FIFA World Cup, or a group-stage/club-football round string passed through as-is. Drives jobs/simulate_chances.py''s bracket progression (ROADMAP.md §4 item 7). Null until the fixture''s next fetch_fixtures sweep backfills it.';
comment on column public.fixtures.api_round is
  'Raw, UNNORMALISED API-Football league.round string, kept alongside `round` for debugging/audit (e.g. spotting a new spelling variant normalize_round() doesn''t recognise yet).';
comment on column public.fixtures.winner_team_id is
  'The API''s own definitive match-winner flag (teams.home/away.winner), NOT derivable from final_home_goals/final_away_goals alone for a knockout match decided by extra time or penalties (see this migration''s header comment). Null for a genuine draw (only possible outside the knockout stage) or a not-yet-decided fixture. Populated by jobs/fetch_fixtures.py from the SAME /fixtures payload it already fetches -- zero extra API cost.';

create index idx_fixtures_round        on public.fixtures (round);
create index idx_fixtures_winner_team  on public.fixtures (winner_team_id);

-- ============================================================================
-- (b) tournament_chances -- World Cup Chances Monte Carlo snapshots
-- ============================================================================
-- Written by jobs/simulate_chances.py (DB-only -- no football-API call): one
-- row per SURVIVING team per snapshot_date (a team eliminated by an
-- already-FINISHED knockout match gets no row that day -- see that job's
-- module docstring for exactly how "surviving" is derived). PUBLIC data, same
-- access class as top_scorers / team_probability_snapshots -- anon/
-- authenticated read, service role writes. THIS EXACT CONTRACT: a concurrent
-- frontend workflow is building the homepage "chances circles" + /chances
-- page against these column names/types/nullability -- do not rename.

create table public.tournament_chances (
  snapshot_date     date        not null,
  team_id           bigint      not null references public.teams (id) on delete cascade,
  p_win_tournament  numeric     not null check (p_win_tournament >= 0 and p_win_tournament <= 1),
  p_reach_final     numeric     check (p_reach_final is null or (p_reach_final >= 0 and p_reach_final <= 1)),
  p_reach_semi      numeric     check (p_reach_semi is null or (p_reach_semi >= 0 and p_reach_semi <= 1)),
  sims              integer     not null check (sims > 0),
  computed_at       timestamptz not null default now(),
  primary key (snapshot_date, team_id)
);

comment on table public.tournament_chances is
  'World Cup Chances: one row per surviving team per day (ARCHITECTURE.md v3, ROADMAP.md §4 item 7), written by jobs/simulate_chances.py -- a DB-only Monte Carlo simulation of the remaining knockout bracket (config.MONTE_CARLO_SIMS trials, default 10,000; see that module for the exact sampling/bracket-derivation convention). PUBLIC data, same access class as top_scorers/team_probability_snapshots -- anon/authenticated read, service role writes. p_reach_final/p_reach_semi are nullable in the schema but the job always computes a number (0..1) for every round in its canonical order, so a null in practice only means "not yet simulated today".';
comment on column public.tournament_chances.sims is
  'Monte Carlo trial count for this row''s snapshot (jobs.config.MONTE_CARLO_SIMS at run time) -- lets a reader judge the noise floor, same "show the sample size" ethos as the prediction ledger (ARCHITECTURE.md §10).';

create index idx_tournament_chances_date on public.tournament_chances (snapshot_date);
create index idx_tournament_chances_team on public.tournament_chances (team_id, snapshot_date desc);

alter table public.tournament_chances enable row level security;

create policy "Public read tournament chances"
  on public.tournament_chances for select to anon, authenticated using (true);

grant select on public.tournament_chances to anon, authenticated;
grant all on public.tournament_chances to service_role;

-- ============================================================================
-- (c) email_subscribers -- double-opt-in mailing list (v3 email-capture writer)
-- ============================================================================
-- Written by the dedicated server-only route handler (ARCHITECTURE.md §5 v3
-- amendment: "a dedicated server-only route handler may write
-- email_subscribers ... the third narrow writer alongside the Stripe webhook
-- and game-picks paths") over its OWN service-role client -- never the
-- publishable-key client, so there is deliberately NO RLS write policy for
-- anon/authenticated here at all, mirroring stripe_events' posture (migration
-- 0004) exactly: zero anon/authenticated access, not even SELECT. Email
-- addresses are personal data (§13) -- there is no legitimate reason for the
-- public/anon role, or another user's authenticated session, to ever read
-- this table.

create table public.email_subscribers (
  id                 uuid        primary key default gen_random_uuid(),
  email              text        not null unique check (position('@' in email) > 1),
  confirm_token      uuid        not null default gen_random_uuid(),
  confirmed_at       timestamptz,
  unsubscribe_token  uuid        not null default gen_random_uuid(),
  consented_at       timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

comment on table public.email_subscribers is
  'Double-opt-in mailing list (ARCHITECTURE.md v3 email-capture amendment, ROADMAP.md §4 item 4). Written EXCLUSIVELY by the server-only email-capture route handler''s service-role client (confirm_token / unsubscribe_token are single-use links for double opt-in + one-click unsubscribe respectively) -- there is deliberately NO anon/authenticated policy anywhere in this migration, not even SELECT (mirrors stripe_events'' posture, migration 0004). GDPR: consented_at records the moment of signup; confirmed_at stays null until the double-opt-in link is clicked.';
comment on column public.email_subscribers.confirm_token is
  'Single-use double-opt-in confirmation token, emailed to the address at signup. The route handler nulls this out or rotates it once confirmed (application-level convention -- no DB trigger enforces single-use).';
comment on column public.email_subscribers.unsubscribe_token is
  'Single-use one-click-unsubscribe token, included in every marketing send.';

alter table public.email_subscribers enable row level security;
-- No policies for anon/authenticated -> RLS denies all access by default.
-- Explicit belt-and-suspenders on top of that default-deny (mirrors job_runs'
-- / stripe_events' posture exactly):
revoke all on public.email_subscribers from anon, authenticated;

grant all on public.email_subscribers to service_role;

-- ============================================================================
-- (d) ledger_checkpoints -- public SHA-256 hash-chain spine (ledger integrity ops)
-- ============================================================================
-- Written by jobs/ledger_integrity.py only (nightly). PUBLIC read -- this
-- table IS the verifiability artifact (ARCHITECTURE.md v3 "Ledger integrity
-- ops" amendment: "a SHA-256 hash chain over scored ledger rows is published
-- publicly so third parties can verify the record was never rewritten"). See
-- that module's docstring for the exact canonicalisation + chaining rule so a
-- third party can reproduce chain_hash independently from the (already
-- public, anon-readable) `predictions` table alone.

create table public.ledger_checkpoints (
  id           bigint      generated always as identity primary key,
  day          date        not null unique,
  scored_rows  integer     not null,
  chain_hash   text        not null,
  prev_hash    text,
  created_at   timestamptz not null default now()
);

comment on table public.ledger_checkpoints is
  'Public, verifiable spine of the nightly SHA-256 hash chain over every SCORED prediction, ordered by (scored_at, id) (ARCHITECTURE.md v3 ledger-integrity-ops amendment, ROADMAP.md §4 item 5, jobs/ledger_integrity.py). chain_hash is the chain''s current tip (recomputed FRESH from the full scored set every run -- safe and deterministic because scored predictions are frozen by the migration 0001/0003 immutability trigger, so a re-run only ever appends to the tail). prev_hash is the PRIOR calendar day''s chain_hash (a quick day-over-day sanity link; the full proof is re-deriving chain_hash from public.predictions directly, not trusting this column). scored_rows is the CUMULATIVE count of scored predictions folded into chain_hash as of this day. Anon/authenticated read (the whole point); service role writes only.';
comment on column public.ledger_checkpoints.prev_hash is
  'The immediately-preceding calendar day''s ledger_checkpoints.chain_hash (null on the very first checkpoint ever written). A day-over-day continuity link, not itself part of the SHA-256 folding rule (which chains over PREDICTION ROWS, not over days -- see jobs/ledger_integrity.py).';

create index idx_ledger_checkpoints_day on public.ledger_checkpoints (day desc);

alter table public.ledger_checkpoints enable row level security;

create policy "Public read ledger checkpoints"
  on public.ledger_checkpoints for select to anon, authenticated using (true);

grant select on public.ledger_checkpoints to anon, authenticated;
grant all on public.ledger_checkpoints to service_role;
