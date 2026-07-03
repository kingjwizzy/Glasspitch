"""Dev tooling: seed predictions for ALREADY-FINISHED fixtures (docs/SEEDING.md).

The live pipeline is forward-looking: ``fetch_predictions`` only predicts scheduled
(upcoming) fixtures, and ``lock_predictions`` voids anything published after kickoff.
Neither works for a HISTORICAL backfill (e.g. the 2022 Qatar World Cup, whose matches
are all finished). This dev-only seeder fills that gap WITHOUT touching the live jobs:
for each finished fixture it fetches / derives the SAME api-football + elo predictions
(reusing ``fetch_predictions``' helpers), but stamps ``published_at`` just BEFORE
kickoff so the REAL ``lock_predictions`` and ``score_results`` then lock + score them
exactly as they would live.

Paced to respect the free tier's ~10 req/min, idempotent (skips fixtures that already
have a prediction), and capped via --limit. NOT used in live operation — live fixtures
arrive scheduled and flow through the stock jobs.

    python -m jobs.seed_predictions_dev --dry-run    # DB-only preview, no API calls
    python -m jobs.seed_predictions_dev --limit 3    # seed a thin slice
    python -m jobs.seed_predictions_dev              # full season, paced
"""

from __future__ import annotations

import argparse
import logging
import time
from datetime import timedelta
from typing import Callable, Optional, Sequence

from jobs import config, elo, util
from jobs.apiclient import ApiFootballClient
from jobs.db import SupabaseStore
from jobs.fetch_predictions import (
    _derived_ratings,
    build_prediction_row,
    normalise_probabilities,
    parse_api_prediction,
)

log = logging.getLogger(__name__)

# Stamp published_at this far before kickoff so lock_predictions treats the row as a
# valid pre-kickoff prediction (published_at <= locked_at = kickoff).
PUBLISH_LEAD = timedelta(days=1)
# Pace api-football calls to stay under the free tier's ~10 requests/minute.
DEFAULT_PACE_SECONDS = 7.0


def _backdated_publish(kickoff_utc: str) -> str:
    return (util.parse_iso(kickoff_utc) - PUBLISH_LEAD).isoformat()


