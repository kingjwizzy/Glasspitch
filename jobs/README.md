# Glass Pitch — Python jobs

Scheduled jobs that feed the database. **These jobs are the only part of the
system that talks to the football API, and the only part that writes to the
database** (ARCHITECTURE.md §5, §6). The website only ever *reads* from
Postgres — it never calls the API per visitor.

```
API-Football ──▶ Python jobs ──▶ Supabase (write) ──▶ Next.js (read) ──▶ visitor
```

Run jobs as modules **from the repo root**, e.g. `python -m jobs.fetch_fixtures`.

## Modules

| File | Purpose |
|---|---|
| `config.py` | Tracked leagues (`[1]` = FIFA World Cup), season (`2026`), API base URL + auth header (one-line RapidAPI switch), request timeout, per-run request budget, prediction-fetch kickoff window, postponed-void horizon. |
| `apiclient.py` | API-Football HTTP client: auth, timeout, retry-with-backoff, request counting + budget guard, multi-page `/fixtures` support (§8). |
| `db.py` | Supabase **secret-key** client + `SupabaseStore` (idempotent upserts keyed on `api_*` ids; the only writer; every list read is paginated past PostgREST's 1000-row cap). |
| `util.py` | `slugify`, UTC datetime helpers. |
| `scoring.py` | Multiclass Brier score + clipped log loss (§10). |
| `elo.py` | In-house team-rating Elo baseline + `ratings_from_results` replay (§9); v3 W5 adds `expected_goals`/`clean_sheet_probability`/`team_snapshot_metrics` (Poisson clean-sheet + continuous expected-goals estimates for `snapshot_probabilities.py`). |
| `fetch_fixtures.py` | **Daily.** Upsert leagues/teams/fixtures keyed on `api_fixture_id`, one tracked league at a time (§8.1). |
| `fetch_predictions.py` | **Daily.** One `/predictions` fetch per fixture within a kickoff window (once, ever) + logged Elo (§8.2, §9). Also stores a curated `fixture_insights` (`kind='prediction_detail'`) row from that SAME response for a newly-fetched prediction (v2 §4/§7, migration 0004) — never a second call. |
| `lock_predictions.py` | **Frequent.** Lock at kickoff; `unlocked_void` for late predictions (§8.3, §10). |
| `score_results.py` | **Frequent around match end.** Scores the self-draining `locked` set via `scoring.py` (§8.4, §10). |
| `fetch_insights.py` | **v2, new (suggested cadence: every 30–60 min).** One `/fixtures/statistics` fetch per finished+scored fixture without a `post_match_stats` insight yet (most-recently-finished first); curates xG/shots/possession/cards/passes per side into `fixture_insights` (migration 0004). Premium depth content — never the free ledger. |
| `fetch_topscorers.py` | **New (daily, e.g. 07:30 UTC).** One `/players/topscorers` fetch per tracked league; top 15 by rank, idempotent full-replace into `top_scorers` (migration 0005). **Public** data — same access class as `leagues`/`teams`/`fixtures`, not premium. |
| `score_user_predictions.py` | **v3 W5, new (every ~20 min).** DB-only, no API call. Scores locked "Beat the Model" user picks (`user_predictions`) via the same `scoring.brier_score` as the ledger, service-role-only; also publishes `fixture_pick_aggregates` (crowd-vs-model, no PII) for any newly-locked fixture with picks (migration 0006, ARCHITECTURE.md v3 §5). |
| `snapshot_probabilities.py` | **v3 W5, new (nightly, e.g. 05:45 UTC).** DB-only, no API call. Per-team Elo-derived win/draw/loss, clean-sheet, and expected-goals snapshots for upcoming fixtures + day-over-day deltas, into `team_probability_snapshots` (migration 0006). **Public** data — powers the free Gameweek Board / Fixture Ticker, same access class as `top_scorers`. |
| `cli.py` | Shared `--dry-run`/`-v` CLI wrapper; always logs a summary (even on a crash) and writes a `job_runs` row for every LIVE run (migration 0003). |
| `reset_season.py` / `seed_predictions_dev.py` | Dev-only tooling (§ below); season-scoped, live-season interlocked. |

## What each job does

- **`fetch_fixtures`** — `GET /fixtures?league={id}&season={SEASON}` per tracked
  league (looping through every page API-Football returns); maps the API status
  to `scheduled`/`live`/`finished`/`postponed`, stores kickoff in UTC and the
  final score when finished, and upserts the league, both teams (plain names,
  no crests) and the fixture, keyed on the `api_*` ids. Idempotent — safe to
  re-run. Each tracked league is fetched-then-written independently, so one
  league failing doesn't discard fixtures already written for another. A
  kickoff-time change on an existing fixture resyncs (or, if the new kickoff
  has already passed, voids) its still-`published` predictions'
  `locked_at`. A fixture that turns out cancelled/abandoned, or has sat
  `postponed` past `config.POSTPONED_VOID_HORIZON_DAYS` with no reschedule, has
  its still-open predictions closed out as `void_cancelled` — no ledger row is
  left in permanent limbo.
- **`fetch_predictions`** — for each fixture kicking off within
  `config.PREDICTION_FETCH_WINDOW_HOURS` (default 72h) with no `api-football`
  prediction yet: `GET /predictions?fixture={id}` **exactly once**, parse the
  H/D/A percentages, normalise them to sum to exactly 1.0, derive a predicted
  scoreline, and insert a `published` prediction (`locked_at` = kickoff,
  `published_at` stamped fresh per insert). Alongside it, insert the in-house
  Elo prediction (`elo-v1`, logged-only), scoped to the tracked league(s) +
  season. The two passes are decoupled: the API-Football fetch is isolated per
  fixture (one bad fixture logs + continues; hitting the request budget ends
  that pass early and gracefully) and the Elo pass always runs for every
  fixture in the window regardless, since it makes no API call. Empty
  third-party predictions are skipped + logged (never a crash).
- **`lock_predictions`** — for every `published` prediction whose `locked_at`
  has passed: `locked` if it was published before kickoff; `unlocked_void` if it
  was published after kickoff (integrity over coverage — excluded from scoring).
- **`score_results`** — queries `locked` predictions whose fixture is already
  `finished` (a small, self-draining set — not a rescan of every finished
  fixture ever), copies the final score, sets the result, computes
  `brier_score` + `log_loss`, sets `scored`. Idempotent (a `scored` prediction
  never reappears in that query). Also logs loudly (never rewrites) any already
  -`scored` prediction whose fixture's final score has since changed — a data
  -provider correction. Re-derives Elo ratings from results on the next
  `fetch_predictions` run.
- **`fetch_insights`** (v2) — `db.fixtures_needing_stats` returns finished,
  tracked-league(s)/season fixtures that already have a **scored**
  api-football prediction but no `post_match_stats` insight yet, ordered
  most-recently-finished first. For each: `GET /fixtures/statistics?fixture={id}`
  **exactly once**, curate xG/shots/possession/cards/passes per side (dropping
  anything not in the curated key map — never a raw provider dump), and
  `insert_insight` (idempotent upsert keyed on `(fixture_id, kind)`). A
  fixture with no statistics yet from the provider is skipped and retried next
  run. Isolated per fixture like `fetch_predictions`' API pass (one bad fixture
  logs + continues; `RequestBudgetExceeded` ends the run early and gracefully).
