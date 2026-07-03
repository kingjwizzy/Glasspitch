"""Tests for snapshot_probabilities (W5, migration 0006): the nightly
Gameweek Board / Fixture Ticker snapshots -- two rows per upcoming fixture,
Elo-derived win/draw/loss + clean-sheet + expected-goals maths checked
against hand-computed values, day-over-day delta computation, idempotent
same-day re-runs, the fixture window, and dry-run.

Same conventions as the other job tests: injectable in-memory FakeStore
(conftest.py), no network, no DB. `now` is pinned to FakeStore.DEFAULT_NOW so
snapshot_date / "yesterday" line up with the store's own clock.
"""

import pytest

from jobs import elo, util
from jobs.snapshot_probabilities import build_snapshot_rows, run
from jobs.tests.conftest import FakeStore

NOW = util.parse_iso(FakeStore.DEFAULT_NOW)  # 2026-06-11T12:00:00+00:00
TODAY = "2026-06-11"
YESTERDAY = "2026-06-10"

# Hand-computed constants for two DEFAULT-rated (1500) sides with the module
# defaults (HOME_ADVANTAGE=60, DRAW_MAX=0.30, EXPECTED_TOTAL_GOALS=2.7),
# derived from the documented formulas independently of jobs/elo.py:
#   E        = 1 / (1 + 10^((1500 - 1560) / 400))          = 0.5854986787
#   xg_home  = 2.7 * E                                      = 1.5808464324
#   xg_away  = 2.7 * (1 - E)                                = 1.1191535676
#   cs_home  = exp(-xg_away)   (Poisson P(concede 0))       = 0.3265560853
#   cs_away  = exp(-xg_home)                                = 0.2058008280
#   p_draw   = 0.30 * (1 - |2E - 1|)                        = 0.2487007928
#   p_home   = (1 - p_draw) * E                             = 0.4398846931
#   p_away   = (1 - p_draw) * (1 - E)                       = 0.3114145141
EVEN_XG_HOME = 1.5808464324
EVEN_XG_AWAY = 1.1191535676
EVEN_CS_HOME = 0.3265560853
EVEN_CS_AWAY = 0.2058008280
EVEN_P_HOME = 0.4398846931
EVEN_P_DRAW = 0.2487007928
EVEN_P_AWAY = 0.3114145141


def _rows_by_team(store):
    return {row["team_id"]: row for row in store.snapshots}


def test_writes_two_rows_per_upcoming_fixture(make_store, make_fixture):
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    store = make_store(upcoming=[fixture])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts == {
        "fixtures_seen": 1,
        "snapshots_candidates": 2,
        "snapshots_written": 2,
    }
    rows = _rows_by_team(store)
    assert set(rows) == {200, 201}

    home, away = rows[200], rows[201]
    assert home["snapshot_date"] == TODAY and away["snapshot_date"] == TODAY
    assert home["fixture_id"] == 300 and away["fixture_id"] == 300
    assert home["opponent_team_id"] == 201 and away["opponent_team_id"] == 200
    assert home["is_home"] is True and away["is_home"] is False
    # No finished history -> both sides sit at the cold-start default rating.
    assert home["elo_rating"] == elo.DEFAULT_RATING
    assert away["elo_rating"] == elo.DEFAULT_RATING
    # First-ever snapshot for this (team, fixture) pair -> no deltas yet.
    assert home["delta_elo_rating"] is None and home["delta_prob_win"] is None
    assert away["delta_elo_rating"] is None and away["delta_prob_win"] is None


