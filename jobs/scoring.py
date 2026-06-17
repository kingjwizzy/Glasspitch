"""Proper scoring rules for the prediction ledger (ARCHITECTURE.md Section 10).

This module is the heart of the "radical transparency" promise: it scores every
locked prediction against what actually happened. The maths is flagged
[VERIFY YOURSELF] in the architecture doc, so these functions are deliberately
pure and dependency-free (standard library only) to make them easy to read,
test, and hand-verify.

Outcome space is the three-way football result, always ordered
``(home, draw, away)``.
"""

from __future__ import annotations

import math
from typing import Iterable

# Canonical class order used everywhere in the project.
OUTCOMES: tuple[str, str, str] = ("home", "draw", "away")

# Clip epsilon for log loss (ARCHITECTURE.md Section 10). Probabilities are
# clipped to [EPSILON, 1 - EPSILON] so -ln(p) can never blow up to infinity.
LOG_LOSS_EPSILON: float = 1e-12

# Tolerance for the probability-sum invariant. The documented Brier range
# (0..2) only holds on the probability simplex, so inputs must sum to ~1.0. Kept
# >= the §7 DB CHECK epsilon (0.01) so any prediction the database accepted also
# passes here, while still rejecting denormalized/garbage inputs.
PROB_SUM_TOLERANCE: float = 0.02


def _validate_probs(
    prob_home: float, prob_draw: float, prob_away: float
) -> tuple[float, float, float]:
    """Coerce to float and reject NaNs, out-of-range, or non-normalized probs.

    Enforces the same normalization invariant as the §7 DB CHECK so the
    documented Brier range (0..2) and a well-defined log loss always hold.
    """
    probs = (float(prob_home), float(prob_draw), float(prob_away))
    for p in probs:
        if math.isnan(p):
            raise ValueError("probabilities must be real numbers, got NaN")
        if p < 0.0 or p > 1.0:
            raise ValueError(f"probability out of range [0, 1]: {p!r}")
    total = probs[0] + probs[1] + probs[2]
    if abs(total - 1.0) > PROB_SUM_TOLERANCE:
        raise ValueError(
            f"probabilities must sum to ~1.0 (within {PROB_SUM_TOLERANCE}), "
            f"got {total!r}"
        )
    return probs


def _require_result(result: str) -> str:
    if result not in OUTCOMES:
        raise ValueError(f"result must be one of {OUTCOMES}, got {result!r}")
    return result


def result_from_goals(home_goals: int, away_goals: int) -> str:
    """Map a final scoreline to the three-way result label.

    Returns one of ``'home'`` / ``'draw'`` / ``'away'``.
    """
    if home_goals > away_goals:
        return "home"
    if home_goals < away_goals:
        return "away"
    return "draw"


def brier_score(
    prob_home: float, prob_draw: float, prob_away: float, result: str
) -> float:
    """Multiclass Brier score for a single match (ARCHITECTURE.md Section 10).

    ``BS = (p_home - y_home)^2 + (p_draw - y_draw)^2 + (p_away - y_away)^2``

    where ``(y_home, y_draw, y_away)`` is the one-hot encoding of the actual
    outcome (the true class is 1, the others 0). Range: 0.0 (perfect) to 2.0
    (all probability mass placed on a single wrong outcome). Report the mean over
    all scored predictions.
    """
    p_home, p_draw, p_away = _validate_probs(prob_home, prob_draw, prob_away)
    outcome = _require_result(result)
    y_home = 1.0 if outcome == "home" else 0.0
    y_draw = 1.0 if outcome == "draw" else 0.0
    y_away = 1.0 if outcome == "away" else 0.0
    return (
        (p_home - y_home) ** 2
        + (p_draw - y_draw) ** 2
        + (p_away - y_away) ** 2
    )


def log_loss(
    prob_home: float,
    prob_draw: float,
    prob_away: float,
    result: str,
    epsilon: float = LOG_LOSS_EPSILON,
) -> float:
    """Per-match log loss (ARCHITECTURE.md Section 10).

    ``LL = -ln(p_correct)``, where ``p_correct`` is the probability assigned to
    the outcome that actually happened. The probability is clipped to
    ``[epsilon, 1 - epsilon]`` so the value never blows up to infinity. Punishes
    confident wrong calls hard. Report the mean over all scored predictions.
    """
    p_home, p_draw, p_away = _validate_probs(prob_home, prob_draw, prob_away)
    outcome = _require_result(result)
    p_correct = {"home": p_home, "draw": p_draw, "away": p_away}[outcome]
    clipped = min(max(p_correct, epsilon), 1.0 - epsilon)
    return -math.log(clipped)


def mean(values: Iterable[float]) -> float:
    """Arithmetic mean. Raises ``ValueError`` on an empty sequence.

    Used to report mean Brier / mean log loss over the scored ledger (Section 10).
    """
    vals = list(values)
    if not vals:
        raise ValueError("cannot take the mean of an empty sequence")
    return sum(vals) / len(vals)
