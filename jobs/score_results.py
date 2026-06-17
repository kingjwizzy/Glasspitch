"""Frequent job around match end: score finished fixtures (ARCHITECTURE.md §8, §10).

The fetch/DB plumbing is a STUB for the next session, but the scoring maths it
calls is fully implemented in ``scoring.py`` and wired here in
``score_prediction()`` (which is pure and unit-testable today).

Intended behaviour, for each fixture that is finished and whose locked prediction
is not yet scored:
  1. Copy ``final_home_goals`` / ``final_away_goals`` from the fixture.
  2. ``result = scoring.result_from_goals(home, away)``.
  3. ``brier_score`` / ``log_loss`` via ``scoring`` (Section 10).
  4. Set ``status='scored'`` and ``scored_at=now()``.
  5. Update Elo ratings from the result (``elo.update_ratings``) for future
     predictions (§9).

Only the scoring fields are written post-lock; the §7 trigger rejects any change
to the prediction itself.
"""

from __future__ import annotations

import elo  # noqa: F401  (used once the Elo-rating store is wired in)
import scoring
from db import get_client  # noqa: F401  (used once implemented)


def score_prediction(
    prob_home: float,
    prob_draw: float,
    prob_away: float,
    final_home_goals: int,
    final_away_goals: int,
) -> dict:
    """Compute the scoring fields for one finished prediction.

    Pure and unit-testable now; the fetch/DB plumbing around it is the stub.
    Returns the column values the scoring job will write to the ledger.
    """
    result = scoring.result_from_goals(final_home_goals, final_away_goals)
    return {
        "final_home_goals": final_home_goals,
        "final_away_goals": final_away_goals,
        "result": result,
        "brier_score": scoring.brier_score(
            prob_home, prob_draw, prob_away, result
        ),
        "log_loss": scoring.log_loss(prob_home, prob_draw, prob_away, result),
        "status": "scored",
    }


def run() -> None:
    # TODO(ARCHITECTURE.md §8, §10): detect finished fixtures, load their locked
    # predictions, call score_prediction(), write the scoring fields via
    # get_client(), and update Elo ratings.
    raise NotImplementedError(
        "score_results: implement finished-fixture detection + DB writes (§8, §10). "
        "The scoring maths is ready in scoring.py / this module's score_prediction()."
    )


if __name__ == "__main__":
    run()
