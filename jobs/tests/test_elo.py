"""Unit tests for the in-house Elo baseline (ARCHITECTURE.md §9)."""

import pytest

from jobs.elo import (
    DEFAULT_RATING,
    DRAW_MAX,
    HOME_ADVANTAGE,
    K_FACTOR,
    expected_score,
    match_probabilities,
    predicted_scoreline,
    ratings_from_results,
    update_ratings,
)


def test_expected_score_symmetry():
    assert expected_score(1500, 1500) == pytest.approx(0.5)


def test_expected_score_monotonic_and_complementary():
    assert expected_score(1700, 1500) > 0.5
    assert expected_score(1300, 1500) < 0.5
    assert expected_score(1700, 1500) == pytest.approx(
        1.0 - expected_score(1500, 1700)
    )


def test_update_conserves_total_rating():
    new_home, new_away = update_ratings(1500, 1500, 2, 0)
    assert (new_home + new_away) == pytest.approx(1500 + 1500)


def test_update_winner_gains_loser_loses():
    new_home, new_away = update_ratings(1500, 1500, 3, 1)
    assert new_home > 1500
    assert new_away < 1500


def test_update_draw_costs_the_favoured_home_side():
    # Equal ratings, but home is favoured by the home-advantage term, so a draw
    # nudges the home rating down and the away rating up.
    new_home, new_away = update_ratings(1500, 1500, 1, 1)
    assert new_home < 1500
    assert new_away > 1500


def test_match_probabilities_sum_to_one_and_are_valid():
    probs = match_probabilities(1500, 1500)
    assert probs["home"] + probs["draw"] + probs["away"] == pytest.approx(1.0)
    assert all(0.0 <= v <= 1.0 for v in probs.values())


def test_match_probabilities_reflect_home_advantage():
    # Equal ratings: home advantage makes home more likely than away.
    probs = match_probabilities(1500, 1500)
    assert probs["home"] > probs["away"]


def test_match_probabilities_favour_much_stronger_home():
    probs = match_probabilities(1800, 1400)
    assert probs["home"] > probs["draw"]
    assert probs["home"] > probs["away"]


def test_draw_mass_peaks_for_even_match():
    even = match_probabilities(1500, 1500)["draw"]
    lopsided = match_probabilities(1800, 1400)["draw"]
    assert even > lopsided


def test_predicted_scoreline_returns_ints_and_favours_stronger_home():
    home_goals, away_goals = predicted_scoreline(1800, 1400)
    assert isinstance(home_goals, int) and isinstance(away_goals, int)
    assert home_goals >= away_goals


def test_documented_defaults():
    assert DEFAULT_RATING == 1500
    assert K_FACTOR > 0
    assert HOME_ADVANTAGE >= 0


def test_expected_score_exact_with_home_advantage():
    # Two equal 1500 sides: the home expectation compares 1500 + HOME_ADVANTAGE
    # against 1500. Pin the exact value so a HOME_ADVANTAGE regression is caught.
    assert expected_score(1500 + HOME_ADVANTAGE, 1500) == pytest.approx(
        0.5855, abs=1e-4
    )


def test_match_probabilities_exact_even_match_no_home_advantage():
    # With no home advantage and equal ratings, E = 0.5 → draw sits at its peak
    # (DRAW_MAX) and the remaining mass splits evenly. Locks the draw model.
    probs = match_probabilities(1500, 1500, home_advantage=0.0)
    assert probs["draw"] == pytest.approx(DRAW_MAX)
    assert probs["home"] == pytest.approx((1.0 - DRAW_MAX) / 2.0)
    assert probs["away"] == pytest.approx((1.0 - DRAW_MAX) / 2.0)


# --- ratings_from_results (replay) -------------------------------------------


def test_ratings_from_results_empty_is_empty():
    assert ratings_from_results([]) == {}


def test_ratings_from_results_cold_start_then_evolves():
    # Team 1 beats team 2. Winner rises above default, loser falls below, and the
    # pool total is conserved (cold-start from DEFAULT_RATING).
    ratings = ratings_from_results([(1, 2, 3, 0)])
    assert ratings[1] > DEFAULT_RATING
    assert ratings[2] < DEFAULT_RATING
    assert ratings[1] + ratings[2] == pytest.approx(2 * DEFAULT_RATING)


def test_ratings_from_results_unseen_team_defaults():
    ratings = ratings_from_results([(1, 2, 1, 0)])
    assert 3 not in ratings  # a team that never played is simply absent
    # callers fall back to DEFAULT_RATING for absent teams
    assert ratings.get(3, DEFAULT_RATING) == DEFAULT_RATING