- **`fetch_topscorers`** — for each tracked league (`config.TRACKED_LEAGUE_IDS`):
  resolves the internal `leagues.id` for that `api_league_id` first (a league
  `fetch_fixtures` hasn't synced yet is skipped with **no API call spent**),
  then `GET /players/topscorers?league={api_league_id}&season={SEASON}`
  **once per league per run**. Parses up to `config.TOP_SCORERS_LIMIT` (15)
  entries — `rank` is just the API's list order (already sorted by goals
  desc) — keeping only plain-text fields (`player_name`, `team_name`,
  `nationality`) plus `goals`/`assists`/`penalties`; the payload's player
  photo and team logo URLs are never read, let alone stored (§13). Writes via
  `db.replace_top_scorers`: an idempotent **upsert-then-prune** per league —
  every current row is upserted (keyed on `(league_id, api_player_id)`) before
  any row for a player who has fallen out of the top 15 is deleted, so the
  board is never observably empty mid-run. Unlike the predictions ledger,
  `top_scorers` has no immutability guarantee to protect, so pruning stale
  rows is safe. Isolated per league like `fetch_fixtures` (one bad league
  logs + continues; `RequestBudgetExceeded` ends the run early and
  gracefully).
- **`score_user_predictions`** (v3 W5) — DB-only, no API call. Pass 1: scores
  every `user_predictions` row with no `scored_at` yet whose fixture is
  already `finished` (a small, self-draining set, same shape as
  `score_results`' own query against the ledger), via the identical
  `scoring.brier_score` machinery — never a second scoring formula for the
  game. One malformed row is logged and skipped, never aborts the run for
  everyone else's picks. Pass 2: for any fixture that has locked (kickoff
  passed) with at least one pick but no `fixture_pick_aggregates` row yet,
  averages that fixture's picks into one aggregate row (`n_picks` +
  `avg_prob_home`/`draw`/`away`) — mirrors `user_predictions`' own
  anti-copying rule (never published pre-kickoff); once written, a fixture's
  aggregate never needs recomputing, since its pick set is frozen the moment
  it locks (migration 0006's write-window trigger).
- **`snapshot_probabilities`** (v3 W5, nightly) — DB-only, no API call. For
  every fixture kicking off within `config.SNAPSHOT_FIXTURE_WINDOW_HOURS`
  (default 14 days): replays Elo ratings from finished results (same method
  as `fetch_predictions`), computes `elo.team_snapshot_metrics()`
  (win/draw/loss, clean-sheet, continuous expected goals) for both sides, and
  writes two rows per fixture into `team_probability_snapshots`, keyed on
  `(snapshot_date, team_id, fixture_id)` — idempotent, safe to re-run same-day.
  Day-over-day deltas (`delta_elo_rating`, `delta_prob_win`) are computed once
  per run against a single bulk read of yesterday's snapshot set. Public data,
  same access class as `top_scorers` — powers the free Gameweek Board /
  Fixture Ticker.

## `--dry-run`

Every job accepts `--dry-run`: it does everything **except write to the
database** — it fetches, parses, and logs exactly what it *would* write. Use it
to preview a run safely.

> Note: `--dry-run` **still calls the football API** (and still reads the
> database), so it counts against your daily request budget.

## Setup

```bash
# from the repo root
python3 -m venv jobs/.venv
source jobs/.venv/bin/activate
pip install -r jobs/requirements-dev.txt   # runtime + pytest (use requirements.txt for runtime only)
cp jobs/.env.example jobs/.env             # then fill in the values (never commit jobs/.env)
```

### Environment variables (`jobs/.env`)

| Variable | What it is |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://YOUR-REF.supabase.co`). |
| `SUPABASE_SECRET_KEY` | **Secret.** Supabase secret key (`sb_secret_…`) — bypasses RLS; server-side only. |
| `API_FOOTBALL_KEY` | **Secret.** API-Football (API-Sports) key. |

## Running (from the repo root)

```bash
# preview first (no DB writes) — note: still calls the API
python -m jobs.fetch_fixtures --dry-run
python -m jobs.fetch_predictions --dry-run
python -m jobs.lock_predictions --dry-run
python -m jobs.score_results --dry-run
python -m jobs.fetch_insights --dry-run
python -m jobs.fetch_topscorers --dry-run
python -m jobs.score_user_predictions --dry-run   # DB-only — no API call either way
python -m jobs.snapshot_probabilities --dry-run    # DB-only — no API call either way

# for real (writes to the DB)
python -m jobs.fetch_fixtures        # daily
python -m jobs.fetch_predictions     # daily
python -m jobs.lock_predictions      # every ~10-15 min
python -m jobs.score_results         # frequently around match end
python -m jobs.fetch_insights        # v2 — every ~30-60 min (suggested; not yet in scheduler.yml)
python -m jobs.fetch_topscorers      # daily (scheduler.yml: 07:30 UTC)
python -m jobs.score_user_predictions # v3 W5 — every ~20 min (scheduler.yml)
python -m jobs.snapshot_probabilities # v3 W5 — nightly (scheduler.yml: 05:45 UTC)
```

Add `-v` for debug logging. Writes are idempotent (keyed on the `api_*` ids), so
re-running a job is safe (§5, §8).

## Rate-limit discipline (§8)

The free tier allows **100 requests/day**. `fetch_predictions` fetches each
fixture's prediction **exactly once** and never re-fetches a stored one;
`fetch_fixtures` makes one sweep per tracked league; `fetch_topscorers` makes
one `/players/topscorers` call per tracked league per run (a full-replace, so
it re-fetches daily by design — there's no "fetch once" for a leaderboard that
changes as the tournament progresses, but it's still bounded to one request
per tracked league). `apiclient.py` counts
requests and a per-run guard (`MAX_REQUESTS_PER_RUN`, default 100) refuses to
exceed the budget within a single run; the daily total stays low by the
fetch-once design, not by cross-run accounting. Each job's summary logs
`api_requests` so you can see how much budget a run (including `--dry-run`) spent.
The website never calls the API.

Switching to the **RapidAPI** distribution later is a one-line change in
`config.py` (`API_FOOTBALL_BASE_URL`, `API_FOOTBALL_AUTH_HEADER`, and the
RapidAPI host via `API_FOOTBALL_EXTRA_HEADERS`).

## Tests

Unit tests use mocked API responses and an in-memory store — **no network, no
database**. Run from the repo root:

```bash
python -m pytest          # uses pytest.ini (pythonpath=., testpaths=jobs/tests)
```

A separate, opt-in `integration` marker (registered in `pytest.ini`, excluded
from the default run) exercises a REAL local Postgres via the Supabase CLI —
`supabase start` + `supabase db reset` applies `supabase/migrations/` 0001→0003
from scratch, then `python -m pytest -m integration` runs the marked tests
against it (the trigger, CHECKs, RLS, and the `teardown_season` RPC are only
truly verified there — see `.github/workflows/ci.yml`'s `jobs-integration` job).

## Python version

Pin **3.12** (matches `.github/workflows/ci.yml` and `scheduler.yml`, and the
repo-root `.python-version`) — if your local `jobs/.venv` was created against a
different interpreter, recreate it against 3.12 to avoid stdlib-version drift
between local runs and CI/production.
