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
