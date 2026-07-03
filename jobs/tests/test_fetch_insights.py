"""Tests for jobs.fetch_insights: post-match stats curation, the candidate
window (fixtures_needing_stats via FakeStore), graceful budget stop, per-fixture
error isolation, dry-run, and idempotent upsert (ARCHITECTURE.md v2 §4/§7/§8).

Mirrors test_fetch_predictions.py's conventions -- FakeStore/FakeApiClient
(conftest.py), no network/DB.
"""

from __future__ import annotations

import pytest

from jobs import config
from jobs.apiclient import ApiFootballError, RequestBudgetExceeded
from jobs.fetch_insights import parse_fixture_statistics, run


# --- parse_fixture_statistics: curation, unit-level -------------------------


def test_parse_fixture_statistics_curates_known_types_and_drops_unmapped(statistics_payload):
    parsed = parse_fixture_statistics(
        statistics_payload, home_team_api_id=2380, away_team_api_id=26
    )
    assert parsed is not None

    home = parsed["home"]
    assert home["shots_on_goal"] == 5
    assert home["shots_off_goal"] == 3
    assert home["shots_total"] == 10
    assert home["shots_blocked"] == 2
    assert home["shots_inside_box"] == 6
    assert home["shots_outside_box"] == 4
    assert home["fouls"] == 8
    assert home["corners"] == 4
    assert home["offsides"] == 1
    assert home["yellow_cards"] == 2
    assert home["red_cards"] == 0
    assert home["goalkeeper_saves"] == 3
    assert home["passes_total"] == 450
    assert home["passes_accurate"] == 400

    # statistics_payload's home block has 18 raw stat entries: the 17 known
    # types in _STAT_KEY_MAP (including possession_pct/passes_accuracy_pct/xg,
    # whose percent/xg-string conversions are asserted separately below) plus
    # one deliberately-unmapped "Expected goals bucket" -- the curated dict
    # must carry exactly those 17 known keys, never an 18th raw leftover.
    assert len(home) == 17
    assert "expected goals bucket" not in home


def test_parse_fixture_statistics_converts_percent_and_xg_strings_to_floats(statistics_payload):
    parsed = parse_fixture_statistics(
        statistics_payload, home_team_api_id=2380, away_team_api_id=26
    )
    assert parsed["home"]["possession_pct"] == pytest.approx(55.0)
    assert parsed["home"]["passes_accuracy_pct"] == pytest.approx(89.0)
    assert parsed["home"]["xg"] == pytest.approx(1.8)
    assert isinstance(parsed["home"]["xg"], float)

    assert parsed["away"]["possession_pct"] == pytest.approx(45.0)
    assert parsed["away"]["xg"] == pytest.approx(1.1)


def test_parse_fixture_statistics_empty_response_is_none():
    assert parse_fixture_statistics({"response": []}, home_team_api_id=1, away_team_api_id=2) is None
    assert parse_fixture_statistics({}, home_team_api_id=1, away_team_api_id=2) is None


def test_parse_fixture_statistics_missing_one_side_yields_empty_dict_for_that_side(
    statistics_payload,
):
    # Only the away team (api id 26) is asked for; home isn't in this fixture's
    # team-id set at all -- home comes back {} (not None: the overall payload
    # still has usable data), so the caller can still store the away side.
    parsed = parse_fixture_statistics(
        statistics_payload, home_team_api_id=999999, away_team_api_id=26
    )
    assert parsed is not None
    assert parsed["home"] == {}
    assert parsed["away"]["possession_pct"] == pytest.approx(45.0)


def test_parse_fixture_statistics_both_sides_absent_is_none(statistics_payload):
    parsed = parse_fixture_statistics(
        statistics_payload, home_team_api_id=111, away_team_api_id=222
    )
    assert parsed is None


# --- run(): candidate window, happy path, idempotency ------------------------


def _finished_scored_fixture(make_fixture, make_prediction, *, fixture_id, api_fixture_id, **overrides):
    """A finished fixture (tracked league/season by default -- config.py's
    wildcard convention, see conftest.py) with a SCORED api-football
    prediction: fetch_insights.py's candidate shape."""
    fixture = make_fixture(
        id=fixture_id,
        api_fixture_id=api_fixture_id,
        status="finished",
        final_home_goals=2,
        final_away_goals=1,
        home_team_api_id=overrides.pop("home_team_api_id", 2380),
        away_team_api_id=overrides.pop("away_team_api_id", 26),
        **overrides,
    )
    prediction = make_prediction(
        id=f"pred-{fixture_id}",
        fixture_id=fixture_id,
        source="api-football",
        status="scored",
        final_home_goals=2,
        final_away_goals=1,
        result="home",
    )
    return fixture, prediction


