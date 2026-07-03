"""Tests for jobs.fetch_topscorers: top-15 leaderboard parsing, per-league
error isolation, graceful budget stop, dry-run, and idempotent full-replace
(ARCHITECTURE.md §8, migration 0005).

Mirrors test_fetch_insights.py/test_fetch_fixtures.py's conventions --
FakeStore/FakeApiClient (conftest.py), no network/DB. Every test that touches
photo/logo fields exists because this job's whole point is §13: only
plain-text player/team NAME strings and plain numeric stats are ever parsed
or stored -- never a photo or crest/logo URL, even though the real API
payload carries both.
"""

from __future__ import annotations

from jobs import config
from jobs.apiclient import ApiFootballError, RequestBudgetExceeded
from jobs.fetch_topscorers import parse_topscorers, run


# --- parse_topscorers: curation, unit-level ----------------------------------


def _topscorer_item(player_id, name, team_name, goals, **overrides):
    return {
        "player": {
            "id": player_id,
            "name": name,
            "nationality": overrides.get("nationality"),
            "photo": "https://media.api-sports.io/football/players/x.png",
        },
        "statistics": [
            {
                "team": {
                    "id": overrides.get("team_id", 1),
                    "name": team_name,
                    "logo": "https://media.api-sports.io/football/teams/x.png",
                },
                "goals": {"total": goals, "assists": overrides.get("assists")},
                "penalty": {"scored": overrides.get("penalties")},
            }
        ],
    }


def test_parse_topscorers_happy_path_assigns_rank_by_list_order(topscorers_payload):
    rows = parse_topscorers(topscorers_payload, limit=15)

    assert [r["rank"] for r in rows] == [1, 2, 3]
    assert rows[0] == {
        "api_player_id": 306,
        "player_name": "Bruno Fernandes",
        "team_name": "Portugal",
        "nationality": "Portugal",
        "goals": 7,
        "assists": 3,
        "penalties": 1,
        "rank": 1,
    }


def test_parse_topscorers_never_stores_photo_or_logo_fields(topscorers_payload):
    rows = parse_topscorers(topscorers_payload, limit=15)

    assert len(rows) == 3
    for row in rows:
        assert "photo" not in row
        assert "logo" not in row
        assert set(row.keys()) == {
            "api_player_id",
            "player_name",
            "team_name",
            "nationality",
            "goals",
            "assists",
            "penalties",
            "rank",
        }


def test_parse_topscorers_missing_nullable_fields_default_to_none(topscorers_payload):
    # The 3rd fixture entry reports no nationality/assists/penalties at all.
    third = parse_topscorers(topscorers_payload, limit=15)[2]

    assert third["api_player_id"] == 91
    assert third["goals"] == 4
    assert third["nationality"] is None
    assert third["assists"] is None
    assert third["penalties"] is None


def test_parse_topscorers_trims_to_the_limit():
    payload = {
        "response": [
            _topscorer_item(i, f"Player {i}", "Team", 30 - i) for i in range(1, 21)
        ]
    }

    rows = parse_topscorers(payload, limit=15)

    assert len(rows) == 15
    assert [r["rank"] for r in rows] == list(range(1, 16))
    assert [r["api_player_id"] for r in rows] == list(range(1, 16))  # first 15, in order


def test_parse_topscorers_skips_malformed_items_without_leaving_rank_gaps():
    payload = {
        "response": [
            _topscorer_item(1, "Good One", "Team A", 10),
            {  # missing player id
                "player": {"name": "No Id"},
                "statistics": [{"team": {"name": "X"}, "goals": {"total": 5}}],
            },
            {  # missing team name
                "player": {"id": 2, "name": "No Team"},
                "statistics": [{"team": {}, "goals": {"total": 5}}],
            },
            {  # missing goals total
                "player": {"id": 3, "name": "No Goals"},
                "statistics": [{"team": {"name": "Y"}, "goals": {}}],
            },
            {  # empty statistics list entirely
                "player": {"id": 4, "name": "Empty Stats"},
                "statistics": [],
            },
            {  # statistics key absent altogether
                "player": {"id": 5, "name": "No Stats Key"},
            },
            _topscorer_item(6, "Good Two", "Team B", 8),
        ]
    }

    rows = parse_topscorers(payload, limit=15)

    assert [r["api_player_id"] for r in rows] == [1, 6]
    assert [r["rank"] for r in rows] == [1, 2]  # no gaps despite 5 skipped items


def test_parse_topscorers_empty_response_returns_empty_list():
    assert parse_topscorers({"response": []}, limit=15) == []
    assert parse_topscorers({}, limit=15) == []


# --- run(): league resolution, happy path, isolation, budget, dry-run --------


def test_run_skips_a_league_fetch_fixtures_hasnt_synced_yet_with_zero_api_calls(
    make_store, make_api, monkeypatch
):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])
    store = make_store()  # no leagues seeded -> league_id_for_api_league_id is None
    api = make_api()

    counts = run(dry_run=False, store=store, api=api)

    assert counts["leagues_skipped_no_league_row"] == 1
    assert counts["leagues_fetched"] == 0
    assert counts["leagues_failed"] == 0
    assert counts["api_requests"] == 0
    assert api.topscorers_calls == []  # no API call spent on an unsynced league
    assert store.top_scorers == []
    assert store.replace_top_scorers_calls == []


