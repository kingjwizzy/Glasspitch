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
