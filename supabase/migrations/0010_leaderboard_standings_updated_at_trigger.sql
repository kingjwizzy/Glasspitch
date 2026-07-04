-- Glass Pitch — small additive fix to 0009_email_throttle_leaderboard_narrative.sql.
--
-- 0009 gave `leaderboard_standings` an `updated_at timestamptz not null
-- default now()` column but -- unlike every OTHER table in this repo with an
-- `updated_at` column (fixtures, subscriptions, top_scorers, user_predictions,
-- fixture_pick_aggregates) -- never wired up the matching `set_updated_at()`
-- trigger. `default now()` only populates the column on INSERT; on the
-- UPDATE branch of jobs/compute_leaderboard.py's upsert (a user whose row
-- already existed from a prior run), `updated_at` would otherwise stay frozen
-- at whatever it was on first insert forever -- a real staleness bug for a
-- column whose whole purpose is "when was this standing last (re)computed".
--
-- Purely additive: reuses the EXISTING public.set_updated_at() function
-- (migration 0001, hardened 0002) -- no new function, no application code
-- change needed (jobs/compute_leaderboard.py's upsert payload doesn't set
-- updated_at itself; the trigger now does it on every UPDATE, matching the
-- DEFAULT's behaviour on INSERT).

create trigger leaderboard_standings_set_updated_at
  before update on public.leaderboard_standings
  for each row
  execute function public.set_updated_at();
