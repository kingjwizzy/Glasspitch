"""Tests for fetch_fixtures: status mapping, parsing, idempotent upserts, dry-run."""

from datetime import timedelta

from jobs import config, util
from jobs.apiclient import ApiFootballError, RequestBudgetExceeded
from jobs.fetch_fixtures import map_fixture_status, parse_fixture, run


def test_status_mapping_known_codes():
    assert map_fixture_status("NS") == "scheduled"
    assert map_fixture_status("TBD") == "scheduled"
    assert map_fixture_status("1H") == "live"
    assert map_fixture_status("HT") == "live"
    assert map_fixture_status("FT") == "finished"
    assert map_fixture_status("AET") == "finished"
    assert map_fixture_status("PEN") == "finished"
    assert map_fixture_status("PST") == "postponed"
    assert map_fixture_status("CANC") == "postponed"


def test_status_mapping_unknown_defaults_to_scheduled():
    assert map_fixture_status("ZZZ") == "scheduled"
    assert map_fixture_status(None) == "scheduled"


def test_parse_fixture_upcoming(fixtures_payload):
    parsed = parse_fixture(fixtures_payload["response"][0], default_season=2026)
    assert parsed.api_fixture_id == 9001
    assert parsed.status == "scheduled"
    assert parsed.home.name == "Brazil"
    assert parsed.home.slug == "brazil"
    assert parsed.away.slug == "argentina"
    assert parsed.kickoff_utc == "2026-06-11T16:00:00+00:00"
    assert parsed.final_home_goals is None and parsed.final_away_goals is None
    assert parsed.league_slug == "world-cup"


def test_parse_fixture_finished_stores_final_score(fixtures_payload):
    parsed = parse_fixture(fixtures_payload["response"][1], default_season=2026)
    assert parsed.status == "finished"
    assert parsed.final_home_goals == 2
    assert parsed.final_away_goals == 1


def test_run_upserts_idempotent_keys(store, make_api, fixtures_payload):
    api = make_api(fixtures=fixtures_payload)
    counts = run(dry_run=False, store=store, api=api)
    assert counts["fixtures_seen"] == 2
    assert counts["fixtures_upserted"] == 2
    assert counts["leagues_upserted"] == 1  # single league, deduped within the run
    assert counts["teams_upserted"] == 4  # four distinct teams
    assert len(store.upserted_fixtures) == 2
    assert api.request_count == 1  # one API call per tracked league


def test_run_dry_run_writes_nothing(store, make_api, fixtures_payload):
    api = make_api(fixtures=fixtures_payload)
    counts = run(dry_run=True, store=store, api=api)
    assert counts["fixtures_seen"] == 2
    assert counts["fixtures_upserted"] == 0
    assert store.upserted_fixtures == []
    assert store.upserted_leagues == []
    assert store.upserted_teams == []
    assert api.request_count == 1


def test_parse_fixture_finished_falls_back_to_goals_with_lowercase_status():
    # status 'ft' (lowercase) maps to finished, and when score.fulltime is null
    # the final score falls back to the goals object.
    item = {
        "fixture": {"id": 9003, "date": "2026-06-10T16:00:00+00:00", "status": {"short": "ft"}},
        "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
        "teams": {"home": {"id": 2, "name": "France"}, "away": {"id": 25, "name": "Germany"}},
        "goals": {"home": 3, "away": 2},
        "score": {"fulltime": {"home": None, "away": None}},
    }
    parsed = parse_fixture(item, default_season=2026)
    assert parsed.status == "finished"
    assert parsed.final_home_goals == 3
    assert parsed.final_away_goals == 2


def test_status_mapping_is_case_insensitive():
    assert map_fixture_status("ns") == "scheduled"
    assert map_fixture_status("ft") == "finished"


# --- pagination (v2 hardening: fetch_fixtures loops through every /fixtures page) --


def _fixture_item(api_fixture_id, home_id, home_name, away_id, away_name, *, date):
    return {
        "fixture": {"id": api_fixture_id, "date": date, "status": {"short": "NS"}},
        "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
        "teams": {
            "home": {"id": home_id, "name": home_name},
            "away": {"id": away_id, "name": away_name},
        },
        "goals": {"home": None, "away": None},
        "score": {"fulltime": {"home": None, "away": None}},
    }


