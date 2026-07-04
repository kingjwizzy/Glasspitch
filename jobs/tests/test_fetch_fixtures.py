"""Tests for fetch_fixtures: status mapping, parsing, idempotent upserts, dry-run,
and (W6, migration 0007) round normalisation + the API's definitive winner flag."""

from datetime import timedelta

from jobs import config, util
from jobs.apiclient import ApiFootballError, RequestBudgetExceeded
from jobs.fetch_fixtures import (
    ParsedTeam,
    _parse_winner_api_team_id,
    map_fixture_status,
    normalize_round,
    parse_fixture,
    run,
)


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


# ==============================================================================
# W6 (migration 0007): round parsing/normalisation + winner_team_id -- the
# fields jobs/simulate_chances.py's bracket progression depends on.
# ==============================================================================


def test_normalize_round_canonicalises_confirmed_spelling_variants():
    # The live-confirmed canonical strings pass through unchanged...
    for canonical in (
        "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals",
        "3rd Place Final", "Final",
    ):
        assert normalize_round(canonical) == canonical
    # ...and known case/spelling variants collapse onto them.
    assert normalize_round("round of 16") == "Round of 16"
    assert normalize_round("FINAL") == "Final"
    assert normalize_round("Quarterfinals") == "Quarter-finals"
    assert normalize_round("Quarter finals") == "Quarter-finals"
    assert normalize_round("Semifinals") == "Semi-finals"
    assert normalize_round("Semi finals") == "Semi-finals"
    assert normalize_round("Third Place Final") == "3rd Place Final"
    assert normalize_round("3rd Place Play-off") == "3rd Place Final"
    assert normalize_round("3rd place playoff") == "3rd Place Final"


def test_normalize_round_passes_unrecognised_rounds_through_collapsed():
    # Group-stage / club-football strings are never guessed at or dropped --
    # only whitespace-collapsed.
    assert normalize_round("Group Stage - 1") == "Group Stage - 1"
    assert normalize_round("  Group   Stage\t-  2 ") == "Group Stage - 2"
    assert normalize_round("Regular Season - 12") == "Regular Season - 12"
    # Null/empty inputs stay null.
    assert normalize_round(None) is None
    assert normalize_round("") is None
    assert normalize_round("   ") is None


def test_parse_winner_api_team_id_reads_the_definitive_winner_flag():
    home = ParsedTeam(api_team_id=25, name="Germany", slug="germany")
    away = ParsedTeam(api_team_id=2382, name="Paraguay", slug="paraguay")

    assert _parse_winner_api_team_id(
        {"home": {"id": 25, "winner": True}, "away": {"id": 2382, "winner": False}},
        home, away,
    ) == 25
    assert _parse_winner_api_team_id(
        {"home": {"id": 25, "winner": False}, "away": {"id": 2382, "winner": True}},
        home, away,
    ) == 2382
    # A genuine draw / not-yet-played fixture: both flags null -> no winner.
    assert _parse_winner_api_team_id(
        {"home": {"id": 25, "winner": None}, "away": {"id": 2382, "winner": None}},
        home, away,
    ) is None
    # Defensive: a nonsensical both-true payload never picks a side.
    assert _parse_winner_api_team_id(
        {"home": {"id": 25, "winner": True}, "away": {"id": 2382, "winner": True}},
        home, away,
    ) is None
    # Missing/null team nodes degrade to None rather than raising.
    assert _parse_winner_api_team_id({}, home, away) is None
    assert _parse_winner_api_team_id({"home": None, "away": None}, home, away) is None


def _penalty_shootout_item():
    """The live-confirmed shape (2026-07-03, fixture 1565176 Germany v
    Paraguay): a knockout match drawn 1-1 after 90 minutes and decided on
    penalties -- score.fulltime stays the NORMAL-TIME score, and only
    teams.away.winner carries who actually advanced."""
    return {
        "fixture": {
            "id": 1565176,
            "date": "2026-07-01T19:00:00+00:00",
            "status": {"short": "PEN", "long": "Match Finished After Penalties"},
        },
        "league": {
            "id": 1, "name": "World Cup", "country": "World", "season": 2026,
            "round": "Round of 32",
        },
        "teams": {
            "home": {"id": 25, "name": "Germany", "winner": False},
            "away": {"id": 2382, "name": "Paraguay", "winner": True},
        },
        "goals": {"home": 1, "away": 1},
        "score": {
            "fulltime": {"home": 1, "away": 1},
            "penalty": {"home": 3, "away": 4},
        },
    }


def test_parse_fixture_keeps_the_ninety_minute_score_but_flags_the_shootout_winner():
    parsed = parse_fixture(_penalty_shootout_item(), default_season=2026)

    assert parsed.status == "finished"
    # The ledger's 1X2 market stays the 90-minute score -- a draw...
    assert parsed.final_home_goals == 1 and parsed.final_away_goals == 1
    # ...but the definitive winner flag says who actually advanced.
    assert parsed.winner_api_team_id == 2382
    assert parsed.round == "Round of 32"
    assert parsed.api_round == "Round of 32"


