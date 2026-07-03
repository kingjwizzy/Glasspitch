"""Tests for fetch_predictions: % parsing/normalisation, fetch-once, Elo, empties."""

import pytest

from jobs import config, elo, util
from jobs.apiclient import ApiFootballError, RequestBudgetExceeded
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


# --- kickoff window (v2 hardening: config.PREDICTION_FETCH_WINDOW_HOURS) ------
# FakeStore.upcoming_fixtures_within uses a fixed reference "now" (6h before
# make_fixture's default kickoff) unless a test overrides it -- see conftest.py.


def test_run_only_fetches_fixtures_within_the_kickoff_window(
    make_store, make_api, make_fixture, predictions_payload
):
    in_window = make_fixture(
        id=300, api_fixture_id=9001, kickoff_utc="2026-06-11T18:00:00+00:00"  # +6h from "now"
    )
    far_future = make_fixture(
        id=301, api_fixture_id=9002, kickoff_utc="2026-07-01T18:00:00+00:00"  # ~20 days out
    )
    store = make_store(upcoming=[in_window, far_future])
    api = make_api(predictions={9001: predictions_payload, 9002: predictions_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["upcoming"] == 1  # only the in-window fixture is considered at all
    assert api.prediction_calls == [9001]


def test_run_respects_a_custom_window_from_config(
    make_store, make_api, make_fixture, predictions_payload, monkeypatch
):
    # Same far-future fixture as above, but widening the window comfortably
    # past it must bring it back into scope -- proves the bound really is
    # config.PREDICTION_FETCH_WINDOW_HOURS, not a hardcoded constant.
    monkeypatch.setattr(config, "PREDICTION_FETCH_WINDOW_HOURS", 24 * 30)
    fixture = make_fixture(id=301, api_fixture_id=9002, kickoff_utc="2026-07-01T18:00:00+00:00")
    store = make_store(upcoming=[fixture])
    api = make_api(predictions={9002: predictions_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["upcoming"] == 1
    assert api.prediction_calls == [9002]


# --- per-fixture error isolation + graceful budget stop (v2 hardening) --------


def test_run_isolates_one_fixtures_api_error_from_the_rest(
    make_store, make_api, make_fixture, predictions_payload
):
    f1 = make_fixture(id=300, api_fixture_id=9001)
    f2 = make_fixture(id=301, api_fixture_id=9002)
    store = make_store(upcoming=[f1, f2])
    api = make_api(
        predictions={9001: ApiFootballError("upstream 500"), 9002: predictions_payload}
    )

    counts = run(dry_run=False, store=store, api=api)

    assert counts["api_failed"] == 1
    assert counts["api_inserted"] == 1  # fixture 2 still processed
    assert counts["elo_inserted"] == 2  # the Elo pass is unaffected by pass-1 errors


def test_run_stops_api_pass_gracefully_on_budget_exhaustion_but_elo_still_runs(
    make_store, make_api, make_fixture, predictions_payload
):
    f1 = make_fixture(id=300, api_fixture_id=9001)
    f2 = make_fixture(id=301, api_fixture_id=9002)
    store = make_store(upcoming=[f1, f2])
    api = make_api(
        predictions={9001: RequestBudgetExceeded("budget gone"), 9002: predictions_payload}
    )

    counts = run(dry_run=False, store=store, api=api)  # must not raise

    assert counts["budget_exhausted"] is True
    assert counts["api_inserted"] == 0  # stopped before ever reaching fixture 2
    assert api.prediction_calls == [9001]  # fixture 2's /predictions never called
    assert counts["elo_inserted"] == 2  # Elo pass still runs for BOTH fixtures


# --- published_at stamped fresh per insert, not frozen at run start -----------


def test_published_at_is_stamped_fresh_per_insert_not_frozen_at_run_start(
    make_store, make_api, make_fixture, predictions_payload, monkeypatch
):
    f1 = make_fixture(id=300, api_fixture_id=9001)
    f2 = make_fixture(id=301, api_fixture_id=9002)
    store = make_store(upcoming=[f1, f2])
    api = make_api(predictions={9001: predictions_payload, 9002: predictions_payload})

    # Four inserts happen (api x2, elo x2); each must ask the clock separately
    # -- feed a fresh, distinct value per call so a frozen-at-start bug (one
    # shared timestamp for every row) would be caught.
    ticks = iter(
        [
            "2026-06-11T12:00:00+00:00",
            "2026-06-11T12:00:05+00:00",
            "2026-06-11T12:00:10+00:00",
            "2026-06-11T12:00:15+00:00",
        ]
    )
    monkeypatch.setattr(util, "now_utc", lambda: util.parse_iso(next(ticks)))

    run(dry_run=False, store=store, api=api)  # deliberately no `now=` kwarg

    published_ats = [p["published_at"] for p in store.inserted_predictions]
    assert len(published_ats) == 4
    assert len(set(published_ats)) == 4  # every insert got its own fresh stamp


def test_now_kwarg_freezes_the_clock_for_deterministic_tests(
    make_store, make_api, make_fixture, predictions_payload
):
    # The inverse of the above: when `now` IS injected (as every other test in
    # this file relies on), every stamp is that SAME fixed value.
    fixture = make_fixture(id=300, api_fixture_id=9001)
    store = make_store(upcoming=[fixture])
    api = make_api(predictions={9001: predictions_payload})
    fixed_now = util.parse_iso("2026-06-11T12:00:00+00:00")

    run(dry_run=False, store=store, api=api, now=fixed_now)

    published_ats = {p["published_at"] for p in store.inserted_predictions}
    assert published_ats == {fixed_now.isoformat()}


# --- Elo replay scoped to the tracked league(s) + season (v2 hardening) -------
# _derived_ratings calls store.finished_fixtures_for_replay(api_league_ids=...,
# season=...) instead of the old unscoped finished_fixtures_ordered(), so a
# dev back-test season (or an unrelated league) can never leak into the
# replayed ratings pool. FakeStore's wildcard convention (see conftest.py)
# means a fixture only needs "season"/"api_league_id" set when a test wants to
# assert exclusion -- so this test sets them explicitly on the excluded fixture.


def test_elo_replay_excludes_fixtures_outside_the_tracked_season(
    make_store, make_api, make_fixture, monkeypatch
):
    monkeypatch.setattr(config, "SEASON", 2026)
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])

    upcoming = make_fixture(id=300, api_fixture_id=9001, home_team_id=200, away_team_id=201)
    # A big win for team 200 -- but tagged as a DIFFERENT (dev back-test) season,
    # so it must NOT be replayed into the live 2026 ratings pool.
    other_season_result = make_fixture(
        id=290, status="finished", home_team_id=200, away_team_id=201,
        final_home_goals=5, final_away_goals=0, kickoff_utc="2022-06-09T18:00:00+00:00",
        season=2022, api_league_id=1,
    )
    store = make_store(upcoming=[upcoming], finished=[other_season_result])
    api = make_api(predictions={9001: {"response": []}})  # isolate the Elo path

    counts = run(dry_run=False, store=store, api=api)

    assert counts["elo_inserted"] == 1
    elo_row = next(p for p in store.inserted_predictions if p["source"] == "inhouse-elo")
    default_home = elo.match_probabilities(elo.DEFAULT_RATING, elo.DEFAULT_RATING)["home"]
    # If the other season's 5-0 result HAD leaked in, team 200's rating (and
    # thus its home win probability) would be well above the cold-start
    # default; excluded, it stays exactly at default.
    assert elo_row["prob_home"] == pytest.approx(default_home)


def test_elo_replay_excludes_fixtures_from_untracked_leagues(
    make_store, make_api, make_fixture, monkeypatch
):
    monkeypatch.setattr(config, "SEASON", 2026)
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])

    upcoming = make_fixture(id=300, api_fixture_id=9001, home_team_id=200, away_team_id=201)
    other_league_result = make_fixture(
        id=290, status="finished", home_team_id=200, away_team_id=201,
        final_home_goals=5, final_away_goals=0, kickoff_utc="2026-06-09T18:00:00+00:00",
        season=2026, api_league_id=999,  # NOT in TRACKED_LEAGUE_IDS
    )
    store = make_store(upcoming=[upcoming], finished=[other_league_result])
    api = make_api(predictions={9001: {"response": []}})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["elo_inserted"] == 1
    elo_row = next(p for p in store.inserted_predictions if p["source"] == "inhouse-elo")
    default_home = elo.match_probabilities(elo.DEFAULT_RATING, elo.DEFAULT_RATING)["home"]
    assert elo_row["prob_home"] == pytest.approx(default_home)


def test_elo_replay_includes_fixtures_inside_the_tracked_season_and_league(
    make_store, make_api, make_fixture, monkeypatch
):
    monkeypatch.setattr(config, "SEASON", 2026)
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])

    upcoming = make_fixture(id=300, api_fixture_id=9001, home_team_id=200, away_team_id=201)
    tracked_result = make_fixture(
        id=290, status="finished", home_team_id=200, away_team_id=201,
        final_home_goals=5, final_away_goals=0, kickoff_utc="2026-06-09T18:00:00+00:00",
        season=2026, api_league_id=1,
    )
    store = make_store(upcoming=[upcoming], finished=[tracked_result])
    api = make_api(predictions={9001: {"response": []}})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["elo_inserted"] == 1
    elo_row = next(p for p in store.inserted_predictions if p["source"] == "inhouse-elo")
    default_home = elo.match_probabilities(elo.DEFAULT_RATING, elo.DEFAULT_RATING)["home"]
    assert elo_row["prob_home"] > default_home
