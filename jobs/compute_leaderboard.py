"""Public opt-in "Beat the Model" leaderboard (improvement #5, migration 0009).

DB-only, no football-API call. For every ``profiles`` row with
``leaderboard_opt_in=true`` and at least one SCORED "Beat the Model" pick
(``user_predictions``): compute that user's mean Brier score and the model's
own mean Brier score (``source='api-football'``, ``status='scored'`` --
mirrors ``src/lib/queries/play.ts``'/``match.ts``' ``DISPLAY_SOURCE`` +
void-exclusion rule -- see jobs/db.py's ``scored_model_brier_for_fixtures``)
over the SAME set of fixtures, then ``beat_margin = model_mean - user_mean``
(positive = the user beat the model on average). Ranked ``beat_margin`` desc.

Fixtures without a comparable SCORED model prediction (should be rare and
transient -- score_results.py and score_user_predictions.py both drain their
own self-contained queues) are excluded from BOTH means for that user, since
there is nothing to compare against; this is a data-availability exclusion,
never a performance one -- every one of a user's OWN scored picks that DOES
have a comparable model score counts, good or bad ("misses count honestly").

Idempotent: the whole ``leaderboard_standings`` table is REPLACED every run
(upsert-then-prune, mirroring ``jobs/fetch_topscorers.py``'s
``replace_top_scorers`` convention) from a freshly recomputed standings set,
so re-running produces the same ranking for the same underlying data, and a
user who opts out (or loses their last comparable pick) is pruned rather than
left stale.
"""

from __future__ import annotations

import logging
from typing import Optional

from jobs import config, scoring
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)

# How many leading characters of a user's uuid to surface in the anonymised
# fallback label -- enough to be a stable, distinguishing handle, never
# enough to be mistaken for anything else about the person (no email, no
# real name -- profiles carries neither).
_ANONYMOUS_LABEL_ID_CHARS = 8


def _anonymous_label(user_id: str) -> str:
    return f"Player {str(user_id)[:_ANONYMOUS_LABEL_ID_CHARS]}"


def run(*, dry_run: bool = False, store: Optional[SupabaseStore] = None) -> dict:
    store = store if store is not None else SupabaseStore()

    counts = {
        "opted_in": 0,
        "eligible": 0,
        "skipped_no_scored_picks": 0,
        "skipped_no_comparable_model_score": 0,
        "rows_written": 0,
        "pruned": 0,
    }

    profiles = store.opted_in_leaderboard_users()
    counts["opted_in"] = len(profiles)
    if not profiles:
        if not dry_run:
            result = store.replace_leaderboard_standings([])
            counts["pruned"] = result["pruned"]
        return counts

    user_ids = [p["id"] for p in profiles]
    display_names = {p["id"]: p.get("leaderboard_display_name") for p in profiles}

    picks = store.scored_user_predictions_for_users(user_ids)
    picks_by_user: dict[str, list[dict]] = {}
    for pick in picks:
        picks_by_user.setdefault(pick["user_id"], []).append(pick)

    all_fixture_ids = sorted({p["fixture_id"] for p in picks})
    model_brier = store.scored_model_brier_for_fixtures(
        all_fixture_ids, source=config.THIRD_PARTY_SOURCE
    )

    standings = []
    for user_id in user_ids:
        user_picks = picks_by_user.get(user_id, [])
        if not user_picks:
            counts["skipped_no_scored_picks"] += 1
            continue

        matched_user_brier = []
        matched_model_brier = []
        for pick in user_picks:
            model_score = model_brier.get(pick["fixture_id"])
            if model_score is None:
                # No comparable SCORED model call for this fixture yet --
                # excluded from BOTH means (nothing to compare against), not
                # a filter on how the user themselves did.
                continue
            matched_user_brier.append(pick["brier_score"])
            matched_model_brier.append(model_score)

        if not matched_user_brier:
            counts["skipped_no_comparable_model_score"] += 1
            continue

        user_mean = scoring.mean(matched_user_brier)
        model_mean = scoring.mean(matched_model_brier)
        standings.append(
            {
                "user_id": user_id,
                "display_name": display_names.get(user_id)
                or _anonymous_label(user_id),
                "picks_scored": len(matched_user_brier),
                "user_mean_brier": user_mean,
                "model_mean_brier": model_mean,
                "beat_margin": model_mean - user_mean,
            }
        )
        counts["eligible"] += 1

    # Rank by beat_margin desc (highest = beat the model by the widest
    # margin). Ties keep a stable order (Python's sort is stable; the input
    # order here is `user_ids`, itself the store's own read order) rather
    # than an arbitrary one.
    standings.sort(key=lambda row: row["beat_margin"], reverse=True)
    for i, row in enumerate(standings, start=1):
        row["rank"] = i

    if dry_run:
        for row in standings[:10]:
            log.info(
                "[dry-run] would rank #%d %s: beat_margin=%.4f "
                "(user=%.4f model=%.4f, n=%d)",
                row["rank"], row["display_name"], row["beat_margin"],
                row["user_mean_brier"], row["model_mean_brier"], row["picks_scored"],
            )
        if len(standings) > 10:
            log.info("[dry-run] ... and %d more row(s).", len(standings) - 10)
    else:
        result = store.replace_leaderboard_standings(standings)
        counts["rows_written"] = result["upserted"]
        counts["pruned"] = result["pruned"]

    return counts


if __name__ == "__main__":
    main(run, "Compute leaderboard")
