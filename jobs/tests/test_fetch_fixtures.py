"""Tests for fetch_fixtures: status mapping, parsing, idempotent upserts, dry-run."""

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