def test_run_happy_path_resolves_league_and_replaces_top_scorers(
    make_store, make_api, topscorers_payload, monkeypatch
):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])
    store = make_store(leagues={1: 100})
    api = make_api(topscorers={1: topscorers_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["leagues_seen"] == 1
    assert counts["leagues_skipped_no_league_row"] == 0
    assert counts["leagues_fetched"] == 1
    assert counts["leagues_failed"] == 0
    assert counts["budget_exhausted"] is False
    assert counts["players_upserted"] == 3
    assert counts["players_pruned"] == 0
    assert counts["api_requests"] == 1
    assert api.topscorers_calls == [(1, config.SEASON)]  # exactly one call, this league/season

    stored = store.top_scorers_for_league(100)  # 100 = the RESOLVED internal id
    assert [r["rank"] for r in stored] == [1, 2, 3]
    assert stored[0]["player_name"] == "Bruno Fernandes"
    assert all("photo" not in r and "logo" not in r for r in stored)


def test_run_isolates_one_leagues_api_error_from_the_rest(
    make_store, make_api, topscorers_payload, monkeypatch
):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1, 2])
    store = make_store(leagues={1: 100, 2: 200})
    api = make_api(topscorers={1: ApiFootballError("upstream 500"), 2: topscorers_payload})

    counts = run(dry_run=False, store=store, api=api)

    assert counts["leagues_failed"] == 1
    assert counts["leagues_fetched"] == 1  # league 2 still succeeded
    assert counts["players_upserted"] == 3
    assert store.top_scorers_for_league(100) == []  # league 1 contributed nothing
    assert len(store.top_scorers_for_league(200)) == 3


def test_run_stops_gracefully_on_budget_exhaustion(
    make_store, make_api, topscorers_payload, monkeypatch
):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1, 2])
    store = make_store(leagues={1: 100, 2: 200})
    api = make_api(
        topscorers={1: RequestBudgetExceeded("budget gone"), 2: topscorers_payload}
    )

    counts = run(dry_run=False, store=store, api=api)  # must not raise

    assert counts["budget_exhausted"] is True
    assert counts["leagues_fetched"] == 0
    assert counts["leagues_failed"] == 0  # a budget stop is not a per-league failure
    # Budget exhaustion ends the WHOLE run (break, not continue) -- league 2
    # must never even be attempted.
    assert api.topscorers_calls == [(1, config.SEASON)]
    assert store.top_scorers == []
    assert store.replace_top_scorers_calls == []


def test_run_dry_run_writes_nothing_but_still_fetches(
    make_store, make_api, topscorers_payload, monkeypatch
):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])
    store = make_store(leagues={1: 100})
    api = make_api(topscorers={1: topscorers_payload})

    counts = run(dry_run=True, store=store, api=api)

    assert counts["leagues_fetched"] == 1
    assert counts["players_upserted"] == 0  # no writes at all in dry-run
    assert counts["players_pruned"] == 0
    assert store.top_scorers == []
    assert store.replace_top_scorers_calls == []
    assert api.request_count == 1  # but the API is still called in dry-run


def test_run_idempotent_rerun_prunes_players_who_fall_out_of_the_top_n(
    make_store, make_api, monkeypatch
):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [1])
    store = make_store(leagues={1: 100})

    first_payload = {
        "response": [
            _topscorer_item(1, "Player One", "Team A", 10),
            _topscorer_item(2, "Player Two", "Team B", 8),
        ]
    }
    counts1 = run(dry_run=False, store=store, api=make_api(topscorers={1: first_payload}))

    assert counts1["players_upserted"] == 2
    assert counts1["players_pruned"] == 0
    assert {r["api_player_id"] for r in store.top_scorers_for_league(100)} == {1, 2}

    # Second run: player 1 scores more (goals updated), player 2 is overtaken
    # and falls out of the top N, player 3 breaks in.
    second_payload = {
        "response": [
            _topscorer_item(1, "Player One", "Team A", 12),
            _topscorer_item(3, "Player Three", "Team C", 9),
        ]
    }
    counts2 = run(dry_run=False, store=store, api=make_api(topscorers={1: second_payload}))

    assert counts2["players_upserted"] == 2
    assert counts2["players_pruned"] == 1  # player 2 dropped off the board
    remaining = store.top_scorers_for_league(100)
    assert {r["api_player_id"] for r in remaining} == {1, 3}
    updated_one = next(r for r in remaining if r["api_player_id"] == 1)
    assert updated_one["goals"] == 12  # re-run rewrites the natural key, never duplicates it


def test_run_no_tracked_leagues_is_a_no_op(make_store, make_api, monkeypatch):
    monkeypatch.setattr(config, "TRACKED_LEAGUE_IDS", [])
    store = make_store()
    api = make_api()

    counts = run(dry_run=False, store=store, api=api)

    assert counts == {
        "leagues_seen": 0,
        "leagues_skipped_no_league_row": 0,
        "leagues_fetched": 0,
        "leagues_failed": 0,
        "budget_exhausted": False,
        "players_upserted": 0,
        "players_pruned": 0,
        "api_requests": 0,
    }
