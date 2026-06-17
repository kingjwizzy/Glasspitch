"""Daily job: one third-party prediction per fixture + logged Elo (ARCHITECTURE.md §8, §9).

STUB — the API logic is left for the next session.

Intended behaviour, for each upcoming fixture WITHOUT a prediction:
  1. GET ``/predictions?fixture={id}`` EXACTLY ONCE and store it as
     ``model_version='api-football-v1'``, ``source='api-football'``,
     ``status='published'`` (never re-fetch — protects the 100 req/day budget, §8).
  2. Compute the in-house Elo prediction (``elo.match_probabilities`` and
     ``elo.predicted_scoreline``) and store it ALONGSIDE as
     ``model_version='elo-v1'``, ``source='inhouse-elo'`` (logged silently, §9).
  3. Set ``locked_at`` = fixture kickoff for every prediction row.

The §7 CHECK requires ``prob_home + prob_draw + prob_away`` to be within epsilon
of 1.0; Elo probabilities from ``elo.match_probabilities`` already sum to 1.0.
"""

from __future__ import annotations

import elo  # noqa: F401  (used once implemented)
from config import (  # noqa: F401  (used once implemented)
    ELO_MODEL_VERSION,
    ELO_SOURCE,
    THIRD_PARTY_MODEL_VERSION,
    THIRD_PARTY_SOURCE,
)
from db import get_client  # noqa: F401  (used once implemented)


def run() -> None:
    # TODO(ARCHITECTURE.md §8, §9): implement the once-per-fixture /predictions
    # fetch plus the alongside Elo logging, writing both rows via get_client().
    raise NotImplementedError(
        "fetch_predictions: implement /predictions fetch + Elo logging (§8, §9). "
        "Next session."
    )


if __name__ == "__main__":
    run()
