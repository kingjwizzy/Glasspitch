"""Tests for score_results: locked->scored, Brier/log-loss, idempotency, dry-run."""

import pytest

from jobs import scoring
from jobs.score_results import run


def test_scores_locked_prediction(make_store, make_fixture, make_prediction):
    fixture = make_fixture(
        id=300, status="finished", final_home_goals=2, final_away_goals=1,
        home_team_id=200, away_team_id=201,
    )
    pred = make_prediction(
        id="p1", fixture_id=300, status="locked",
        prob_home=0.5, prob_draw=0.3, prob_away=0.2,
    )
    store = make_store(finished=[fixture], predictions=[pred])

    counts = run(dry_run=False, store=store)

    assert counts["predictions_scored"] == 1
    scored = store.predictions[0]
    assert scored["status"] == "scored"
    assert scored["result"] == "home"
    assert scored["final_home_goals"] == 2 and scored["final_away_goals"] == 1
    assert scored["brier_score"] == pytest.approx(scoring.brier_score(0.5, 0.3, 0.2, "home"))
    assert scored["log_loss"] == pytest.approx(scoring.log_loss(0.5, 0.3, 0.2, "home"))


def test_draw_result(make_store, make_fixture, make_prediction):
    fixture = make_fixture(id=301, status="finished", final_home_goals=1, final_away_goals=1)
    pred = make_prediction(id="p2", fixture_id=301, status="locked")
    store = make_store(finished=[fixture], predictions=[pred])
    run(dry_run=False, store=store)
    assert store.predictions[0]["result"] == "draw"


def test_idempotent_skips_already_scored(make_store, make_fixture, make_prediction):
    fixture = make_fixture(id=300, status="finished", final_home_goals=1, final_away_goals=1)
    pred = make_prediction(id="p1", fixture_id=300, status="scored")
    store = make_store(finished=[fixture], predictions=[pred])
    counts = run(dry_run=False, store=store)
    assert counts["predictions_scored"] == 0
    assert store.scored == []


def test_missing_final_score_is_skipped(make_store, make_fixture, make_prediction):
    fixture = make_fixture(
        id=300, status="finished", final_home_goals=None, final_away_goals=None
    )
    pred = make_prediction(id="p1", fixture_id=300, status="locked")
    store = make_store(finished=[fixture], predictions=[pred])
    counts = run(dry_run=False, store=store)
    assert counts["skipped_no_score"] == 1
    assert counts["predictions_scored"] == 0


def test_dry_run_writes_nothing(make_store, make_fixture, make_prediction):
    fixture = make_fixture(id=300, status="finished", final_home_goals=2, final_away_goals=0)
    pred = make_prediction(id="p1", fixture_id=300, status="locked")
    store = make_store(finished=[fixture], predictions=[pred])
    counts = run(dry_run=True, store=store)
    assert counts["predictions_scored"] == 1  # would score
    assert store.scored == []  # but no write
    assert store.predictions[0]["status"] == "locked"
