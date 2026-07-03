"""Tests for jobs.db.SupabaseStore methods not exercised by the job-level
test files (jobs/db.py, v2 hardening) -- the pagination helper, kickoff-change
reconciliation, terminal-fixture closure, and job_runs observability.

These run the REAL SupabaseStore against FakeSupabaseClient (in-memory, no
network/DB) so the actual store logic is what's tested, mirroring the pattern
test_reset_season.py already established for count_season_rows/teardown_season.
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import jobs.db as db_module
from jobs import util
from jobs.db import SupabaseStore


# --- _paginated ---------------------------------------------------------------


class _RangeStub:
    """Fake query builder: .range(a, b).execute().data slices a fixed list."""

    def __init__(self, all_rows):
        self._all_rows = all_rows
        self._slice = (0, 0)

    def range(self, start, end):
        self._slice = (start, end)
        return self

    def execute(self):
        start, end = self._slice
        return SimpleNamespace(data=self._all_rows[start : end + 1])


def test_paginated_aggregates_across_pages(monkeypatch):
    monkeypatch.setattr(db_module, "_PAGE_SIZE", 2)
    store = SupabaseStore(client=object())  # _paginated never touches self._client
    all_rows = [{"id": i} for i in range(5)]
    calls: list[tuple[int, int]] = []

    def factory():
        stub = _RangeStub(all_rows)
        original_range = stub.range

        def _tracked_range(start, end):
            calls.append((start, end))
            return original_range(start, end)

        stub.range = _tracked_range
        return stub

    rows = store._paginated(factory)

    assert [r["id"] for r in rows] == [0, 1, 2, 3, 4]
    assert calls == [(0, 1), (2, 3), (4, 5)]  # last page short -> stops


def test_paginated_stops_at_max_pages_safety_cap(monkeypatch, caplog):
    monkeypatch.setattr(db_module, "_PAGE_SIZE", 2)
    monkeypatch.setattr(db_module, "_MAX_PAGES", 3)
    store = SupabaseStore(client=object())

    class _AlwaysFullStub:
        def range(self, start, end):
            self._n = end - start + 1
            return self

        def execute(self):
            return SimpleNamespace(data=[{"id": i} for i in range(self._n)])

    with caplog.at_level("ERROR"):
        rows = store._paginated(lambda: _AlwaysFullStub())

    assert len(rows) == 3 * 2  # _MAX_PAGES * _PAGE_SIZE
    assert "safety cap" in caplog.text


# --- reconcile_kickoff_change / upsert_fixture reschedule detection -----------


def test_reconcile_kickoff_change_resyncs_still_valid_published_row(make_supabase_client):
    # Dates computed relative to real "now" (not hardcoded) so this stays
    # correct regardless of when the suite happens to run: published_at must
    # predate the NEW kickoff, and the new kickoff must still be in the future.
    now = util.now_utc()
    published_at = (now - timedelta(days=2)).isoformat()
    new_kickoff = (now + timedelta(days=5)).isoformat()
    client = make_supabase_client(
        predictions=[
            {
                "id": "p1",
                "fixture_id": 10,
                "status": "published",
                "published_at": published_at,
            },
        ],
    )
    store = SupabaseStore(client=client)

    result = store.reconcile_kickoff_change(10, new_kickoff_utc=new_kickoff)

    assert result == {"resynced": 1, "voided": 0}
    pred = client.tables["predictions"][0]
    assert pred["locked_at"] == new_kickoff
    assert pred["status"] == "published"  # still published, just resynced


def test_reconcile_kickoff_change_voids_when_new_kickoff_already_passed(make_supabase_client):
    client = make_supabase_client(
        predictions=[
            {
                "id": "p1",
                "fixture_id": 10,
                "status": "published",
                "published_at": "2020-01-01T00:00:00+00:00",
            },
        ],
    )
    store = SupabaseStore(client=client)

    # New kickoff is long in the past -> can no longer be a valid pre-kickoff call.
    result = store.reconcile_kickoff_change(10, new_kickoff_utc="2020-01-02T00:00:00+00:00")

    assert result == {"resynced": 0, "voided": 1}
    assert client.tables["predictions"][0]["status"] == "unlocked_void"


def test_reconcile_kickoff_change_ignores_locked_and_scored_predictions(make_supabase_client):
    # Only status='published' rows are candidates -- the trigger already
    # freezes locked_at on locked/scored rows, and reconcile must never try
    # (or need) to touch them.
    client = make_supabase_client(
        predictions=[
            {"id": "locked-1", "fixture_id": 10, "status": "locked", "published_at": "x"},
            {"id": "scored-1", "fixture_id": 10, "status": "scored", "published_at": "x"},
        ],
    )
    store = SupabaseStore(client=client)

    result = store.reconcile_kickoff_change(10, new_kickoff_utc="2026-06-15T18:00:00+00:00")

    assert result == {"resynced": 0, "voided": 0}
    statuses = {p["id"]: p["status"] for p in client.tables["predictions"]}
    assert statuses == {"locked-1": "locked", "scored-1": "scored"}


def test_upsert_fixture_first_insert_does_not_reconcile(make_supabase_client):
    client = make_supabase_client()
    store = SupabaseStore(client=client)

    fixture_id = store.upsert_fixture(
        api_fixture_id=555,
        league_id=1,
        home_team_id=10,
        away_team_id=11,
        kickoff_utc="2026-06-15T18:00:00+00:00",
        status="scheduled",
        final_home_goals=None,
        final_away_goals=None,
    )

    assert isinstance(fixture_id, int)
    assert client.rpc_calls == []  # no reconciliation triggered
    assert client.tables["fixtures"][0]["kickoff_utc"] == "2026-06-15T18:00:00+00:00"


def test_upsert_fixture_unchanged_kickoff_does_not_reconcile(make_supabase_client):
    client = make_supabase_client(
        fixtures=[{"id": 1, "api_fixture_id": 555, "kickoff_utc": "2026-06-15T18:00:00+00:00"}],
        predictions=[
            {"id": "p1", "fixture_id": 1, "status": "published", "published_at": "2026-06-01T00:00:00+00:00"},
        ],
    )
    store = SupabaseStore(client=client)

    store.upsert_fixture(
        api_fixture_id=555, league_id=1, home_team_id=10, away_team_id=11,
        kickoff_utc="2026-06-15T18:00:00+00:00",  # SAME kickoff
        status="scheduled", final_home_goals=None, final_away_goals=None,
    )

    # Reconciliation only fires on a genuine change -- the still-published
    # prediction's locked_at must be untouched (no update issued).
    assert client.tables["predictions"][0]["status"] == "published"
    assert "locked_at" not in client.tables["predictions"][0]


def test_upsert_fixture_kickoff_change_resyncs_published_predictions(make_supabase_client):
    now = util.now_utc()
    old_kickoff = (now + timedelta(days=3)).isoformat()
    new_kickoff = (now + timedelta(days=8)).isoformat()  # moved later
    published_at = (now - timedelta(days=1)).isoformat()
    client = make_supabase_client(
        fixtures=[{"id": 1, "api_fixture_id": 555, "kickoff_utc": old_kickoff}],
        predictions=[
            {"id": "p1", "fixture_id": 1, "status": "published", "published_at": published_at},
        ],
    )
    store = SupabaseStore(client=client)

    store.upsert_fixture(
        api_fixture_id=555, league_id=1, home_team_id=10, away_team_id=11,
        kickoff_utc=new_kickoff,
        status="scheduled", final_home_goals=None, final_away_goals=None,
    )

    pred = client.tables["predictions"][0]
    assert pred["locked_at"] == new_kickoff
    assert pred["status"] == "published"


# --- close_out_terminal_fixture_predictions -----------------------------------


def test_close_out_terminal_fixture_predictions_closes_open_rows(make_supabase_client):
    client = make_supabase_client(
        predictions=[
            {"id": "p1", "fixture_id": 1, "status": "published"},
            {"id": "p2", "fixture_id": 1, "status": "locked"},
            {"id": "p3", "fixture_id": 1, "status": "scored"},
            {"id": "p4", "fixture_id": 1, "status": "unlocked_void"},
            {"id": "p5", "fixture_id": 2, "status": "published"},  # different fixture
        ],
    )
    store = SupabaseStore(client=client)

    closed = store.close_out_terminal_fixture_predictions(1)

    assert closed == 2  # only p1 (published) and p2 (locked)
    statuses = {p["id"]: p["status"] for p in client.tables["predictions"]}
    assert statuses["p1"] == "void_cancelled"
    assert statuses["p2"] == "void_cancelled"
    assert statuses["p3"] == "scored"  # untouched
    assert statuses["p4"] == "unlocked_void"  # untouched
    assert statuses["p5"] == "published"  # different fixture, untouched


def test_close_out_terminal_fixture_predictions_is_idempotent(make_supabase_client):
    client = make_supabase_client(
        predictions=[{"id": "p1", "fixture_id": 1, "status": "locked"}],
    )
    store = SupabaseStore(client=client)

    first = store.close_out_terminal_fixture_predictions(1)
    second = store.close_out_terminal_fixture_predictions(1)  # nothing left open

    assert first == 1
    assert second == 0


def test_close_out_terminal_fixture_predictions_no_open_rows_is_zero(make_supabase_client):
    client = make_supabase_client(predictions=[])
    store = SupabaseStore(client=client)
    assert store.close_out_terminal_fixture_predictions(999) == 0


# --- record_job_run ------------------------------------------------------------


def test_record_job_run_inserts_expected_row(make_supabase_client):
    client = make_supabase_client()
    store = SupabaseStore(client=client)

    store.record_job_run(
        job="Fetch fixtures",
        started_at="2026-06-11T10:00:00+00:00",
        finished_at="2026-06-11T10:00:05+00:00",
        ok=True,
        counts={"fixtures_upserted": 3},
        error=None,
    )

    assert len(client.tables["job_runs"]) == 1
    row = client.tables["job_runs"][0]
    assert row["job"] == "Fetch fixtures"
    assert row["ok"] is True
    assert row["counts"] == {"fixtures_upserted": 3}
    assert row["error"] is None
    assert row["started_at"] == "2026-06-11T10:00:00+00:00"
    assert row["finished_at"] == "2026-06-11T10:00:05+00:00"


# --- top_scorers (jobs/fetch_topscorers.py, migration 0005) -----------------
# Runs the REAL SupabaseStore.replace_top_scorers/league_id_for_api_league_id/
# top_scorers_for_league against FakeSupabaseClient -- exercises the actual
# batch-upsert (list-of-dicts, composite "league_id,api_player_id" conflict
# target) and paginated-order read path, not just FakeStore's job-level
# reimplementation (test_fetch_topscorers.py covers that layer separately).


def test_league_id_for_api_league_id_resolves_a_synced_league(make_supabase_client):
    client = make_supabase_client(leagues=[{"id": 100, "api_league_id": 1}])
    store = SupabaseStore(client=client)

    assert store.league_id_for_api_league_id(1) == 100


def test_league_id_for_api_league_id_returns_none_when_unsynced(make_supabase_client):
    client = make_supabase_client(leagues=[])
    store = SupabaseStore(client=client)

    assert store.league_id_for_api_league_id(999) is None


def test_replace_top_scorers_upserts_new_rows(make_supabase_client):
    client = make_supabase_client()
    store = SupabaseStore(client=client)

    result = store.replace_top_scorers(
        league_id=100,
        rows=[
            {
                "api_player_id": 1, "player_name": "Player One", "team_name": "Team A",
                "nationality": "Testland", "goals": 10, "assists": 3, "penalties": 1, "rank": 1,
            },
            {
                "api_player_id": 2, "player_name": "Player Two", "team_name": "Team B",
                "nationality": None, "goals": 8, "assists": None, "penalties": None, "rank": 2,
            },
        ],
    )

    assert result == {"upserted": 2, "pruned": 0}
    stored = client.tables["top_scorers"]
    assert len(stored) == 2
    assert {r["api_player_id"] for r in stored} == {1, 2}
    assert all(r["league_id"] == 100 for r in stored)


def test_replace_top_scorers_is_a_no_op_for_an_empty_rows_list(make_supabase_client):
    client = make_supabase_client(
        top_scorers=[{"league_id": 100, "api_player_id": 1, "rank": 1}]
    )
    store = SupabaseStore(client=client)

    result = store.replace_top_scorers(league_id=100, rows=[])

    assert result == {"upserted": 0, "pruned": 0}
    assert client.tables["top_scorers"] == [{"league_id": 100, "api_player_id": 1, "rank": 1}]


def test_replace_top_scorers_prunes_players_who_fell_out_of_the_top_n(make_supabase_client):
    client = make_supabase_client(
        top_scorers=[
            {
                "league_id": 100, "api_player_id": 1, "player_name": "Stays",
                "team_name": "A", "goals": 10, "rank": 1,
            },
            {
                "league_id": 100, "api_player_id": 2, "player_name": "Falls Out",
                "team_name": "B", "goals": 5, "rank": 2,
            },
            {  # a different league's board -- must survive untouched
                "league_id": 200, "api_player_id": 1, "player_name": "Other League",
                "team_name": "C", "goals": 99, "rank": 1,
            },
        ]
    )
    store = SupabaseStore(client=client)

    result = store.replace_top_scorers(
        league_id=100,
        rows=[
            {
                "api_player_id": 1, "player_name": "Stays", "team_name": "A",
                "nationality": None, "goals": 12, "assists": None, "penalties": None, "rank": 1,
            },
        ],
    )

    assert result == {"upserted": 1, "pruned": 1}
    remaining_100 = [r for r in client.tables["top_scorers"] if r["league_id"] == 100]
    assert len(remaining_100) == 1
    assert remaining_100[0]["api_player_id"] == 1
    assert remaining_100[0]["goals"] == 12  # updated in place, not re-inserted
    remaining_200 = [r for r in client.tables["top_scorers"] if r["league_id"] == 200]
    assert len(remaining_200) == 1  # a different league's board, untouched


def test_replace_top_scorers_never_writes_photo_or_logo_fields(make_supabase_client):
    client = make_supabase_client()
    store = SupabaseStore(client=client)

    store.replace_top_scorers(
        league_id=100,
        rows=[
            {
                "api_player_id": 1, "player_name": "Player One", "team_name": "Team A",
                "nationality": "Testland", "goals": 10, "assists": 3, "penalties": 1, "rank": 1,
            },
        ],
    )

    row = client.tables["top_scorers"][0]
    assert "photo" not in row
    assert "logo" not in row


def test_top_scorers_for_league_returns_rows_ordered_by_rank(make_supabase_client):
    client = make_supabase_client(
        top_scorers=[
            {"league_id": 100, "api_player_id": 2, "player_name": "Second", "rank": 2},
            {"league_id": 100, "api_player_id": 1, "player_name": "First", "rank": 1},
            {"league_id": 200, "api_player_id": 9, "player_name": "Other League", "rank": 1},
        ]
    )
    store = SupabaseStore(client=client)

    rows = store.top_scorers_for_league(100)

    assert [r["player_name"] for r in rows] == ["First", "Second"]


# --- W5 (migration 0006): user_predictions scoring, fixture_pick_aggregates
# and team_probability_snapshots (jobs/score_user_predictions.py +
# jobs/snapshot_probabilities.py). Runs the REAL SupabaseStore against
# FakeSupabaseClient to exercise the actual update/upsert plumbing (composite
# conflict targets included), mirroring the top_scorers section above. The
# read paths that need PostgREST embedded-join filters
# (locked_user_predictions_due_for_scoring / locked_fixture_ids_with_user_picks)
# are covered at the job level via FakeStore instead -- same split as
# locked_predictions_due_for_scoring.


def test_write_user_prediction_score_updates_only_scoring_fields(make_supabase_client):
    client = make_supabase_client(
        user_predictions=[
            {
                "id": "up1", "user_id": "u1", "fixture_id": 300,
                "prob_home": 0.5, "prob_draw": 0.3, "prob_away": 0.2,
                "result": None, "brier_score": None, "scored_at": None,
            },
            {
                "id": "up2", "user_id": "u2", "fixture_id": 300,
                "prob_home": 0.4, "prob_draw": 0.3, "prob_away": 0.3,
                "result": None, "brier_score": None, "scored_at": None,
            },
        ]
    )
    store = SupabaseStore(client=client)

    store.write_user_prediction_score(
        "up1", result="home", brier_score=0.38, scored_at="2026-06-11T20:00:00+00:00"
    )

    rows = {r["id"]: r for r in client.tables["user_predictions"]}
    assert rows["up1"]["result"] == "home"
    assert rows["up1"]["brier_score"] == 0.38
    assert rows["up1"]["scored_at"] == "2026-06-11T20:00:00+00:00"
    # The pick itself is untouched -- scoring writes scoring fields ONLY.
    assert rows["up1"]["prob_home"] == 0.5
    # And only the addressed row is written.
    assert rows["up2"]["result"] is None and rows["up2"]["scored_at"] is None


def test_write_user_prediction_score_defaults_scored_at_to_now(make_supabase_client):
    client = make_supabase_client(
        user_predictions=[
            {"id": "up1", "user_id": "u1", "fixture_id": 300, "scored_at": None},
        ]
    )
    store = SupabaseStore(client=client)

    store.write_user_prediction_score("up1", result="draw", brier_score=0.5)

    assert client.tables["user_predictions"][0]["scored_at"] is not None


def test_user_prediction_probs_for_fixture_filters_by_fixture(make_supabase_client):
    client = make_supabase_client(
        user_predictions=[
            {"id": "up1", "fixture_id": 300, "prob_home": 0.5, "prob_draw": 0.3, "prob_away": 0.2},
            {"id": "up2", "fixture_id": 300, "prob_home": 0.7, "prob_draw": 0.2, "prob_away": 0.1},
            {"id": "up3", "fixture_id": 999, "prob_home": 0.1, "prob_draw": 0.1, "prob_away": 0.8},
        ]
    )
    store = SupabaseStore(client=client)

    rows = store.user_prediction_probs_for_fixture(300)

    assert len(rows) == 2
    assert sorted(r["prob_home"] for r in rows) == [0.5, 0.7]


def test_existing_pick_aggregate_fixture_ids_returns_the_set(make_supabase_client):
    client = make_supabase_client(
        fixture_pick_aggregates=[
            {"fixture_id": 300, "n_picks": 2},
            {"fixture_id": 301, "n_picks": 5},
        ]
    )
    store = SupabaseStore(client=client)

    assert store.existing_pick_aggregate_fixture_ids() == {300, 301}


def test_upsert_fixture_pick_aggregate_inserts_then_updates_in_place(make_supabase_client):
    client = make_supabase_client(fixture_pick_aggregates=[])
    store = SupabaseStore(client=client)

    store.upsert_fixture_pick_aggregate(
        fixture_id=300, n_picks=2,
        avg_prob_home=0.5, avg_prob_draw=0.3, avg_prob_away=0.2,
    )
    store.upsert_fixture_pick_aggregate(  # a re-run: keyed on the fixture_id PK
        fixture_id=300, n_picks=3,
        avg_prob_home=0.6, avg_prob_draw=0.25, avg_prob_away=0.15,
    )

    rows = client.tables["fixture_pick_aggregates"]
    assert len(rows) == 1  # updated in place, never duplicated
    assert rows[0]["n_picks"] == 3
    assert rows[0]["avg_prob_home"] == 0.6


def test_team_probability_snapshots_for_date_filters_by_date(make_supabase_client):
    client = make_supabase_client(
        team_probability_snapshots=[
            {"snapshot_date": "2026-06-10", "team_id": 200, "fixture_id": 300, "elo_rating": 1490},
            {"snapshot_date": "2026-06-10", "team_id": 201, "fixture_id": 300, "elo_rating": 1510},
            {"snapshot_date": "2026-06-09", "team_id": 200, "fixture_id": 300, "elo_rating": 1480},
        ]
    )
    store = SupabaseStore(client=client)

    rows = store.team_probability_snapshots_for_date("2026-06-10")

    assert len(rows) == 2
    assert {r["team_id"] for r in rows} == {200, 201}


def test_upsert_team_probability_snapshots_bulk_upserts_on_the_composite_pk(
    make_supabase_client,
):
    client = make_supabase_client(
        team_probability_snapshots=[
            {
                "snapshot_date": "2026-06-11", "team_id": 200, "fixture_id": 300,
                "elo_rating": 1490.0, "prob_win": 0.40,
            },
        ]
    )
    store = SupabaseStore(client=client)

    written = store.upsert_team_probability_snapshots(
        [
            {  # collides with the seeded (date, team, fixture) -> update in place
                "snapshot_date": "2026-06-11", "team_id": 200, "fixture_id": 300,
                "elo_rating": 1500.0, "prob_win": 0.44,
            },
            {  # new key -> inserted
                "snapshot_date": "2026-06-11", "team_id": 201, "fixture_id": 300,
                "elo_rating": 1500.0, "prob_win": 0.31,
            },
        ]
    )

    assert written == 2
    rows = client.tables["team_probability_snapshots"]
    assert len(rows) == 2  # a same-day re-run never duplicates rows
    by_team = {r["team_id"]: r for r in rows}
    assert by_team[200]["elo_rating"] == 1500.0 and by_team[200]["prob_win"] == 0.44
    assert by_team[201]["prob_win"] == 0.31


def test_upsert_team_probability_snapshots_empty_rows_is_a_no_op(make_supabase_client):
    client = make_supabase_client()
    store = SupabaseStore(client=client)

    assert store.upsert_team_probability_snapshots([]) == 0
    # The store returned before ever touching the client: the fake only
    # materialises a table key on first access, so its absence proves no
    # query was issued at all.
    assert "team_probability_snapshots" not in client.tables


def test_record_job_run_captures_failure_shape(make_supabase_client):
    client = make_supabase_client()
    store = SupabaseStore(client=client)

    store.record_job_run(
        job="Score results",
        started_at="2026-06-11T10:00:00+00:00",
        finished_at="2026-06-11T10:00:01+00:00",
        ok=False,
        counts={"error": "RuntimeError: boom"},
        error="RuntimeError: boom",
    )

    row = client.tables["job_runs"][0]
    assert row["ok"] is False
    assert row["error"] == "RuntimeError: boom"