def test_snapshot_maths_matches_hand_computed_values(make_store, make_fixture):
    """The clean-sheet / expected-goals / three-way derivations, checked
    against the hand-computed constants above -- not against jobs/elo.py's
    own output, so a regression in the maths can't hide behind itself."""
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    store = make_store(upcoming=[fixture])

    run(dry_run=False, store=store, now=NOW)

    home, away = _rows_by_team(store)[200], _rows_by_team(store)[201]

    assert home["prob_win"] == pytest.approx(EVEN_P_HOME, abs=1e-9)
    assert home["prob_draw"] == pytest.approx(EVEN_P_DRAW, abs=1e-9)
    assert home["prob_loss"] == pytest.approx(EVEN_P_AWAY, abs=1e-9)
    assert home["expected_goals_for"] == pytest.approx(EVEN_XG_HOME, abs=1e-9)
    assert home["expected_goals_against"] == pytest.approx(EVEN_XG_AWAY, abs=1e-9)
    assert home["prob_clean_sheet"] == pytest.approx(EVEN_CS_HOME, abs=1e-9)

    # The away side is the exact mirror, from one consistent rating pair.
    assert away["prob_win"] == pytest.approx(EVEN_P_AWAY, abs=1e-9)
    assert away["prob_draw"] == pytest.approx(EVEN_P_DRAW, abs=1e-9)
    assert away["prob_loss"] == pytest.approx(EVEN_P_HOME, abs=1e-9)
    assert away["expected_goals_for"] == pytest.approx(EVEN_XG_AWAY, abs=1e-9)
    assert away["expected_goals_against"] == pytest.approx(EVEN_XG_HOME, abs=1e-9)
    assert away["prob_clean_sheet"] == pytest.approx(EVEN_CS_AWAY, abs=1e-9)

    # DB CHECK invariants hold for what would be written.
    for row in (home, away):
        assert row["prob_win"] + row["prob_draw"] + row["prob_loss"] == pytest.approx(1.0)
        assert 0.0 <= row["prob_clean_sheet"] <= 1.0
        assert row["expected_goals_for"] >= 0 and row["expected_goals_against"] >= 0


def test_replayed_ratings_from_finished_fixtures_feed_the_snapshot(
    make_store, make_fixture
):
    # Team 200 beat 201 earlier in the tournament: the replayed Elo pair (not
    # the cold-start default) must be what the snapshot is computed from.
    played = make_fixture(
        id=299, api_fixture_id=8999, status="finished",
        kickoff_utc="2026-06-08T18:00:00+00:00",
        home_team_id=200, away_team_id=201,
        final_home_goals=3, final_away_goals=0,
    )
    upcoming = make_fixture(id=300, home_team_id=200, away_team_id=201)
    store = make_store(upcoming=[upcoming], finished=[played])

    run(dry_run=False, store=store, now=NOW)

    expected = elo.ratings_from_results([(200, 201, 3, 0)])
    rows = _rows_by_team(store)
    assert rows[200]["elo_rating"] == pytest.approx(expected[200])
    assert rows[201]["elo_rating"] == pytest.approx(expected[201])
    assert rows[200]["elo_rating"] > elo.DEFAULT_RATING > rows[201]["elo_rating"]
    # The winner is now likelier to win / keep a clean sheet than the loser.
    assert rows[200]["prob_win"] > rows[201]["prob_win"]
    assert rows[200]["prob_clean_sheet"] > rows[201]["prob_clean_sheet"]


# --- day-over-day deltas -------------------------------------------------------


def test_deltas_are_computed_against_yesterdays_snapshot(make_store, make_fixture):
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    prior = [
        {
            "snapshot_date": YESTERDAY, "team_id": 200, "fixture_id": 300,
            "elo_rating": 1490.0, "prob_win": 0.40,
        },
        {
            "snapshot_date": YESTERDAY, "team_id": 201, "fixture_id": 300,
            "elo_rating": 1512.0, "prob_win": 0.35,
        },
    ]
    store = make_store(upcoming=[fixture], snapshots=prior)

    run(dry_run=False, store=store, now=NOW)

    today = {
        (r["team_id"]): r for r in store.snapshots if r["snapshot_date"] == TODAY
    }
    # Today both sides compute at the default 1500 rating (no finished
    # history), so delta = today's value minus yesterday's stored value.
    assert today[200]["delta_elo_rating"] == pytest.approx(1500.0 - 1490.0)
    assert today[201]["delta_elo_rating"] == pytest.approx(1500.0 - 1512.0)
    assert today[200]["delta_prob_win"] == pytest.approx(EVEN_P_HOME - 0.40, abs=1e-9)
    assert today[201]["delta_prob_win"] == pytest.approx(EVEN_P_AWAY - 0.35, abs=1e-9)
    # Yesterday's rows themselves are never touched.
    assert [r for r in store.snapshots if r["snapshot_date"] == YESTERDAY] == prior


