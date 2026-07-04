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
| `elo.py` | In-house team-rating Elo baseline + `ratings_from_results` replay (§9); v3 W5 adds `expected_goals`/`clean_sheet_probability`/`team_snapshot_metrics` (Poisson clean-sheet + continuous expected-goals estimates for `snapshot_probabilities.py`). `ratings_from_results` takes an optional `initial_ratings` map so a replay can start teams from a pre-tournament prior instead of a shared cold-start default (see `seed_ratings.py`). |
| `narrative.py` | **New (migration 0009, improvement #6).** `build_free_narrative()` — a pure, deterministic, template-based ≤2-sentence "what's driving this call" summary from H/D/A probabilities + the SAME curated `comparison`/`h2h_summary` signals already stored in `fixture_insights(kind='prediction_detail')`. No API call, no LLM/free-text generation. Shared by `fetch_predictions.py` (going forward) and `backfill_narratives.py` (existing rows). |
| `seed_ratings.py` | **v3 W7 hardening.** Static, in-repo (NOT API-fetched) pre-tournament Elo priors per team, keyed by the stable API-Football `api_team_id`. Fixes a diagnosed bug where every team cold-started at the same Elo default, so 2-3 replayed group games couldn't tell an elite side from a mid-table host — used ONLY to seed `simulate_chances.py`'s own replay, never the publicly displayed prediction (§9). |
| `fetch_fixtures.py` | **Daily.** Upsert leagues/teams/fixtures keyed on `api_fixture_id`, one tracked league at a time (§8.1). Also normalises + stores each fixture's `round`/`api_round` and its `winner_team_id` (migration 0007) — see below. |
| `fetch_predictions.py` | **Daily.** One `/predictions` fetch per fixture within a kickoff window (once, ever) + logged Elo (§8.2, §9). Also stores a curated `fixture_insights` (`kind='prediction_detail'`) row from that SAME response for a newly-fetched prediction (v2 §4/§7, migration 0004) — never a second call. Also derives + stores the free `predictions.narrative` (improvement #6, migration 0009) from that SAME response, for the api-football row only. |
| `lock_predictions.py` | **Frequent.** Lock at kickoff; `unlocked_void` for late predictions (§8.3, §10). |
| `score_results.py` | **Frequent around match end.** Scores the self-draining `locked` set via `scoring.py` (§8.4, §10). |
| `fetch_insights.py` | **v2, new (suggested cadence: every 30–60 min).** One `/fixtures/statistics` fetch per finished+scored fixture without a `post_match_stats` insight yet (most-recently-finished first); curates xG/shots/possession/cards/passes per side into `fixture_insights` (migration 0004). Premium depth content — never the free ledger. |
| `fetch_topscorers.py` | **New (daily, e.g. 07:30 UTC).** One `/players/topscorers` fetch per tracked league; top 15 by rank, idempotent full-replace into `top_scorers` (migration 0005). **Public** data — same access class as `leagues`/`teams`/`fixtures`, not premium. |
| `score_user_predictions.py` | **v3 W5, new (every ~20 min).** DB-only, no API call. Scores locked "Beat the Model" user picks (`user_predictions`) via the same `scoring.brier_score` as the ledger, service-role-only; also publishes `fixture_pick_aggregates` (crowd-vs-model, no PII) for any newly-locked fixture with picks (migration 0006, ARCHITECTURE.md v3 §5). |
| `snapshot_probabilities.py` | **v3 W5, new (nightly, e.g. 05:45 UTC).** DB-only, no API call. Per-team Elo-derived win/draw/loss, clean-sheet, and expected-goals snapshots for upcoming fixtures + day-over-day deltas, into `team_probability_snapshots` (migration 0006). **Public** data — powers the free Gameweek Board / Fixture Ticker, same access class as `top_scorers`. |
| `simulate_chances.py` | **v3 W7, new ("World Cup Chances", 06:30 + 22:15 UTC).** DB-only, no API call. Monte Carlo simulation (`config.MONTE_CARLO_SIMS`, default 10,000) of the remaining knockout bracket (`config.KNOCKOUT_ROUND_ORDER`), writing one `tournament_chances` row per surviving team per day (migration 0007, ROADMAP.md §4 item 7). **Public** data, same access class as `top_scorers`. Prices every not-yet-decided match from its own `seed_ratings.py`-seeded Elo only — deliberately does NOT consult a fixture's stored third-party prediction (see the module docstring's "Why Elo, seeded" for the diagnosed host-nation-outranks-elites bug this fixes). |
| `ledger_integrity.py` | **v3, new ("Ledger integrity ops", nightly 03:30 UTC).** DB + Supabase Storage only, no API call. Nightly private full-table backup export (bucket `config.LEDGER_BACKUPS_BUCKET`, get-or-create + verified non-public every run) + a publicly-verifiable SHA-256 hash chain over the scored ledger, upserted into `ledger_checkpoints` (migration 0007, ROADMAP.md §4 item 5). |
| `compute_leaderboard.py` | **New (improvement #5, suggested cadence: every ~20–30 min alongside `score_user_predictions.py`).** DB-only, no API call. For every opted-in (`profiles.leaderboard_opt_in=true`) user with ≥1 scored "Beat the Model" pick: mean Brier (user) vs mean Brier (model, same fixtures) → `beat_margin`, ranked desc. Idempotent full-replace into `leaderboard_standings` (migration 0009). **Public** data — anon-readable, contains ONLY opted-in users' display name + record. |
| `backfill_narratives.py` | **One-off (migration 0009, improvement #6) — not in `scheduler.yml`.** DB-only, no API call. Derives `predictions.narrative` for EXISTING `api-football` rows purely from already-stored data (fixtures/teams + `fixture_insights`). Idempotent/self-draining (`narrative IS NULL`); run manually once, safe to re-run. |
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
  left in permanent limbo. Also normalises the raw `league.round` string
  (`normalize_round()` — confirmed live against both the in-progress WC 2026
  season and the completed 2022 season for the full knockout ladder) into
  `fixtures.round`, keeps the raw value in `fixtures.api_round`, and stores
  `fixtures.winner_team_id` from the API's own `teams.home/away.winner` flag
  — the DEFINITIVE match winner, not derivable from the final score alone for
  a match decided by extra time/penalties (migration 0007; feeds
  `simulate_chances`' bracket progression, at zero extra API cost since it's
  the SAME `/fixtures` payload already being fetched). Also stores the live
  match clock (migration 0011): `fixtures.status_short` (the raw, granular
  `fixture.status.short` code — `1H`/`HT`/`2H`/`ET`/`BT`/`P`/`FT`/`AET`/`PEN`/
  `PST`/`CANC`, alongside the coarse `status` enum), `fixtures.elapsed_minute`
  (`fixture.status.elapsed`), and `fixtures.elapsed_extra_minute`
  (`fixture.status.extra`, added/stoppage time) — all three off the SAME
  `/fixtures` response, null whenever the provider omits them (not
  started/finished/no stoppage). Zero extra API cost.
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
- **`simulate_chances`** (v3 W7, 06:30 + 22:15 UTC) — DB-only, no API call.
  Reads every fixture whose normalised `round` (see `fetch_fixtures` below)
  is in `config.KNOCKOUT_ROUND_ORDER` (`['Round of 32', 'Round of 16',
  'Quarter-finals', 'Semi-finals', 'Final']`), scoped to the tracked
  league(s)/season. Runs `config.MONTE_CARLO_SIMS` (default 10,000)
  independent trials, each resolving the ENTIRE remaining bracket in one
  pass: an already-`finished` fixture uses its TRUE outcome
  (`fixtures.winner_team_id`, migration 0007 — correctly captures a match
  decided by extra time/penalties, unlike the final score alone); a
  not-yet-played KNOWN fixture samples from this job's own
  `seed_ratings.py`-seeded Elo probability ONLY — it deliberately never
  consults a fixture's stored `api-football` prediction (see the module
  docstring's "Why Elo, seeded" for the diagnosed bug this fixes: a
  prior-less Elo replay plus API-Football's coarse, home-biased `percent`
  buckets used to rank host Mexico above elite sides like England); a
  round-slot the data provider hasn't published yet is filled in by pairing
  that round's un-paired survivors ourselves, in kickoff order (a documented
  approximation of the true FIFA bracket — see the module docstring's
  "Bracket-derivation convention"). A sampled knockout draw is resolved by a
  strength-weighted coin (the "extra time/penalties" convention — see the
  module docstring). Writes one `tournament_chances` row per SURVIVING team
  (every knockout participant minus anyone already eliminated by a finished
  match — ground truth, never simulated) per day, upserted on the table's
  `(snapshot_date, team_id)` PK (migration 0007). Deterministic with a fixed
  `seed=` kwarg (tests); the live default draws from system entropy. Public
  data, same access class as `top_scorers`. **Known v1 limitation:** assumes
  its earliest present knockout round is already fully populated with real
  fixtures — group-stage-to-knockout qualification is not itself simulated
  (see the module docstring).
- **`ledger_integrity`** (v3, nightly 03:30 UTC) — DB + Supabase Storage
  only, no API call. Two independent passes: (1) full-table JSON snapshots of
  `ledger_integrity.BACKUP_TABLES` (football data + the public/game-derived
  surface — deliberately excludes personal/billing tables, which already
  have their own systems of record) written to the PRIVATE `ledger-backups`
  Storage bucket (`config.LEDGER_BACKUPS_BUCKET`), created idempotently and
  verified non-public every run (`SupabaseStore.ensure_private_backup_bucket`
  — raises loudly rather than silently exporting into a bucket that turned
  out public); (2) every `status='scored'` prediction, ordered by
  `(scored_at, id)`, is folded into a SHA-256 hash chain
  (`chain_hash_i = sha256(chain_hash_{i-1} + canonical_json(row_i))`,
  recomputed FRESH from the full scored set every run — safe because scored
  rows are frozen by the migration 0001/0003 immutability trigger), and
  today's tip is upserted into `ledger_checkpoints` (migration 0007) — the
  public, anon-readable verifiability artifact a third party can use to
  confirm the ledger was never rewritten, reproducible from `public.predictions`
  alone (see the module docstring's exact canonicalisation rule).
- **`compute_leaderboard`** (improvement #5, migration 0009) — DB-only, no API
  call. For every `profiles` row with `leaderboard_opt_in=true` and ≥1 scored
  `user_predictions` pick: pulls the model's own SCORED `api-football` Brier
  score for the SAME set of fixtures the user has scored picks on (excluding
  any fixture the model hasn't scored yet — nothing to compare against, not a
  filter on the user's own result), computes `beat_margin = model_mean_brier
  - user_mean_brier`, and ranks desc. REPLACES `leaderboard_standings` wholesale
  every run (upsert-then-prune, mirrors `fetch_topscorers.py`'s
  `replace_top_scorers`). A user with no `leaderboard_display_name` set gets an
  anonymised `"Player <uuid prefix>"` label — never an email or other PII.
- **`backfill_narratives`** (improvement #6, migration 0009, **one-off — not
  in `scheduler.yml`**) — DB-only, no API call. For every existing
  `source='api-football'` prediction with `narrative IS NULL`: joins its
  fixture's team names plus its stored `fixture_insights(kind='prediction_detail')`
  payload (if any) and derives the SAME `jobs.narrative.build_free_narrative()`
  summary `fetch_predictions.py` now writes inline for new rows. Self-draining
  (`narrative IS NULL`) — safe to run manually more than once; nothing to do on
  a re-run once every row is caught up.

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
| `SUPABASE_SECRET_KEY` | **Secret.** Supabase secret key (`sb_secret_…`) — bypasses RLS; server-side only. Also used for Supabase Storage (`ledger_integrity.py`'s backup export) — the same secret-key client, no separate credential. |
| `API_FOOTBALL_KEY` | **Secret.** API-Football (API-Sports) key. |
| `MONTE_CARLO_SIMS` | *Optional.* Trial count for `simulate_chances.py`. Default `10000`. |
| `LEDGER_BACKUPS_BUCKET` | *Optional.* Private Storage bucket name for `ledger_integrity.py`'s backup export. Default `ledger-backups`. |

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
python -m jobs.simulate_chances --dry-run          # DB-only — no API call either way
python -m jobs.ledger_integrity --dry-run          # DB + Storage only — no API call either way (dry-run skips both writes)
python -m jobs.compute_leaderboard --dry-run       # DB-only — no API call either way
python -m jobs.backfill_narratives --dry-run       # DB-only — no API call either way; one-off, safe to re-run

# for real (writes to the DB)
python -m jobs.fetch_fixtures        # daily
python -m jobs.fetch_predictions     # daily
python -m jobs.lock_predictions      # every ~10-15 min
python -m jobs.score_results         # frequently around match end
python -m jobs.fetch_insights        # v2 — every ~30-60 min (suggested; not yet in scheduler.yml)
python -m jobs.fetch_topscorers      # daily (scheduler.yml: 07:30 UTC)
python -m jobs.score_user_predictions # v3 W5 — every ~20 min (scheduler.yml)
python -m jobs.snapshot_probabilities # v3 W5 — nightly (scheduler.yml: 05:45 UTC)
python -m jobs.simulate_chances       # v3 W7 — twice daily (scheduler.yml: 06:30 + 22:15 UTC)
python -m jobs.ledger_integrity       # v3 — nightly (scheduler.yml: 03:30 UTC)
python -m jobs.compute_leaderboard    # new — suggested every ~20-30 min (not yet in scheduler.yml)
python -m jobs.backfill_narratives    # one-off — run manually once, then not needed again
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
The website never calls the API. `simulate_chances.py`, `ledger_integrity.py`,
`compute_leaderboard.py`, and `backfill_narratives.py` are all DB-only
(`ledger_integrity.py` also writes to Supabase Storage) — none of them ever
touches the football API, so none ever spends any of the 100/day budget,
however often (or, for the one-off backfill, however rarely) they run.

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
