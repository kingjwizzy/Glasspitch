"""Unit tests for the proper scoring rules (ARCHITECTURE.md §10).

These verify the maths flagged [VERIFY YOURSELF]: the multiclass Brier score and
the clipped log loss.
"""

import math

import pytest

from jobs.scoring import (
    LOG_LOSS_EPSILON,
    OUTCOMES,
    PROB_SUM_TOLERANCE,
    brier_score,
    log_loss,
    mean,
    result_from_goals,
)


# --- Brier score -------------------------------------------------------------


def test_brier_perfect_prediction_is_zero():
    assert brier_score(1.0, 0.0, 0.0, "home") == 0.0
    assert brier_score(0.0, 1.0, 0.0, "draw") == 0.0
    assert brier_score(0.0, 0.0, 1.0, "away") == 0.0


def test_brier_confidently_wrong_is_two():
    # All mass on home, but away happened → maximal Brier of 2.0.
    assert brier_score(1.0, 0.0, 0.0, "away") == pytest.approx(2.0)


def test_brier_uniform_prediction():
    # (1/3, 1/3, 1/3) with home occurring: (1/3-1)^2 + (1/3)^2 + (1/3)^2 = 2/3.
    third = 1.0 / 3.0
    assert brier_score(third, third, third, "home") == pytest.approx(2.0 / 3.0)


def test_brier_known_case():
    # p=(0.5, 0.3, 0.2), home occurs: 0.25 + 0.09 + 0.04 = 0.38.
    assert brier_score(0.5, 0.3, 0.2, "home") == pytest.approx(0.38)


def test_brier_always_in_range_0_to_2():
    for result in OUTCOMES:
        value = brier_score(0.6, 0.3, 0.1, result)
        assert 0.0 <= value <= 2.0


# --- Log loss ----------------------------------------------------------------


def test_log_loss_perfect_is_essentially_zero():
    # p_correct clipped to 1 - eps, so -ln(1-eps) is tiny but non-negative.
    value = log_loss(1.0, 0.0, 0.0, "home")
    assert value == pytest.approx(-math.log(1.0 - LOG_LOSS_EPSILON))
    assert value >= 0.0
    assert value < 1e-9


def test_log_loss_known_case():
    # p_correct = 0.5 → -ln(0.5) = 0.6931...
    assert log_loss(0.5, 0.3, 0.2, "home") == pytest.approx(-math.log(0.5))


def test_log_loss_uniform():
    third = 1.0 / 3.0
    assert log_loss(third, third, third, "away") == pytest.approx(
        -math.log(third)
    )


def test_log_loss_clips_zero_probability():
    # Zero probability on the outcome that happened → clipped, finite, large.
    value = log_loss(0.0, 0.5, 0.5, "home")
    assert math.isfinite(value)
    assert value == pytest.approx(-math.log(LOG_LOSS_EPSILON))


def test_log_loss_custom_epsilon():
    value = log_loss(0.0, 0.5, 0.5, "home", epsilon=1e-6)
    assert value == pytest.approx(-math.log(1e-6))


def test_log_loss_punishes_confident_wrong_more_than_uniform():
    confident_wrong = log_loss(0.95, 0.03, 0.02, "away")
    uniform = log_loss(1 / 3, 1 / 3, 1 / 3, "away")
    assert confident_wrong > uniform


# --- Helpers -----------------------------------------------------------------


def test_result_from_goals():
    assert result_from_goals(2, 1) == "home"
    assert result_from_goals(0, 3) == "away"
    assert result_from_goals(1, 1) == "draw"


def test_outcomes_canonical_order():
    assert OUTCOMES == ("home", "draw", "away")


def test_mean():
    assert mean([0.0, 1.0, 2.0]) == pytest.approx(1.0)


def test_mean_empty_raises():
    with pytest.raises(ValueError):
        mean([])


# --- Validation --------------------------------------------------------------


@pytest.mark.parametrize("bad", [-0.1, 1.1, float("nan")])
def test_invalid_probability_raises(bad):
    with pytest.raises(ValueError):
        brier_score(bad, 0.0, 0.0, "home")
    with pytest.raises(ValueError):
        log_loss(bad, 0.0, 0.0, "home")


def test_invalid_result_raises():
    with pytest.raises(ValueError):
        brier_score(0.5, 0.3, 0.2, "tie")
    with pytest.raises(ValueError):
        log_loss(0.5, 0.3, 0.2, "tie")


@pytest.mark.parametrize("probs", [(1.0, 1.0, 1.0), (0.5, 0.5, 0.5), (0.2, 0.2, 0.2)])
def test_non_normalized_probabilities_raise(probs):
    # Brier's documented 0..2 range only holds on the probability simplex, so
    # inputs that do not sum to ~1.0 are rejected (mirrors the §7 DB CHECK).
    with pytest.raises(ValueError):
        brier_score(*probs, "home")
    with pytest.raises(ValueError):
        log_loss(*probs, "home")


def test_small_rounding_in_prob_sum_is_accepted():
    # A sum off by less than the tolerance (third-party rounding the DB CHECK
    # also allows) is accepted and stays within the documented Brier range.
    assert abs((0.34 + 0.33 + 0.34) - 1.0) < PROB_SUM_TOLERANCE
    value = brier_score(0.34, 0.33, 0.34, "home")
    assert 0.0 <= value <= 2.0