def test_prior_rows_for_other_fixtures_or_older_dates_never_match(
    make_store, make_fixture
):
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    decoys = [
        # Same team, DIFFERENT fixture, yesterday: not this pair's history.
        {
            "snapshot_date": YESTERDAY, "team_id": 200, "fixture_id": 999,
            "elo_rating": 1400.0, "prob_win": 0.10,
        },
        # Same team and fixture, but two days ago: deltas are strictly
        # day-over-day, never "vs whatever was seen last".
        {
            "snapshot_date": "2026-06-09", "team_id": 200, "fixture_id": 300,
            "elo_rating": 1400.0, "prob_win": 0.10,
        },
    ]
    store = make_store(upcoming=[fixture], snapshots=decoys)

    run(dry_run=False, store=store, now=NOW)

    today = {
        r["team_id"]: r for r in store.snapshots if r["snapshot_date"] == TODAY
    }
    assert today[200]["delta_elo_rating"] is None
    assert today[200]["delta_prob_win"] is None


def test_build_snapshot_rows_delta_arithmetic_is_per_team(make_fixture):
    # Pure-function check of the delta wiring: one side has a prior, the
    # other doesn't -- deltas must be independent per team.
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    ratings = {200: 1520.0}  # away side falls back to the default 1500
    prior_by_team = {200: {"elo_rating": 1500.0, "prob_win": 0.50}}

    home, away = build_snapshot_rows(
        fixture, ratings=ratings, snapshot_date=TODAY, prior_by_team=prior_by_team
    )

    assert home["delta_elo_rating"] == pytest.approx(20.0)
    assert home["delta_prob_win"] == pytest.approx(home["prob_win"] - 0.50)
    assert away["delta_elo_rating"] is None
    assert away["delta_prob_win"] is None
    assert away["elo_rating"] == elo.DEFAULT_RATING


# --- idempotency / dry-run / window -------------------------------------------


def test_same_day_rerun_is_idempotent_and_never_double_applies_deltas(
    make_store, make_fixture
):
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    prior = [
        {
            "snapshot_date": YESTERDAY, "team_id": 200, "fixture_id": 300,
            "elo_rating": 1490.0, "prob_win": 0.40,
        },
    ]
    store = make_store(upcoming=[fixture], snapshots=prior)

    run(dry_run=False, store=store, now=NOW)
    first = [dict(r) for r in store.snapshots if r["snapshot_date"] == TODAY]
    run(dry_run=False, store=store, now=NOW)
    second = [dict(r) for r in store.snapshots if r["snapshot_date"] == TODAY]

    # Upsert on the (snapshot_date, team_id, fixture_id) PK: still exactly two
    # today-rows, byte-identical to the first run -- the delta was recomputed
    # against the FIXED yesterday row, not against the first run's output.
    assert len(second) == 2
    assert second == first
    assert len(store.snapshot_writes) == 2  # two upsert calls, one per run


def test_dry_run_writes_nothing(make_store, make_fixture):
    fixture = make_fixture(id=300, home_team_id=200, away_team_id=201)
    store = make_store(upcoming=[fixture])

    counts = run(dry_run=True, store=store, now=NOW)

    assert counts["fixtures_seen"] == 1
    assert counts["snapshots_candidates"] == 2  # would write these
    assert counts["snapshots_written"] == 0
    assert store.snapshots == []
    assert store.snapshot_writes == []


def test_fixtures_beyond_the_snapshot_window_are_not_snapshotted(
    make_store, make_fixture, monkeypatch
):
    import jobs.config as config_module

    monkeypatch.setattr(config_module, "SNAPSHOT_FIXTURE_WINDOW_HOURS", 24.0 * 14)
    inside = make_fixture(
        id=300, api_fixture_id=9000, kickoff_utc="2026-06-20T18:00:00+00:00"
    )
    outside = make_fixture(
        id=301, api_fixture_id=9001, kickoff_utc="2026-07-15T18:00:00+00:00"
    )
    store = make_store(upcoming=[inside, outside])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["fixtures_seen"] == 1
    assert {r["fixture_id"] for r in store.snapshots} == {300}
