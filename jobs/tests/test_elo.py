"""Unit tests for the in-house Elo baseline (ARCHITECTURE.md §9)."""

import pytest

from jobs.elo import (
    DEFAULT_RATING,
    DRAW_MAX,
    EXPECTED_TOTAL_GOALS,
    HOME_ADVANTAGE,
    K_FACTOR,
    clean_sheet_probability,
    expected_goals,
    expected_score,
    match_probabilities,
    predicted_scoreline,
    ratings_from_results,
    team_snapshot_metrics,
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


# --- W5 snapshot maths: expected_goals / clean_sheet_probability / ------------
# team_snapshot_metrics (jobs/snapshot_probabilities.py, migration 0006) ------


def test_expected_goals_splits_the_total_and_stays_unrounded():
    home, away = expected_goals(1800, 1400)
    assert isinstance(home, float) and isinstance(away, float)
    assert home + away == pytest.approx(EXPECTED_TOTAL_GOALS)
    assert home > away  # the much stronger home side takes the larger share


def test_expected_goals_even_match_no_home_advantage_splits_evenly():
    # E = 0.5 exactly, so each side expects half the 2.7-goal baseline: 1.35.
    home, away = expected_goals(1500, 1500, home_advantage=0.0)
    assert home == pytest.approx(1.35)
    assert away == pytest.approx(1.35)


def test_expected_goals_hand_computed_with_home_advantage():
    # Two equal 1500 sides, default 60-point home advantage:
    # E = 1/(1 + 10^(-60/400)) = 0.5854986787, xg = 2.7*E / 2.7*(1-E).
    home, away = expected_goals(1500, 1500)
    assert home == pytest.approx(1.5808464324, abs=1e-9)
    assert away == pytest.approx(1.1191535676, abs=1e-9)


def test_expected_goals_is_what_predicted_scoreline_rounds():
    # predicted_scoreline is documented as the rounded version of the same
    # split -- the two must never drift apart.
    for ratings in ((1500, 1500), (1800, 1400), (1300, 1650)):
        raw = expected_goals(*ratings)
        assert predicted_scoreline(*ratings) == (round(raw[0]), round(raw[1]))


def test_clean_sheet_probability_hand_computed_poisson_values():
    # P(X=0) = exp(-lambda) for a Poisson(lambda) count of goals conceded.
    assert clean_sheet_probability(0.0) == pytest.approx(1.0)
    assert clean_sheet_probability(1.0) == pytest.approx(0.3678794412, abs=1e-9)
    assert clean_sheet_probability(1.35) == pytest.approx(0.2592402606, abs=1e-9)


def test_clean_sheet_probability_is_monotonic_and_bounded():
    values = [clean_sheet_probability(x) for x in (0.0, 0.5, 1.0, 2.0, 5.0)]
    assert values == sorted(values, reverse=True)  # more xG against -> less likely
    assert all(0.0 <= v <= 1.0 for v in values)


def test_clean_sheet_probability_clamps_negative_input():
    # Defensive clamp: a (theoretically impossible) negative lambda must never
    # produce a "probability" above 1.
    assert clean_sheet_probability(-0.5) == pytest.approx(1.0)


def test_team_snapshot_metrics_sides_mirror_each_other():
    metrics = team_snapshot_metrics(1700, 1450)
    home, away = metrics["home"], metrics["away"]
    assert away["prob_win"] == pytest.approx(home["prob_loss"])
    assert away["prob_loss"] == pytest.approx(home["prob_win"])
    assert away["prob_draw"] == pytest.approx(home["prob_draw"])
    assert away["expected_goals_for"] == pytest.approx(home["expected_goals_against"])
    assert away["expected_goals_against"] == pytest.approx(home["expected_goals_for"])
    for side in (home, away):
        assert side["prob_win"] + side["prob_draw"] + side["prob_loss"] == pytest.approx(1.0)
        assert 0.0 <= side["prob_clean_sheet"] <= 1.0


def test_team_snapshot_metrics_exact_even_default_ratings():
    # Pins the full hand-computed even-match case (same derivation as
    # test_expected_score_exact_with_home_advantage, extended to every
    # snapshot metric): E = 0.5854986787 with the default 60-point advantage,
    # draw = 0.30*(1-|2E-1|), win/loss = (1-draw)*E / (1-draw)*(1-E),
    # xg = 2.7*E / 2.7*(1-E), clean sheet = exp(-xg_against).
    metrics = team_snapshot_metrics(1500, 1500)
    home, away = metrics["home"], metrics["away"]

    assert home["prob_win"] == pytest.approx(0.4398846931, abs=1e-9)
    assert home["prob_draw"] == pytest.approx(0.2487007928, abs=1e-9)
    assert home["prob_loss"] == pytest.approx(0.3114145141, abs=1e-9)
    assert home["expected_goals_for"] == pytest.approx(1.5808464324, abs=1e-9)
    assert home["expected_goals_against"] == pytest.approx(1.1191535676, abs=1e-9)
    assert home["prob_clean_sheet"] == pytest.approx(0.3265560853, abs=1e-9)
    assert away["prob_clean_sheet"] == pytest.approx(0.2058008280, abs=1e-9)


def test_team_snapshot_metrics_agrees_with_its_component_functions():
    # One consistent rating pair in, mutually consistent metrics out -- the
    # combined helper must equal its documented building blocks exactly.
    probs = match_probabilities(1620, 1480)
    xg_home, xg_away = expected_goals(1620, 1480)
    metrics = team_snapshot_metrics(1620, 1480)

    assert metrics["home"]["prob_win"] == pytest.approx(probs["home"])
    assert metrics["home"]["prob_draw"] == pytest.approx(probs["draw"])
    assert metrics["home"]["prob_loss"] == pytest.approx(probs["away"])
    assert metrics["home"]["expected_goals_for"] == pytest.approx(xg_home)
    assert metrics["away"]["expected_goals_for"] == pytest.approx(xg_away)
    assert metrics["home"]["prob_clean_sheet"] == pytest.approx(
        clean_sheet_probability(xg_away)
    )
    assert metrics["away"]["prob_clean_sheet"] == pytest.approx(
        clean_sheet_probability(xg_home)
    )


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