def run(
    *,
    dry_run: bool = False,
    limit: Optional[int] = None,
    store: Optional[SupabaseStore] = None,
    api: Optional[ApiFootballClient] = None,
    pace_seconds: float = DEFAULT_PACE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    allow_live: bool = False,
) -> dict:
    # Safety interlock: never back-date predictions onto the LIVE production season.
    # The seeder fabricates pre-kickoff rows for already-finished fixtures, which is
    # only meaningful for disposable dev data; running it against the real season
    # would forge ledger history. A dev run sets WC_SEASON to a back-test season
    # (config.SEASON != LIVE_SEASON); override deliberately with --allow-live-season.
    if config.SEASON == config.LIVE_SEASON and not allow_live:
        raise SystemExit(
            f"refusing to seed the LIVE season {config.SEASON}: the dev seeder only "
            f"back-dates disposable dev data (see docs/SEEDING.md). Set WC_SEASON to a "
            f"dev season, or pass --allow-live-season to override."
        )

    api = api if api is not None else ApiFootballClient()
    store = store if store is not None else SupabaseStore()

    # Season-scoped (not the old unscoped finished_fixtures_ordered): the
    # config-identity interlock above only checks WHICH season is configured,
    # not which rows get touched, so the read itself must be physically
    # confined to config.SEASON. Otherwise, once the DB holds both disposable
    # dev rows and the live season side by side, a dev-configured run could
    # still fabricate predictions onto the live season's finished fixtures
    # (docs/STATUS.md "close before the live cutover").
    finished = store.finished_fixtures_for_season(config.SEASON)
    have_api = store.existing_prediction_fixture_ids(config.THIRD_PARTY_SOURCE)
    have_elo = store.existing_prediction_fixture_ids(config.ELO_SOURCE)
    ratings = _derived_ratings(store)

    counts = {
        "finished": len(finished),
        "api_fetched": 0,
        "api_inserted": 0,
        "api_empty": 0,
        "api_skipped_existing": 0,
        "elo_inserted": 0,
        "elo_skipped_existing": 0,
    }

    for fixture in finished:
        fixture_id = fixture["id"]
        kickoff_utc = fixture["kickoff_utc"]

        # --limit caps NEW api fetches this run (budget control / thin slice). Stop
        # processing further fixtures once the cap is reached and the next fixture
        # would need a fetch. Already-predicted fixtures never count against it.
        if limit is not None and counts["api_fetched"] >= limit and fixture_id not in have_api:
            break

        published_at = _backdated_publish(kickoff_utc)

        # --- third-party (API-Football) prediction: fetch ONCE per fixture ---
        if fixture_id in have_api:
            counts["api_skipped_existing"] += 1
        elif dry_run:
            # DB-only dry-run: report what WOULD be fetched without spending budget.
            counts["api_fetched"] += 1
            log.info("[dry-run] would fetch api-football prediction for fixture %s.", fixture_id)
        else:
            payload = api.get_predictions(fixture["api_fixture_id"])
            counts["api_fetched"] += 1
            parsed = parse_api_prediction(payload)
            if parsed is None:
                counts["api_empty"] += 1
                log.info(
                    "No api-football prediction for fixture %s (api_id=%s); skipping.",
                    fixture_id, fixture["api_fixture_id"],
                )
            else:
                row = build_prediction_row(
                    fixture_id=fixture_id,
                    source=config.THIRD_PARTY_SOURCE,
                    model_version=config.THIRD_PARTY_MODEL_VERSION,
                    probabilities=(parsed.prob_home, parsed.prob_draw, parsed.prob_away),
                    scoreline=parsed.scoreline,
                    kickoff_utc=kickoff_utc,
                    now_iso=published_at,
                )
                if store.insert_prediction(row) is not None:
                    counts["api_inserted"] += 1
            sleep(pace_seconds)  # pace network calls (free-tier ~10/min)

        # --- in-house Elo prediction (logged-only, no API call — §9) ---
        if fixture_id in have_elo:
            counts["elo_skipped_existing"] += 1
        elif dry_run:
            log.info("[dry-run] would insert elo prediction for fixture %s.", fixture_id)
        else:
            home_rating = ratings.get(fixture["home_team_id"], elo.DEFAULT_RATING)
            away_rating = ratings.get(fixture["away_team_id"], elo.DEFAULT_RATING)
            probs = elo.match_probabilities(home_rating, away_rating)
            normalised = normalise_probabilities(probs["home"], probs["draw"], probs["away"])
            row = build_prediction_row(
                fixture_id=fixture_id,
                source=config.ELO_SOURCE,
                model_version=config.ELO_MODEL_VERSION,
                probabilities=normalised,
                scoreline=elo.predicted_scoreline(home_rating, away_rating),
                kickoff_utc=kickoff_utc,
                now_iso=published_at,
            )
            if store.insert_prediction(row) is not None:
                counts["elo_inserted"] += 1

    # Surface true network usage (includes retries) for the request budget (§8).
    counts["api_requests"] = api.request_count
    return counts


def main(argv: Optional[Sequence[str]] = None) -> dict:
    parser = argparse.ArgumentParser(
        description="Seed predictions for finished fixtures (dev only)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="DB-only preview: report what would be seeded WITHOUT calling the API "
        "or writing. (Unlike the stock jobs, this dry-run spends no API budget.)",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Cap the number of NEW api-football fetches this run (budget control).",
    )
    parser.add_argument(
        "--pace-seconds", type=float, default=DEFAULT_PACE_SECONDS,
        help="Seconds to sleep between api-football calls (free-tier pacing).",
    )
    parser.add_argument(
        "--allow-live-season",
        action="store_true",
        help="Override the safety interlock and seed even when the configured season "
        f"is the live default ({config.LIVE_SEASON}). Dev tooling only — never for live data.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    summary = run(
        dry_run=args.dry_run,
        limit=args.limit,
        pace_seconds=args.pace_seconds,
        allow_live=args.allow_live_season,
    )
    mode = "DRY-RUN" if args.dry_run else "LIVE"
    logging.getLogger("jobs").info("[%s] Seed predictions (dev) complete: %s", mode, summary)
    return summary


if __name__ == "__main__":
    main()
