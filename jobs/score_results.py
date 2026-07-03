"""Frequent job around match end: score locked predictions (ARCHITECTURE.md §8.4, §10).

Queries LOCKED predictions whose fixture is already FINISHED — a small,
self-draining set (jobs/db.py.locked_predictions_due_for_scoring) — instead of
rescanning every finished fixture forever with one query per fixture (the old
O(all finished fixtures), N+1 design that only ever grows). Copies the final
score, sets the result (home/draw/away), computes brier_score and log_loss via
scoring.py, and sets status='scored'. Idempotent: a prediction that is already
'scored' never reappears in the query (it is no longer 'locked').

Also runs a cheap consistency pass: SCORED predictions whose fixture's final
score has since changed (a data-provider correction after we scored it) are
logged loudly for manual review — the migration-0003 trigger freezes scored
fields, so this job never silently rewrites the public record.
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

    due = store.locked_predictions_due_for_scoring()
    counts = {
        "locked_due": len(due),
        "predictions_scored": 0,
        "skipped_no_score": 0,
    }

    for pred in due:
        fixture = pred.get("fixture") or {}
        final_home = fixture.get("final_home_goals")
        final_away = fixture.get("final_away_goals")
        if final_home is None or final_away is None:
            counts["skipped_no_score"] += 1
            log.info(
                "Prediction %s's fixture %s is finished but missing a final "
                "score; skipping (will retry once the score is stored).",
                pred["id"], fixture.get("id"),
            )
            continue

        result = scoring.result_from_goals(final_home, final_away)
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
                pred["id"], pred["model_version"], fixture.get("id"), result, brier, loss,
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

    # Cheap consistency pass: catch data-provider score corrections that landed
    # AFTER we already scored a prediction. Read-only from this job's point of
    # view — the frozen scored fields (migration 0003) mean the only sanctioned
    # response is a loud log for manual review, never an automatic rewrite.
    mismatches = store.scored_predictions_with_mismatched_final_score()
    counts["scored_final_score_mismatches"] = len(mismatches)
    for row in mismatches:
        fixture = row.get("fixture") or {}
        log.warning(
            "SCORE MISMATCH: prediction %s (%s) was scored %s-%s but fixture %s "
            "now shows %s-%s (provider correction?). Scored fields are frozen "
            "(migration 0003) — this needs manual review, not an automatic rescore.",
            row["id"], row.get("model_version"),
            row.get("final_home_goals"), row.get("final_away_goals"),
            fixture.get("id"), fixture.get("final_home_goals"), fixture.get("final_away_goals"),
        )

    # The in-house Elo ratings are not stored here. fetch_predictions re-derives
    # them from the fixtures history on its next run (§9); now that these results
    # are stored they will be picked up automatically (no ratings table yet).
    return counts


if __name__ == "__main__":
    main(run, "Score results")
