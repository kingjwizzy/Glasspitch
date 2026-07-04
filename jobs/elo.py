"""Simple team-rating Elo for the in-house baseline model (ARCHITECTURE.md §9).

The in-house Elo is logged silently alongside the third-party prediction
(``model_version='elo-v1'``, ``source='inhouse-elo'``) so that, over time, it
can be compared to the third-party baseline on the public ledger and promoted
only if it earns its place (§9). It is NOT the primary displayed prediction in
v1.

This is a deliberately simple, fully documented Elo:

* Standard logistic expected-score curve with a 400-point scale.
* A home-advantage term (rating points) added to the home side's rating when
  computing expectations.
* Draws handled with the conventional 0.5 actual-score convention.
* A transparent draw model converts the two-way expected score into three-way
  home/draw/away probabilities for the ledger.

All functions are pure and standard-library only so the maths is easy to verify.
"""

from __future__ import annotations

import math
from typing import Optional

# --- Tunable constants (documented defaults) ---------------------------------
DEFAULT_RATING: float = 1500.0
# K-factor: how strongly a single result moves ratings. 20 is a common club
# default; higher reacts faster but is noisier.
K_FACTOR: float = 20.0
# Home advantage expressed in rating points, added to the home side when forming
# expectations (~60 points is a typical football value).
HOME_ADVANTAGE: float = 60.0
# Maximum draw probability, reached when the two sides are perfectly matched.
DRAW_MAX: float = 0.30
# Baseline expected total goals for an average match, used to derive a crude
# predicted scoreline from the expected score.
EXPECTED_TOTAL_GOALS: float = 2.7


def expected_score(rating_a: float, rating_b: float) -> float:
    """Logistic expected score of A vs B, in (0, 1).

    ``E_a = 1 / (1 + 10^((rating_b - rating_a) / 400))``. A draw counts as 0.5,
    so this is the expected share of the points A takes from the match.
    """
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def _actual_score(home_goals: int, away_goals: int) -> float:
    """Actual score for the HOME side: 1.0 win, 0.5 draw, 0.0 loss."""
    if home_goals > away_goals:
        return 1.0
    if home_goals < away_goals:
        return 0.0
    return 0.5


def update_ratings(
    home_rating: float,
    away_rating: float,
    home_goals: int,
    away_goals: int,
    k: float = K_FACTOR,
    home_advantage: float = HOME_ADVANTAGE,
) -> tuple[float, float]:
    """Return updated ``(home_rating, away_rating)`` after a finished match.

    Uses the home-advantage-adjusted expectation. The update is zero-sum: the
    points the home side gains are exactly the points the away side loses, so the
    total rating in the pool is conserved.
    """
    actual_home = _actual_score(home_goals, away_goals)
    expected_home = expected_score(home_rating + home_advantage, away_rating)
    delta = k * (actual_home - expected_home)
    return (home_rating + delta, away_rating - delta)


def match_probabilities(
    home_rating: float,
    away_rating: float,
    home_advantage: float = HOME_ADVANTAGE,
    draw_max: float = DRAW_MAX,
) -> dict[str, float]:
    """Three-way home/draw/away probabilities from two Elo ratings.

    Returns a dict ``{'home': ..., 'draw': ..., 'away': ...}`` that sums to 1.0
    (within floating-point error).

    The draw model is intentionally simple and documented: draw mass peaks at
    ``draw_max`` when the sides are evenly matched (expected score 0.5) and
    shrinks linearly to 0 as one side dominates. The remaining mass is split
    between home and away in proportion to the (home-advantage-adjusted) expected
    score. This is good enough for a silently-logged baseline (§9); it is not a
    claim to be well-calibrated.
    """
    expected_home = expected_score(home_rating + home_advantage, away_rating)
    # 1 - |2E - 1| is 1 at E=0.5 and 0 at E in {0, 1}.
    prob_draw = draw_max * (1.0 - abs(2.0 * expected_home - 1.0))
    remaining = 1.0 - prob_draw
    prob_home = remaining * expected_home
    prob_away = remaining * (1.0 - expected_home)
    return {"home": prob_home, "draw": prob_draw, "away": prob_away}


def predicted_scoreline(
    home_rating: float,
    away_rating: float,
    home_advantage: float = HOME_ADVANTAGE,
    total_goals: float = EXPECTED_TOTAL_GOALS,
) -> tuple[int, int]:
    """Crude predicted integer scoreline from the expected score.

    Splits an assumed total-goals baseline between the sides in proportion to the
    home-advantage-adjusted expected score and rounds to whole goals. Documented
    as a simple heuristic for the in-house baseline (§9).
    """
    expected_home = expected_score(home_rating + home_advantage, away_rating)
    home_goals = round(total_goals * expected_home)
    away_goals = round(total_goals * (1.0 - expected_home))
    return (int(home_goals), int(away_goals))


def expected_goals(
    home_rating: float,
    away_rating: float,
    home_advantage: float = HOME_ADVANTAGE,
    total_goals: float = EXPECTED_TOTAL_GOALS,
) -> tuple[float, float]:
    """Continuous (un-rounded) expected goals for the home/away side.

    Splits ``total_goals`` between the two sides in proportion to the
    home-advantage-adjusted expected score -- the SAME convention
    :func:`predicted_scoreline` uses to build a display scoreline, but this
    returns raw floats rather than a rounded integer pair, so downstream
    probability maths (e.g. :func:`clean_sheet_probability`) works from the
    un-rounded figure instead of compounding rounding error (ARCHITECTURE.md
    v3 §5, jobs/snapshot_probabilities.py).
    """
    expected_home = expected_score(home_rating + home_advantage, away_rating)
    home_goals = total_goals * expected_home
    away_goals = total_goals * (1.0 - expected_home)
    return (home_goals, away_goals)


