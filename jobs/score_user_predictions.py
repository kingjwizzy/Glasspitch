"""Frequent job: score locked "Beat the Model" user picks + refresh the
crowd-vs-model aggregate (ARCHITECTURE.md v3 §5, ROADMAP.md §2/§4, migration
0006).

Two independent, DB-only passes (no football-API call -- budget-free
regardless of how many picks/fixtures this touches):

1. **Score picks.** For every ``user_predictions`` row with no ``scored_at``
   yet whose fixture is already FINISHED (``jobs/db.py``'s
   ``locked_user_predictions_due_for_scoring`` -- a small, self-draining set,
   the SAME shape as ``score_results.py``'s own query, just against the
   OTHER table): derive the result from the final score and compute
   ``brier_score`` via the EXACT SAME ``scoring.brier_score`` the model's own
   ledger uses (ARCHITECTURE.md §10) -- never a second, bespoke scoring
   formula for the game. Only ``result``/``brier_score``/``scored_at`` are
   written, over the service-role client -- migration 0006 backs this with
   TWO independent mechanisms (a column grant that gives ``authenticated`` no
   access to these columns at all, and a trigger that rejects any
   non-service-role write touching them), so this is the one writer path both
   are built to allow. There is deliberately no ``log_loss`` column on
   ``user_predictions`` -- the game's public-facing metric is Brier only.

2. **Refresh crowd-vs-model aggregates.** For any fixture that has already
   LOCKED (kickoff passed) and has at least one pick but no
   ``fixture_pick_aggregates`` row yet: average that fixture's picks'
   probabilities (via ``scoring.mean``) into one aggregate row. This mirrors
   ``user_predictions``' own anti-copying visibility rule -- an aggregate is
   never published before a fixture locks, matching "pool members can only
   see each other's picks after lock". Once written, a fixture's aggregate
   never needs to change again: the write-window trigger (migration 0006)
   means its pick set is frozen the instant it locks, so this pass is
   self-draining exactly like pass 1.

Idempotent (a scored pick never reappears in pass 1's query; an aggregated
fixture never reappears in pass 2's) and per-item isolated: one bad/malformed
row is logged and skipped, never aborts the run for everyone else's picks.
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

    counts = {
        "locked_due": 0,
        "picks_scored": 0,
        "skipped_no_final_score": 0,
        "skipped_bad_probs": 0,
        "aggregates_candidates": 0,
        "aggregates_written": 0,
    }

    # --- Pass 1: score unscored picks whose fixture has finished -----------
    due = store.locked_user_predictions_due_for_scoring()
    counts["locked_due"] = len(due)

    for pick in due:
        fixture = pick.get("fixture") or {}
        final_home = fixture.get("final_home_goals")
        final_away = fixture.get("final_away_goals")
        if final_home is None or final_away is None:
            counts["skipped_no_final_score"] += 1
            log.info(
                "user_predictions %s's fixture %s is finished but missing a "
                "final score; skipping (will retry once the score is stored).",
                pick["id"], fixture.get("id"),
            )
            continue

        result = scoring.result_from_goals(final_home, final_away)
        try:
            brier = scoring.brier_score(
                pick["prob_home"], pick["prob_draw"], pick["prob_away"], result
            )
        except ValueError as exc:
            # Defence in depth only -- migration 0006's own sum-to-~1.0 CHECK
            # should already keep every stored pick normalised -- but ONE bad
            # row must never abort scoring for every other user's picks in
            # this run (per-item isolation).
            counts["skipped_bad_probs"] += 1
            log.error(
                "user_predictions %s has invalid probabilities (%s); skipping.",
                pick["id"], exc,
            )
            continue

        counts["picks_scored"] += 1
        if dry_run:
            log.info(
                "[dry-run] would score user_predictions %s (user=%s, fixture=%s): "
                "result=%s brier=%.4f",
                pick["id"], pick.get("user_id"), fixture.get("id"), result, brier,
            )
        else:
            store.write_user_prediction_score(
                pick["id"], result=result, brier_score=brier, scored_at=scored_at,
            )

    # --- Pass 2: publish fixture_pick_aggregates for newly-locked fixtures --
    candidate_ids = store.locked_fixture_ids_with_user_picks()
    have_aggregate = store.existing_pick_aggregate_fixture_ids()
    needing_aggregate = sorted(candidate_ids - have_aggregate)
    counts["aggregates_candidates"] = len(needing_aggregate)

    for fixture_id in needing_aggregate:
        probs = store.user_prediction_probs_for_fixture(fixture_id)
        n_picks = len(probs)
        if n_picks == 0:
            # Shouldn't happen (candidate_ids is derived FROM picks existing)
            # -- guards against a race between the two reads above rather
            # than trusting that invariant blindly.
            continue

        avg_home = scoring.mean(p["prob_home"] for p in probs)
        avg_draw = scoring.mean(p["prob_draw"] for p in probs)
        avg_away = scoring.mean(p["prob_away"] for p in probs)

        if dry_run:
            log.info(
                "[dry-run] would publish fixture_pick_aggregates for fixture "
                "%s: n_picks=%d avg=%.3f/%.3f/%.3f",
                fixture_id, n_picks, avg_home, avg_draw, avg_away,
            )
        else:
            store.upsert_fixture_pick_aggregate(
                fixture_id=fixture_id,
                n_picks=n_picks,
                avg_prob_home=avg_home,
                avg_prob_draw=avg_draw,
                avg_prob_away=avg_away,
            )
            counts["aggregates_written"] += 1

    return counts


if __name__ == "__main__":
    main(run, "Score user predictions")
