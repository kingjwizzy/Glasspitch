"""Tests for jobs.cli.main: the shared --dry-run/-v harness, the always-emitted
summary (success AND failure), and the job_runs observability write (v2
hardening -- see docs digest "no job monitoring/alerting").

_record_job_run does a LOCAL `from jobs.db import SupabaseStore` inside the
function body specifically so it can be swapped out here without an injectable
parameter on `main()` itself (mirrors how the jobs' own __main__ blocks
construct their own SupabaseStore) -- monkeypatching the jobs.db module
attribute is what a local import picks up.
"""

from __future__ import annotations

import jobs.db as db_module
from jobs.cli import main


class _RecordingStore:
    def __init__(self, calls):
        self._calls = calls

    def record_job_run(self, **kwargs):
        self._calls.append(kwargs)


def test_job_runs_row_written_on_success(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(db_module, "SupabaseStore", lambda: _RecordingStore(calls))

    def runner(*, dry_run=False):
        return {"fixtures_upserted": 3}

    result = main(runner, "Fetch fixtures", argv=[])

    assert result == {"fixtures_upserted": 3}
    assert len(calls) == 1
    assert calls[0]["job"] == "Fetch fixtures"
    assert calls[0]["ok"] is True
    assert calls[0]["counts"] == {"fixtures_upserted": 3}
    assert calls[0]["error"] is None
    assert "started_at" in calls[0] and "finished_at" in calls[0]


def test_job_runs_row_written_on_failure_and_exception_still_reraises(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(db_module, "SupabaseStore", lambda: _RecordingStore(calls))

    def runner(*, dry_run=False):
        raise ValueError("boom")

    try:
        main(runner, "Score results", argv=[])
        assert False, "main() should re-raise the runner's exception"
    except ValueError:
        pass

    assert len(calls) == 1
    assert calls[0]["ok"] is False
    assert "ValueError" in calls[0]["error"] and "boom" in calls[0]["error"]
    assert calls[0]["counts"] == {"error": calls[0]["error"]}


def test_job_runs_row_not_written_on_dry_run(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(db_module, "SupabaseStore", lambda: _RecordingStore(calls))

    def runner(*, dry_run=False):
        return {"dry_run": dry_run}

    result = main(runner, "Fetch fixtures", argv=["--dry-run"])

    assert result == {"dry_run": True}
    assert calls == []  # dry-run is deliberately never persisted


def test_job_runs_write_failure_is_swallowed_and_never_masks_the_job_result(
    monkeypatch, caplog
):
    class _ExplodingStore:
        def record_job_run(self, **kwargs):
            raise RuntimeError("db unreachable")

    monkeypatch.setattr(db_module, "SupabaseStore", lambda: _ExplodingStore())

    def runner(*, dry_run=False):
        return {"ok": True}

    with caplog.at_level("WARNING"):
        result = main(runner, "Lock predictions", argv=[])

    assert result == {"ok": True}  # the job's own outcome is unaffected
    assert "Failed to record job_runs row" in caplog.text


def test_job_runs_write_failure_is_swallowed_even_on_a_failed_run(monkeypatch, caplog):
    class _ExplodingStore:
        def record_job_run(self, **kwargs):
            raise RuntimeError("db unreachable")

    monkeypatch.setattr(db_module, "SupabaseStore", lambda: _ExplodingStore())

    def runner(*, dry_run=False):
        raise KeyError("missing")

    with caplog.at_level("WARNING"):
        try:
            main(runner, "Lock predictions", argv=[])
            assert False, "main() should re-raise"
        except KeyError:
            pass

    assert "Failed to record job_runs row" in caplog.text
