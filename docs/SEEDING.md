# Seeding & go-live (dev data → live 2026)

Glass Pitch targets **FIFA World Cup 2026** (`league=1`, `season=2026`). The free
API-Football plan can't read 2026 (only 2022–2024), so for development we seed the
**2022 Qatar World Cup** (64 finished matches) as **disposable dev data**. This doc is
the runbook for seeding it and for the **plug-and-play cutover to live 2026**.

> **Integrity:** the 2022 data is **DEV/DEMO ONLY**, keyed `season=2022`. It is **not**
> the public prediction record — the real locked-before-kickoff ledger starts only on
> genuine *future* 2026 fixtures (paid plan). Never present 2022 as the live record.

## How league / season are selected

`jobs/config.py` reads them from the environment, with the **live values committed as
defaults**:

- `WC_LEAGUE_ID` (default `1`)
- `WC_SEASON` (default `2026`)

For a dev seed, set them in your **git-ignored** `jobs/.env` (never committed):

```
WC_LEAGUE_ID=1
WC_SEASON=2022
```

Going live = remove these (or set them back to `2026` / `1`). **No code edit, no
commit** — the seed/teardown are pure data operations with **zero schema difference**
between dev and live (same tables, constraints, and triggers).

## Why a dev seeder exists

The live pipeline is forward-looking: `fetch_predictions` only predicts *scheduled*
fixtures, and `lock_predictions` voids predictions published after kickoff. 2022
matches are already *finished*, so neither works for a backfill.
`jobs/seed_predictions_dev.py` is a **dev-only** tool that seeds predictions for
*finished* fixtures (reusing the real `parse`/`build`/elo helpers) with `published_at`
stamped just before kickoff, so the **real** `lock_predictions` + `score_results` then
lock and score them. It is **not** used live.

## Seed the dev data (2022)

With `jobs/.env` set as above and the venv active (`source jobs/.venv/bin/activate`):

```bash
python -m jobs.fetch_fixtures                 # 1 API call → leagues/teams/fixtures
python -m jobs.seed_predictions_dev           # ~64 API calls, paced ~7s each (~7 min)
python -m jobs.lock_predictions               # published → locked (no API)
python -m jobs.score_results                  # locked → scored, Brier/log-loss (no API)
```

- `seed_predictions_dev --dry-run` reports what it would seed **without** calling the
  API (DB-only) — unlike the stock jobs whose `--dry-run` still calls the API.
- `--limit N` caps **new** api-football fetches (budget control); re-running tops up
  idempotently (skips fixtures that already have a prediction).
- Free tier is **100 req/day, ~10 req/min**. A full 64-match seed is ~65 calls.

## Tear down a season

```bash
python -m jobs.reset_season --season 2022 --dry-run   # report counts, delete nothing
python -m jobs.reset_season --season 2022             # delete (FK-safe, idempotent)
```

Deletes `predictions → fixtures → teams → leagues` for the season. The §7 immutability
trigger is `BEFORE UPDATE` only, so locked/scored predictions delete fine. Runs as the
service role.

## Go-live cutover (one config switch + one teardown)

1. Buy a paid API-Football plan that includes season 2026; get a new key.
2. In `jobs/.env`: set the new `API_FOOTBALL_KEY`; **remove** `WC_SEASON` and
   `WC_LEAGUE_ID` (reverts to the committed defaults 2026 / 1).
3. **Tear down 2022 FIRST** — before seeding 2026:
   ```bash
   python -m jobs.reset_season --season 2022
   ```
   This must precede the live seed: `leagues.api_league_id` is `UNIQUE` (one row per
   league), so seeding 2026 onto the existing league row would flip its season to 2026
   and orphan the 2022 fixtures. Teardown first keeps it clean.
4. Run the **live** pipeline (no dev seeder — live fixtures arrive scheduled):
   ```bash
   python -m jobs.fetch_fixtures
   python -m jobs.fetch_predictions
   # lock_predictions / score_results run on a schedule thereafter
   ```
5. Verify the DB holds only 2026 data.

## Known dev caveats

- `scored_at` on seeded rows is "today" (when scored), not 2022. Match dates
  (`kickoff_utc`) are the correct 2022 dates.
- Seeded elo predictions carry mild lookahead (ratings are derived by replaying the
  full, already-finished tournament). Elo is logged-only and never displayed
  (the homepage shows only `source='api-football'`), so this is cosmetic for dev.
