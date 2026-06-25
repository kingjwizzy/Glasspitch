"""Tests for fetch_predictions: % parsing/normalisation, fetch-once, Elo, empties."""

import pytest

from jobs import elo
from jobs.fetch_predictions import (
    normalise_probabilities,
    parse_api_prediction,
    parse_percent,
    predicted_scoreline_from_probabilities,
    run,
)


def test_parse_percent():
    assert parse_percent("45%") == pytest.approx(0.45)
    assert parse_percent("0%") == 0.0
    assert parse_percent(30) == pytest.approx(0.30)


def test_normalise_probabilities_sums_to_one():
    home, draw, away = normalise_probabilities(0.4, 0.3, 0.4)  # sums to 1.1
    assert home + draw + away == pytest.approx(1.0)
    assert home == pytest.approx(0.4 / 1.1)


def test_normalise_probabilities_zero_total_raises():
    with pytest.raises(ValueError):
        normalise_probabilities(0, 0, 0)


def test_predicted_scoreline_from_probabilities():
    home_goals, away_goals = predicted_scoreline_from_probabilities(0.6, 0.25, 0.15)
    assert isinstance(home_goals, int) and isinstance(away_goals, int)
    assert home_goals >= away_goals


def test_parse_api_prediction(predictions_payload):
    parsed = parse_api_prediction(predictions_payload)
    assert parsed is not None
    assert parsed.prob_home + parsed.prob_draw + parsed.prob_away == pytest.approx(1.0)
    assert parsed.prob_home == pytest.approx(0.5)
    assert parsed.advice == "Double chance : Brazil or draw"


def test_parse_api_prediction_empty_is_none():
    assert parse_api_prediction({"response": []}) is None
    assert parse_api_prediction({}) is None


def test_run_inserts_api_and_elo(make_store, make_api, make_fixture, predictions_payload):
    fixture = make_fixture(id=300, api_fixture_id=9001, home_team_id=200, away_team_id=201)
    store = make_store(upcoming=[fixture])
    api = make_api(predictions={9001: predictions_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["api_inserted"] == 1
    assert counts["elo_inserted"] == 1
    assert api.request_count == 1  # exactly one prediction call for the one fixture
    assert {p["source"] for p in store.inserted_predictions} == {
        "api-football",
        "inhouse-elo",
    }
    for pred in store.inserted_predictions:
        assert pred["status"] == "published"
        assert pred["locked_at"] == "2026-06-11T18:00:00+00:00"
        assert pred["prob_home"] + pred["prob_draw"] + pred["prob_away"] == pytest.approx(1.0)

    # The api-football row must map probabilities and the scoreline in the right
    # order (50/30/20 -> 0.5/0.3/0.2; derived scoreline 2-1). A prob/scoreline
    # swap would still sum to 1.0, so assert the concrete fields.
    api_row = next(p for p in store.inserted_predictions if p["source"] == "api-football")
    assert api_row["prob_home"] == pytest.approx(0.5)
    assert api_row["prob_draw"] == pytest.approx(0.3)
    assert api_row["prob_away"] == pytest.approx(0.2)
    assert api_row["predicted_home_goals"] == 2
    assert api_row["predicted_away_goals"] == 1


def test_run_fetches_each_fixture_only_once(
    make_store, make_api, make_fixture, make_prediction, predictions_payload
):
    fixture = make_fixture(id=300, api_fixture_id=9001)
    existing = make_prediction(
        id="existing", fixture_id=300, source="api-football", model_version="api-football-v1"
    )
    store = make_store(upcoming=[fixture], predictions=[existing])
    api = make_api(predictions={9001: predictions_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert api.prediction_calls == []  # never re-fetched
    assert counts["api_skipped_existing"] == 1
    assert counts["elo_inserted"] == 1  # Elo is still added alongside


def test_run_handles_empty_prediction_gracefully(make_store, make_api, make_fixture):
    fixture = make_fixture(id=300, api_fixture_id=9001)
    store = make_store(upcoming=[fixture])
    api = make_api(predictions={9001: {"response": []}})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["api_empty"] == 1
    assert counts["api_inserted"] == 0
    assert counts["elo_inserted"] == 1  # no crash; Elo still logged


def test_run_dry_run_writes_nothing_but_still_fetches(
    make_store, make_api, make_fixture, predictions_payload
):
    fixture = make_fixture(id=300, api_fixture_id=9001)
    store = make_store(upcoming=[fixture])
    api = make_api(predictions={9001: predictions_payload})

    run(dry_run=True, store=store, api=api)

    assert store.inserted_predictions == []  # no writes
    assert api.request_count == 1  # but the API is still called in dry-run


def test_run_elo_uses_replayed_ratings(make_store, make_api, make_fixture):
    # One valid finished result (team 200 beat 201, 2-0) plus a finished fixture
    # with NULL goals that must be filtered out by _derived_ratings without
    # crashing. The replayed win should lift team 200's rating above default.
    upcoming = make_fixture(id=300, api_fixture_id=9001, home_team_id=200, away_team_id=201)
    finished_valid = make_fixture(
        id=290, status="finished", home_team_id=200, away_team_id=201,
        final_home_goals=2, final_away_goals=0, kickoff_utc="2026-06-09T18:00:00+00:00",
    )
    finished_null = make_fixture(
        id=291, status="finished", home_team_id=200, away_team_id=201,
        final_home_goals=None, final_away_goals=None, kickoff_utc="2026-06-08T18:00:00+00:00",
    )
    store = make_store(upcoming=[upcoming], finished=[finished_valid, finished_null])
    api = make_api(predictions={9001: {"response": []}})  # focus on the Elo path

    counts = run(dry_run=False, store=store, api=api)

    assert counts["elo_inserted"] == 1  # no crash despite the null-goal fixture
    elo_row = next(p for p in store.inserted_predictions if p["source"] == "inhouse-elo")
    default_home = elo.match_probabilities(elo.DEFAULT_RATING, elo.DEFAULT_RATING)["home"]
    assert elo_row["prob_home"] > default_home
