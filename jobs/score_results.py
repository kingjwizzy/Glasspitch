"""Frequent job around match end: score finished fixtures (ARCHITECTURE.md §8.4, §10).

For each finished fixture, take its locked, not-yet-scored predictions, copy the
final score, set the result (home/draw/away), compute brier_score and log_loss
via scoring.py, and set status='scored'. Idempotent: predictions already
'scored' are skipped. The in-house Elo ratings are not stored here;
fetch_predictions re-derives them from the fixtures history on its next run (§9).
"""

from __future__ import annotations

import logging
from typing import Optional

from jobs import scoring, util
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def run(*, dry_run: bool = False, store: Optional[SupabaseStore] = None, now=None) -> dict:
    store = store if store is not None else SupabaseStore()
    scored_at = (now or util.now_utc()).isoformat()

    finished = store.finished_fixtures_ordered()
    counts = {
        "finished": len(finished),
        "predictions_scored": 0,
        "skipped_no_score": 0,
    }

    for fixture in finished:
        final_home = fixture.get("final_home_goals")
        final_away = fixture.get("final_away_goals")
        if final_home is None or final_away is None:
            counts["skipped_no_score"] += 1
            log.info(
                "Fixture %s is finished but missing a final score; skipping.",
                fixture["id"],
            )
            continue

        result = scoring.result_from_goals(final_home, final_away)

        for pred in store.locked_unscored_predictions(fixture["id"]):
            brier = scoring.brier_score(
                pred["prob_home"], pred["prob_draw"], pred["prob_away"], result
            )
            loss = scoring.log_loss(
                pred["prob_home"], pred["prob_draw"], pred["prob_away"], result
            )
            counts["predictions_scored"] += 1
            if dry_run:
                log.info(
                    "[dry-run] would score prediction %s (%s) for fixture %s: "
                    "result=%s brier=%.4f log_loss=%.4f",
                    pred["id"], pred["model_version"], fixture["id"], result, brier, loss,
                )
            else:
                store.write_prediction_score(
                    pred["id"],
                    final_home_goals=final_home,
                    final_away_goals=final_away,
                    result=result,
                    brier_score=brier,
                    log_loss=loss,
                    scored_at=scored_at,
                )

    # The in-house Elo ratings are not stored here. fetch_predictions re-derives
    # them from the fixtures history on its next run (§9); now that these results
    # are stored they will be picked up automatically (no ratings table yet).
    return counts


if __name__ == "__main__":
    main(run, "Score results")
