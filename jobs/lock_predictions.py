"""Frequent job: lock predictions at kickoff; void any unlocked (ARCHITECTURE.md §8, §10).

STUB — the DB logic is left for the next session.

Intended behaviour (run every ~10-15 min):
  * For predictions with ``locked_at <= now()`` and ``status='published'``, set
    ``status='locked'``. From that moment the §7 immutability trigger makes
    prob_*/predicted_*/model_version/source/published_at immutable.
  * Any fixture that kicked off WITHOUT a published prediction is recorded as
    ``status='unlocked_void'`` and EXCLUDED from the scored record — integrity
    over coverage (§5, §10).
"""

from __future__ import annotations

from db import get_client  # noqa: F401  (used once implemented)


def run() -> None:
    # TODO(ARCHITECTURE.md §8, §10): implement the kickoff lock transition and the
    # unlocked_void marking, writing via get_client().
    raise NotImplementedError(
        "lock_predictions: implement kickoff lock + unlocked_void (§8, §10). "
        "Next session."
    )


if __name__ == "__main__":
    run()