def clean_sheet_probability(goals_against_expected: float) -> float:
    """P(a team concedes zero) from its opponent's expected goals.

    Modelled as a Poisson(lambda=``goals_against_expected``) count of goals
    conceded: ``P(X = 0) = exp(-lambda)``. This is the standard, simple
    clean-sheet estimator for a Poisson goals model and is consistent with
    :data:`EXPECTED_TOTAL_GOALS`'s baseline-goals convention used elsewhere in
    this module. Like :func:`match_probabilities`, this is good enough for a
    silently-logged / free Gameweek Board estimate (§9's "not a claim of a
    well-calibrated full goals distribution" caveat applies here too) --
    never a claim of a fully calibrated goals distribution.

    ``goals_against_expected`` is clamped to >= 0 so a (theoretically
    impossible, but defensive) negative input can never produce
    ``exp(positive)`` > 1.
    """
    return math.exp(-max(goals_against_expected, 0.0))


def team_snapshot_metrics(
    home_rating: float,
    away_rating: float,
    *,
    home_advantage: float = HOME_ADVANTAGE,
    draw_max: float = DRAW_MAX,
    total_goals: float = EXPECTED_TOTAL_GOALS,
) -> dict[str, dict[str, float]]:
    """Full per-side snapshot metrics for one fixture, from a single mutually
    consistent set of underlying ratings (jobs/snapshot_probabilities.py,
    ARCHITECTURE.md v3 §5).

    Combines :func:`match_probabilities` (three-way H/D/A), :func:`expected_goals`
    (the continuous home/away split), and :func:`clean_sheet_probability` (each
    side's clean-sheet chance, from the OPPONENT's expected goals) for BOTH
    sides of the fixture. Returns ``{'home': {...}, 'away': {...}}``, each with:

    * ``prob_win`` / ``prob_draw`` / ``prob_loss`` -- three-way outcome
      probabilities from this side's point of view (so ``away.prob_win`` is
      ``home.prob_loss`` and vice versa; ``prob_draw`` is shared).
    * ``expected_goals_for`` / ``expected_goals_against`` -- this side's
      continuous expected goals scored/conceded.
    * ``prob_clean_sheet`` -- ``clean_sheet_probability(expected_goals_against)``.

    Deriving all of these from ONE call keeps them mutually consistent (the
    win/draw/loss split, the goal expectations, and the clean-sheet estimate
    can never independently drift apart from each other for the same
    fixture), rather than computing each metric separately and risking them
    disagreeing on the underlying ratings.
    """
    probs = match_probabilities(
        home_rating, away_rating, home_advantage=home_advantage, draw_max=draw_max
    )
    home_goals, away_goals = expected_goals(
        home_rating, away_rating, home_advantage=home_advantage, total_goals=total_goals
    )
    return {
        "home": {
            "prob_win": probs["home"],
            "prob_draw": probs["draw"],
            "prob_loss": probs["away"],
            "expected_goals_for": home_goals,
            "expected_goals_against": away_goals,
            "prob_clean_sheet": clean_sheet_probability(away_goals),
        },
        "away": {
            "prob_win": probs["away"],
            "prob_draw": probs["draw"],
            "prob_loss": probs["home"],
            "expected_goals_for": away_goals,
            "expected_goals_against": home_goals,
            "prob_clean_sheet": clean_sheet_probability(home_goals),
        },
    }


def ratings_from_results(
    results,
    *,
    default: float = DEFAULT_RATING,
    k: float = K_FACTOR,
    home_advantage: float = HOME_ADVANTAGE,
    initial_ratings: Optional[dict] = None,
) -> dict:
    """Derive current team ratings by replaying finished matches in order.

    ``results`` is an iterable of ``(home_team_id, away_team_id, home_goals,
    away_goals)`` in chronological (kickoff) order. Returns a dict
    ``team_id -> rating``. Teams not yet seen start at ``default`` — this is the
    "cold-start from a default rating" the in-house Elo uses while it is
    logged-only (ARCHITECTURE.md §9). No separate ratings table is required:
    ratings are recomputed from the fixtures history each run.

    ``initial_ratings`` (optional) is a ``team_id -> rating`` map of
    PRE-TOURNAMENT priors (e.g. jobs/seed_ratings.py's static, hand-maintained
    strength table) that a team starts from INSTEAD OF ``default`` the first
    time it's seen here. This exists because a handful of group-stage results
    is not enough signal to tell an elite side from a mid-table host when
    every team cold-starts at the SAME ``default`` (this was the root cause of
    a host nation outranking elite sides in jobs/simulate_chances.py's World
    Cup Chances simulation — see that module's docstring). Omitted / ``None``
    behaves exactly as before this parameter existed: every team cold-starts
    at ``default``. A team present in ``initial_ratings`` but absent from
    every result in ``results`` is still absent from the RETURNED dict (same
    "only teams that have played are keys" convention as always) — callers
    that need a seed to apply even with zero replayed history should merge
    ``initial_ratings`` in themselves (see
    ``jobs.simulate_chances._derived_ratings``).
    """
    ratings: dict = {}
    seeds = initial_ratings or {}
    for home_id, away_id, home_goals, away_goals in results:
        home_rating = ratings.get(home_id, seeds.get(home_id, default))
        away_rating = ratings.get(away_id, seeds.get(away_id, default))
        new_home, new_away = update_ratings(
            home_rating, away_rating, home_goals, away_goals,
            k=k, home_advantage=home_advantage,
        )
        ratings[home_id] = new_home
        ratings[away_id] = new_away
    return ratings
