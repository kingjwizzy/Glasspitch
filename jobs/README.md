# Glass Pitch — Python jobs

Scheduled jobs that feed the database. **These jobs are the only part of the
system that talks to the football API, and the only part that writes to the
database** (ARCHITECTURE.md §5, §6). The website only ever *reads* from
Postgres — it never calls the API per visitor.

```
API-Football ──▶ Python jobs ──▶ Supabase (write) ──▶ Next.js (read) ──▶ visitor
```

## Modules

| File | Status | Purpose |
|---|---|---|
| `config.py` | placeholders | Tracked league IDs + season; model identifiers. **Set the league IDs before the first run.** |
| `db.py` | implemented | Supabase **service-role** client (the only writer; bypasses RLS). |
| `scoring.py` | **implemented** | Multiclass Brier score + clipped log loss (§10). |
| `elo.py` | **implemented** | Simple in-house team-rating Elo baseline (§9). |
| `fetch_fixtures.py` | stub | Daily: upsert fixtures keyed on `api_fixture_id` (§8). |
| `fetch_predictions.py` | stub | Daily: one `/predictions` fetch per fixture + logged Elo (§8, §9). |
| `lock_predictions.py` | stub | Frequent: lock at kickoff; mark `unlocked_void` (§8, §10). |
| `score_results.py` | stub (maths wired) | Frequent: score finished fixtures via `scoring.py` (§8, §10). |

The four fetch/lock/score modules are **clearly-marked stubs** (`raise
NotImplementedError`) — the API/DB plumbing is the next session's work. The
scoring maths (`scoring.py`, `elo.py`) is fully implemented and tested now,
because ARCHITECTURE.md flags it **[VERIFY YOURSELF]**.

## Setup

```bash
cd jobs
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt   # runtime + pytest; use requirements.txt for runtime only
cp .env.example .env                   # then fill in the values (never commit .env)
```

### Environment variables (`jobs/.env`)

| Variable | What it is |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Service-role key — bypasses RLS; server-side only. |
| `API_FOOTBALL_KEY` | **Secret.** API-Football key. |

## Running

```bash
python fetch_fixtures.py      # (stub) daily
python fetch_predictions.py   # (stub) daily
python lock_predictions.py    # (stub) every ~10-15 min
python score_results.py       # (stub) frequently around match end
```

Writes are idempotent (keyed on API ids) so re-running a job is safe (§5, §8).
Scheduler choice (Vercel Cron / GitHub Actions / Supabase scheduled functions)
is deferred to Day 2 (§16).

## Tests

The scoring maths is unit-tested and depends only on the standard library:

```bash
source .venv/bin/activate
python -m pytest tests -q
```