def test_run_happy_path_curates_and_stores_one_insight_per_fixture(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    fixture, prediction = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500
    )
    store = make_store(finished=[fixture], predictions=[prediction])
    api = make_api(statistics={9500: statistics_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["candidates"] == 1
    assert counts["fetched"] == 1
    assert counts["inserted"] == 1
    assert counts["empty"] == 0
    assert counts["failed"] == 0
    assert counts["budget_exhausted"] is False
    assert api.statistics_calls == [9500]  # exactly one call for the one fixture

    assert len(store.insights) == 1
    insight = store.insights[0]
    assert insight["fixture_id"] == 500
    assert insight["kind"] == "post_match_stats"
    assert insight["source"] == "api-football"
    assert insight["payload"]["home"]["shots_on_goal"] == 5


def test_run_never_offers_a_fixture_that_already_has_a_post_match_stats_insight(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    fixture, prediction = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500
    )
    existing_insight = {
        "fixture_id": 500,
        "kind": "post_match_stats",
        "payload": {"home": {}, "away": {}},
        "source": "api-football",
    }
    store = make_store(finished=[fixture], predictions=[prediction], insights=[existing_insight])
    api = make_api(statistics={9500: statistics_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["candidates"] == 0  # already covered -- never even offered
    assert api.statistics_calls == []  # never fetched again
    assert len(store.insights) == 1  # unchanged


def test_run_excludes_a_finished_fixture_with_no_scored_api_prediction_yet(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    fixture, prediction = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500
    )
    prediction["status"] = "locked"  # not scored yet
    store = make_store(finished=[fixture], predictions=[prediction])
    api = make_api(statistics={9500: statistics_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["candidates"] == 0
    assert api.statistics_calls == []


def test_run_excludes_fixtures_outside_the_tracked_season_or_league(
    make_store, make_api, make_fixture, make_prediction, statistics_payload, monkeypatch
):
    monkeypatch.setattr(config, "SEASON", 2026)
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])

    other_season_fixture, other_season_pred = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500,
        season=2022, api_league_id=1,
    )
    other_league_fixture, other_league_pred = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=501, api_fixture_id=9501,
        season=2026, api_league_id=999,
    )
    store = make_store(
        finished=[other_season_fixture, other_league_fixture],
        predictions=[other_season_pred, other_league_pred],
    )
    api = make_api(statistics={9500: statistics_payload, 9501: statistics_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["candidates"] == 0
    assert api.statistics_calls == []


def test_run_orders_candidates_most_recently_finished_first(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    older, older_pred = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500,
        kickoff_utc="2026-06-01T18:00:00+00:00",
    )
    newer, newer_pred = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=501, api_fixture_id=9501,
        kickoff_utc="2026-06-05T18:00:00+00:00",
    )
    store = make_store(finished=[older, newer], predictions=[older_pred, newer_pred])
    api = make_api(statistics={9500: statistics_payload, 9501: statistics_payload})

    run(dry_run=False, store=store, api=api)

    assert api.statistics_calls == [9501, 9500]  # newer (fixture 501) fetched first


def test_run_empty_statistics_response_is_skipped_not_stored(
    make_store, make_api, make_fixture, make_prediction
):
    fixture, prediction = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500
    )
    store = make_store(finished=[fixture], predictions=[prediction])
    api = make_api(statistics={9500: {"response": []}})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["empty"] == 1
    assert counts["inserted"] == 0
    assert store.insights == []


def test_run_isolates_one_fixtures_api_error_from_the_rest(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    f1, p1 = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500,
        kickoff_utc="2026-06-05T18:00:00+00:00",
    )
    f2, p2 = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=501, api_fixture_id=9501,
        kickoff_utc="2026-06-01T18:00:00+00:00",
    )
    store = make_store(finished=[f1, f2], predictions=[p1, p2])
    api = make_api(
        statistics={9500: ApiFootballError("upstream 500"), 9501: statistics_payload}
    )

    counts = run(dry_run=False, store=store, api=api)

    assert counts["failed"] == 1
    assert counts["inserted"] == 1  # the second (older) fixture still processed
    assert len(store.insights) == 1
    assert store.insights[0]["fixture_id"] == 501


def test_run_stops_gracefully_on_budget_exhaustion(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    f1, p1 = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500,
        kickoff_utc="2026-06-05T18:00:00+00:00",
    )
    f2, p2 = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=501, api_fixture_id=9501,
        kickoff_utc="2026-06-01T18:00:00+00:00",
    )
    store = make_store(finished=[f1, f2], predictions=[p1, p2])
    api = make_api(
        statistics={9500: RequestBudgetExceeded("budget gone"), 9501: statistics_payload}
    )

    counts = run(dry_run=False, store=store, api=api)  # must not raise

    assert counts["budget_exhausted"] is True
    assert counts["inserted"] == 0
    assert api.statistics_calls == [9500]  # stopped before ever reaching fixture 501
    assert store.insights == []


def test_run_dry_run_writes_nothing_but_still_fetches(
    make_store, make_api, make_fixture, make_prediction, statistics_payload
):
    fixture, prediction = _finished_scored_fixture(
        make_fixture, make_prediction, fixture_id=500, api_fixture_id=9500
    )
    store = make_store(finished=[fixture], predictions=[prediction])
    api = make_api(statistics={9500: statistics_payload})

    counts = run(dry_run=True, store=store, api=api)

    assert counts["fetched"] == 1
    assert counts["inserted"] == 0  # no writes at all in dry-run
    assert store.insights == []
    assert api.request_count == 1  # but the API is still called in dry-run


def test_run_no_candidates_is_a_no_op(make_store, make_api):
    store = make_store()
    api = make_api()

    counts = run(dry_run=False, store=store, api=api)

    assert counts["candidates"] == 0
    assert counts["fetched"] == 0
    assert counts["inserted"] == 0
    assert api.statistics_calls == []
