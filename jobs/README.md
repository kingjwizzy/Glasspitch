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
| `config.py` | Tracked leagues (`[1]` = FIFA World Cup), season (`2026`), API base URL + auth header (one-line RapidAPI switch), request timeout, per-run request budget. |
| `apiclient.py` | API-Football HTTP client: auth, timeout, retry-with-backoff, request counting + budget guard (§8). |
| `db.py` | Supabase **secret-key** client + `SupabaseStore` (idempotent upserts keyed on `api_*` ids; the only writer). |
| `util.py` | `slugify`, UTC datetime helpers. |
| `scoring.py` | Multiclass Brier score + clipped log loss (§10). |
| `elo.py` | In-house team-rating Elo baseline + `ratings_from_results` replay (§9). |
| `fetch_fixtures.py` | **Daily.** Upsert leagues/teams/fixtures keyed on `api_fixture_id` (§8.1). |
| `fetch_predictions.py` | **Daily.** One `/predictions` fetch per fixture (once, ever) + logged Elo (§8.2, §9). |
| `lock_predictions.py` | **Frequent.** Lock at kickoff; `unlocked_void` for late predictions (§8.3, §10). |
| `score_results.py` | **Frequent around match end.** Score finished fixtures via `scoring.py` (§8.4, §10). |

## What each job does

- **`fetch_fixtures`** — `GET /fixtures?league={id}&season={SEASON}` per tracked
  league; maps the API status to `scheduled`/`live`/`finished`/`postponed`,
  stores kickoff in UTC and the final score when finished, and upserts the
  league, both teams (plain names, no crests) and the fixture, keyed on the
  `api_*` ids. Idempotent — safe to re-run.
- **`fetch_predictions`** — for each upcoming fixture with no `api-football`
  prediction yet: `GET /predictions?fixture={id}` **exactly once**, parse the
  H/D/A percentages, normalise them to sum to exactly 1.0, derive a predicted
  scoreline, and insert a `published` prediction (`locked_at` = kickoff).
  Alongside it, insert the in-house Elo prediction (`elo-v1`, logged-only). Empty
  third-party predictions are skipped + logged (never a crash). The Elo
  cold-starts from a default rating; team ratings are **derived** by replaying
  finished fixtures (no separate ratings table yet — §9).
- **`lock_predictions`** — for every `published` prediction whose `locked_at`
  has passed: `locked` if it was published before kickoff; `unlocked_void` if it
  was published after kickoff (integrity over coverage — excluded from scoring).
- **`score_results`** — for each finished fixture, score its `locked`,
  not-yet-`scored` predictions: copy the final score, set the result, compute
  `brier_score` + `log_loss`, set `scored`. Idempotent (already-`scored` rows are
  skipped). Re-derives Elo ratings from results.

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

# for real (writes to the DB)
python -m jobs.fetch_fixtures        # daily
python -m jobs.fetch_predictions     # daily
python -m jobs.lock_predictions      # every ~10-15 min
python -m jobs.score_results         # frequently around match end
```

Add `-v` for debug logging. Writes are idempotent (keyed on the `api_*` ids), so
re-running a job is safe (§5, §8).

## Rate-limit discipline (§8)

The free tier allows **100 requests/day**. `fetch_predictions` fetches each
fixture's prediction **exactly once** and never re-fetches a stored one;
`fetch_fixtures` makes one sweep per tracked league. `apiclient.py` counts
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
