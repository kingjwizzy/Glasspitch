"""Tests for jobs/seed_ratings.py: static, hand-maintained pre-tournament Elo
priors keyed by API-Football's stable ``api_team_id`` (see that module's
docstring for the diagnosed World Cup Chances bug this table exists to fix --
a host nation's Elo-derived "chances" outranking objectively stronger sides
because every team cold-started at the same ``elo.DEFAULT_RATING``).
"""

import pytest

from jobs import elo
from jobs.seed_ratings import (
    DEFAULT_SEED_RATING,
    SEED_ELO_BY_API_TEAM_ID,
    seed_rating_for_api_team_id,
)


def test_listed_elite_team_seeds_well_above_a_listed_mid_table_team():
    argentina = seed_rating_for_api_team_id(26)  # elite, per the table
    mexico = seed_rating_for_api_team_id(16)  # host, mid-table prior
    assert argentina > mexico
    # A meaningful, tier-sized gap -- not noise (see module docstring: elite
    # ~2000-2085 vs hosts/mid ~1780-1810).
    assert argentina - mexico > 200


def test_tracked_but_unlisted_team_gets_the_default_seed_rating():
    unlisted_api_team_id = 999_999
    assert unlisted_api_team_id not in SEED_ELO_BY_API_TEAM_ID
    assert seed_rating_for_api_team_id(unlisted_api_team_id) == DEFAULT_SEED_RATING


def test_default_seed_rating_is_higher_than_the_true_elo_default():
    # A tracked-but-unlisted team is still a genuine World Cup qualifier --
    # not "unknown" -- so its seed sits above the true "no idea who this is"
    # cold start.
    assert DEFAULT_SEED_RATING > elo.DEFAULT_RATING


def test_missing_api_team_id_falls_back_to_the_true_elo_default_not_the_seed_default():
    # None (no api_team_id at all -- should not happen for a real fixture's
    # team FK, but handled defensively) is the genuine "unknown" case, and
    # gets elo.DEFAULT_RATING, NOT DEFAULT_SEED_RATING.
    assert seed_rating_for_api_team_id(None) == elo.DEFAULT_RATING
    assert seed_rating_for_api_team_id(None) != DEFAULT_SEED_RATING


def test_lookup_is_by_api_team_id_and_returns_the_exact_hand_rated_value():
    # England's api_team_id (10) resolves to its own hand-rated value, not
    # the generic DEFAULT_SEED_RATING fallback.
    assert 10 in SEED_ELO_BY_API_TEAM_ID
    assert seed_rating_for_api_team_id(10) == SEED_ELO_BY_API_TEAM_ID[10]
    assert seed_rating_for_api_team_id(10) != DEFAULT_SEED_RATING


def test_every_seeded_rating_is_a_real_number_above_the_elo_default():
    # Sanity check on the whole static table: every hand-maintained entry is
    # a real qualifier prior, never below the true "unknown" cold start.
    assert SEED_ELO_BY_API_TEAM_ID  # non-empty
    for api_team_id, rating in SEED_ELO_BY_API_TEAM_ID.items():
        assert isinstance(api_team_id, int)
        assert rating > elo.DEFAULT_RATING
