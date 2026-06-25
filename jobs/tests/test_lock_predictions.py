"""Tests for lock_predictions: published->locked, and the void-if-unlocked path."""

from datetime import datetime, timezone

from jobs.lock_predictions import run

# 20:00 UTC — two hours after an 18:00 kickoff.
NOW = datetime(2026, 6, 11, 20, 0, tzinfo=timezone.utc)


def test_published_before_kickoff_is_locked(make_store, make_prediction):
    pred = make_prediction(
        id="p1",
        status="published",
        published_at="2026-06-11T10:00:00+00:00",
        locked_at="2026-06-11T18:00:00+00:00",
    )
    store = make_store(predictions=[pred])
    counts = run(dry_run=False, store=store, now=NOW)
    assert counts["locked"] == 1 and counts["voided"] == 0
    assert store.locked == ["p1"]
    assert store.predictions[0]["status"] == "locked"


def test_published_after_kickoff_is_voided(make_store, make_prediction):
    # Published AFTER kickoff: never a valid pre-kickoff prediction -> void.
    pred = make_prediction(
        id="p2",
        status="published",
        published_at="2026-06-11T19:00:00+00:00",
        locked_at="2026-06-11T18:00:00+00:00",
    )
    store = make_store(predictions=[pred])
    counts = run(dry_run=False, store=store, now=NOW)
    assert counts["voided"] == 1 and counts["locked"] == 0
    assert store.voided == ["p2"]
    assert store.predictions[0]["status"] == "unlocked_void"


def test_future_kickoff_is_not_due(make_store, make_prediction):
    pred = make_prediction(
        id="p3",
        status="published",
        published_at="2026-06-11T10:00:00+00:00",
        locked_at="2026-06-12T18:00:00+00:00",  # tomorrow
    )
    store = make_store(predictions=[pred])
    counts = run(dry_run=False, store=store, now=NOW)
    assert counts["due"] == 0
    assert store.predictions[0]["status"] == "published"


def test_dry_run_writes_nothing(make_store, make_prediction):
    pred = make_prediction(
        id="p4",
        status="published",
        published_at="2026-06-11T10:00:00+00:00",
        locked_at="2026-06-11T18:00:00+00:00",
    )
    store = make_store(predictions=[pred])
    counts = run(dry_run=True, store=store, now=NOW)
    assert counts["locked"] == 1  # would lock
    assert store.locked == []  # but no actual write
    assert store.predictions[0]["status"] == "published"
