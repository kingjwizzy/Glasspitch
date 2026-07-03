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


# --- score_results is inverted: it queries the small self-draining locked/
# finished set, not every finished fixture ever (v2 hardening) --------------


def test_run_ignores_finished_fixtures_with_no_locked_prediction(
    make_store, make_fixture, make_prediction
):
    # A finished fixture whose only prediction is already scored (or none at
    # all) must cost nothing -- locked_predictions_due_for_scoring() is a
    # bounded, self-draining query, not a full finished-fixtures rescan.
    fixture = make_fixture(id=300, status="finished", final_home_goals=1, final_away_goals=0)
    store = make_store(finished=[fixture], predictions=[])
    counts = run(dry_run=False, store=store)
    assert counts["locked_due"] == 0
    assert counts["predictions_scored"] == 0


# --- consistency pass: SCORED rows whose fixture's final score has since ----
# changed are logged loudly for manual review, NEVER silently rewritten -----
# (the migration-0003 trigger freezes scored fields once scored_at is set) --


def test_scored_final_score_mismatch_is_logged_and_never_rewritten(
    make_store, make_fixture, make_prediction, caplog
):
    # The fixture's CURRENT final score (2-1) no longer matches what this
    # already-scored prediction recorded (1-1) -- a provider correction after
    # the fact.
    fixture = make_fixture(id=300, status="finished", final_home_goals=2, final_away_goals=1)
    pred = make_prediction(
        id="p1", fixture_id=300, status="scored",
        final_home_goals=1, final_away_goals=1, result="draw",
        brier_score=0.5, log_loss=0.7, scored_at="2026-06-11T20:00:00+00:00",
    )
    store = make_store(finished=[fixture], predictions=[pred])

    with caplog.at_level("WARNING"):
        counts = run(dry_run=False, store=store)

    assert counts["scored_final_score_mismatches"] == 1
    assert "SCORE MISMATCH" in caplog.text
    # Frozen: the scored row itself must be left exactly as it was.
    scored_pred = store.predictions[0]
    assert scored_pred["final_home_goals"] == 1
    assert scored_pred["final_away_goals"] == 1
    assert scored_pred["result"] == "draw"
    assert store.scored == []  # write_prediction_score was never called for it


def test_no_mismatch_reported_when_scored_row_matches_the_fixture(
    make_store, make_fixture, make_prediction
):
    fixture = make_fixture(id=300, status="finished", final_home_goals=2, final_away_goals=1)
    pred = make_prediction(
        id="p1", fixture_id=300, status="scored",
        final_home_goals=2, final_away_goals=1, result="home",
        brier_score=0.2, log_loss=0.3, scored_at="2026-06-11T20:00:00+00:00",
    )
    store = make_store(finished=[fixture], predictions=[pred])

    counts = run(dry_run=False, store=store)

    assert counts["scored_final_score_mismatches"] == 0