def test_run_paginates_across_multiple_fixture_pages(store, make_api):
    page1 = {
        "response": [_fixture_item(9001, 1, "Brazil", 2, "Argentina", date="2026-06-11T16:00:00+00:00")],
        "paging": {"current": 1, "total": 2},
    }
    page2 = {
        "response": [_fixture_item(9002, 3, "France", 4, "Germany", date="2026-06-12T16:00:00+00:00")],
        "paging": {"current": 2, "total": 2},
    }
    api = make_api(fixtures_pages=[page1, page2])

    counts = run(dry_run=False, store=store, api=api)

    assert counts["fixtures_seen"] == 2
    assert counts["fixtures_upserted"] == 2
    assert len(store.upserted_fixtures) == 2
    assert api.request_count == 2  # one request per page
    assert api.fixture_calls == [(1, config.SEASON, 1), (1, config.SEASON, 2)]


def test_run_single_page_response_makes_exactly_one_request(store, make_api, fixtures_payload):
    # fixtures_payload carries no "paging" key at all -- the loop must treat
    # that as "one page total" and not attempt a second request.
    api = make_api(fixtures=fixtures_payload)
    run(dry_run=False, store=store, api=api)
    assert api.request_count == 1


# --- per-league error isolation + graceful budget stop (v2 hardening) ---------


def test_run_continues_to_next_league_after_one_leagues_api_error(store, make_api, monkeypatch):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1, 2])
    league2_payload = {
        "response": [_fixture_item(9101, 11, "Spain", 12, "Italy", date="2026-06-13T16:00:00+00:00")],
    }
    api = make_api(
        fixtures_by_league={
            1: ApiFootballError("upstream 500"),
            2: league2_payload,
        }
    )

    counts = run(dry_run=False, store=store, api=api)

    assert counts["leagues_failed"] == 1
    # League 1 contributed nothing; league 2's fixture was still written.
    assert counts["fixtures_upserted"] == 1
    assert len(store.upserted_fixtures) == 1


def test_run_stops_gracefully_on_budget_exhaustion_without_crashing(store, make_api, monkeypatch):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1, 2])
    league2_payload = {
        "response": [_fixture_item(9102, 21, "Spain", 22, "Italy", date="2026-06-13T16:00:00+00:00")],
    }
    api = make_api(
        fixtures_by_league={
            1: RequestBudgetExceeded("budget gone"),
            2: league2_payload,
        }
    )

    counts = run(dry_run=False, store=store, api=api)  # must not raise

    assert counts["leagues_failed"] == 1
    # Budget exhaustion ends the WHOLE run (break, not continue) -- league 2
    # must never even be attempted.
    assert store.upserted_fixtures == []
    assert all(call[0] != 2 for call in api.fixture_calls)


# --- terminal-fixture closure (cancelled/abandoned -> void_cancelled) ---------


def test_run_closes_out_predictions_for_a_cancelled_fixture(store, make_api, make_prediction):
    item = {
        "fixture": {"id": 9500, "date": "2026-06-11T16:00:00+00:00", "status": {"short": "CANC"}},
        "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
        "teams": {"home": {"id": 1, "name": "Brazil"}, "away": {"id": 2, "name": "Argentina"}},
        "goals": {"home": None, "away": None},
        "score": {"fulltime": {"home": None, "away": None}},
    }
    api = make_api(fixtures={"response": [item]})
    # FakeStore.upsert_fixture deterministically assigns 900_000 + api_fixture_id.
    fixture_id = 900_000 + 9500
    store.predictions.append(
        make_prediction(id="p1", fixture_id=fixture_id, status="locked")
    )

    counts = run(dry_run=False, store=store, api=api)

    assert counts["predictions_closed_terminal"] == 1
    assert store.predictions[0]["status"] == "void_cancelled"
    assert store.closed_terminal == [fixture_id]


def test_run_does_not_close_predictions_for_a_merely_postponed_fixture(
    store, make_api, make_prediction
):
    # Plain PST (not CANC/ABD) within the horizon is NOT terminal yet -- it may
    # still be rescheduled, so its predictions must be left alone. Kickoff is
    # computed relative to real "now" (well under POSTPONED_VOID_HORIZON_DAYS)
    # so this doesn't rot as the wall clock advances.
    recent_kickoff = (util.now_utc() - timedelta(days=10)).isoformat()
    item = {
        "fixture": {"id": 9501, "date": recent_kickoff, "status": {"short": "PST"}},
        "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
        "teams": {"home": {"id": 1, "name": "Brazil"}, "away": {"id": 2, "name": "Argentina"}},
        "goals": {"home": None, "away": None},
        "score": {"fulltime": {"home": None, "away": None}},
    }
    api = make_api(fixtures={"response": [item]})
    fixture_id = 900_000 + 9501
    store.predictions.append(make_prediction(id="p1", fixture_id=fixture_id, status="locked"))

    counts = run(dry_run=False, store=store, api=api)

    assert counts["predictions_closed_terminal"] == 0
    assert store.predictions[0]["status"] == "locked"