def test_parse_fixture_normalises_round_but_keeps_the_raw_api_round():
    item = _penalty_shootout_item()
    item["league"]["round"] = "Quarterfinals"  # a spelling variant
    parsed = parse_fixture(item, default_season=2026)
    assert parsed.round == "Quarter-finals"
    assert parsed.api_round == "Quarterfinals"

    # A group-stage genuine draw: round passes through, no winner at all.
    item = _penalty_shootout_item()
    item["league"]["round"] = "Group Stage - 1"
    item["fixture"]["status"]["short"] = "FT"
    item["teams"]["home"]["winner"] = None
    item["teams"]["away"]["winner"] = None
    del item["score"]["penalty"]
    parsed = parse_fixture(item, default_season=2026)
    assert parsed.round == "Group Stage - 1"
    assert parsed.winner_api_team_id is None


def test_parse_fixture_without_round_or_winner_keys_stays_null(fixtures_payload):
    # The pre-0007 payload shape (conftest fixtures_payload has no
    # league.round and no teams.*.winner keys) parses with nulls, not errors.
    parsed = parse_fixture(fixtures_payload["response"][0], default_season=2026)
    assert parsed.round is None
    assert parsed.api_round is None
    assert parsed.winner_api_team_id is None


# --- live match clock (migration 0011, UI-overhaul spec item #1) -------------
# elapsed_minute/elapsed_extra_minute/api_status_short all come straight off
# the SAME fixture.status node parse_fixture already reads -- no extra
# parsing, no extra API cost.


def _live_item(*, short, elapsed=None, extra=None):
    return {
        "fixture": {
            "id": 9010,
            "date": "2026-06-11T16:00:00+00:00",
            "status": {"short": short, "elapsed": elapsed, "extra": extra},
        },
        "league": {"id": 1, "name": "World Cup", "country": "World", "season": 2026},
        "teams": {"home": {"id": 2380, "name": "Brazil"}, "away": {"id": 26, "name": "Argentina"}},
        "goals": {"home": 1, "away": 0},
        "score": {"fulltime": {"home": None, "away": None}},
    }


def test_parse_fixture_live_match_carries_the_elapsed_minute():
    parsed = parse_fixture(_live_item(short="1H", elapsed=34), default_season=2026)
    assert parsed.status == "live"
    assert parsed.api_status_short == "1H"
    assert parsed.elapsed_minute == 34
    assert parsed.elapsed_extra_minute is None


def test_parse_fixture_live_match_carries_stoppage_time_extra_minute():
    parsed = parse_fixture(_live_item(short="2H", elapsed=90, extra=3), default_season=2026)
    assert parsed.status == "live"
    assert parsed.api_status_short == "2H"
    assert parsed.elapsed_minute == 90
    assert parsed.elapsed_extra_minute == 3


def test_parse_fixture_half_time_has_no_elapsed_minute():
    # API-Football nulls `elapsed` at half-time -- HT still maps to our
    # 'live' status, but there is no running minute to show.
    parsed = parse_fixture(_live_item(short="HT"), default_season=2026)
    assert parsed.status == "live"
    assert parsed.api_status_short == "HT"
    assert parsed.elapsed_minute is None
    assert parsed.elapsed_extra_minute is None


def test_parse_fixture_not_started_has_null_live_clock_fields(fixtures_payload):
    # The not-yet-live (scheduled) and already-finished items in the shared
    # fixtures_payload fixture carry no "elapsed"/"extra" keys at all --
    # exactly the "fetch sweep hasn't touched this fixture since kickoff"
    # shape the frontend's LivePill renders defensively against.
    upcoming = parse_fixture(fixtures_payload["response"][0], default_season=2026)
    finished = parse_fixture(fixtures_payload["response"][1], default_season=2026)
    for parsed in (upcoming, finished):
        assert parsed.elapsed_minute is None
        assert parsed.elapsed_extra_minute is None


def test_run_writes_the_live_clock_fields_through_to_the_store(store, make_api):
    api = make_api(fixtures={"response": [_live_item(short="1H", elapsed=57)]})
    run(dry_run=False, store=store, api=api)

    assert len(store.upserted_fixtures) == 1
    written = store.upserted_fixtures[0]
    assert written["status"] == "live"
    assert written["status_short"] == "1H"
    assert written["elapsed_minute"] == 57
    assert written["elapsed_extra_minute"] is None


def test_run_wires_round_and_winner_team_id_into_the_fixture_upsert(store, make_api):
    api = make_api(fixtures={"response": [_penalty_shootout_item()]})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["fixtures_upserted"] == 1
    kw = store.upserted_fixtures[0]
    assert kw["round_name"] == "Round of 32"
    assert kw["api_round"] == "Round of 32"
    # The winner's api team id resolved through the SAME team-id mapping the
    # home/away columns use -- Paraguay was the away side and won on pens.
    assert kw["winner_team_id"] == kw["away_team_id"]
    assert kw["winner_team_id"] is not None


def test_run_upserts_null_winner_for_an_undecided_fixture(store, make_api, fixtures_payload):
    run(dry_run=False, store=store, api=make_api(fixtures=fixtures_payload))
    for kw in store.upserted_fixtures:
        assert kw["winner_team_id"] is None
        assert kw["round_name"] is None and kw["api_round"] is None
