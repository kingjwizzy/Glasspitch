"""Tests for jobs/compute_leaderboard.py (RAMBO wave 2 improvement #5,
migration 0009): the public, opt-in "Beat the Model" leaderboard.

Same conventions as the rest of the jobs suite: an injectable in-memory
FakeStore (jobs/tests/conftest.py) -- no network, no DB. Covers the
mean-Brier-vs-model maths, opt-in filtering, honest inclusion of misses
(a scored pick counts however it went), the full-replace/prune semantics, and
dry-run.
"""

from __future__ import annotations

import pytest

from jobs import scoring
from jobs.compute_leaderboard import run


def _profile(user_id, *, opt_in=True, display_name=None):
    return {
        "id": user_id,
        "leaderboard_opt_in": opt_in,
        "leaderboard_display_name": display_name,
    }


def _pick(user_id, fixture_id, brier_score, *, scored=True):
    return {
        "user_id": user_id,
        "fixture_id": fixture_id,
        "brier_score": brier_score,
        "scored_at": "2026-06-11T20:00:00+00:00" if scored else None,
    }


def _model_prediction(fixture_id, brier_score, *, source="api-football", status="scored"):
    return {
        "id": f"pred-{fixture_id}",
        "fixture_id": fixture_id,
        "source": source,
        "status": status,
        "brier_score": brier_score,
    }


# --- no opted-in users -------------------------------------------------------


def test_no_opted_in_users_prunes_every_existing_standings_row(make_store):
    store = make_store(
        profiles=[],
        leaderboard_standings=[{"user_id": "stale-user", "rank": 1}],
    )

    counts = run(dry_run=False, store=store)

    assert counts["opted_in"] == 0
    assert counts["pruned"] == 1
    assert store.leaderboard_standings == []
    assert store.replace_leaderboard_standings_calls == [[]]


def test_no_opted_in_users_dry_run_writes_nothing(make_store):
    store = make_store(
        profiles=[],
        leaderboard_standings=[{"user_id": "stale-user", "rank": 1}],
    )

    counts = run(dry_run=True, store=store)

    assert counts["opted_in"] == 0
    assert counts["pruned"] == 0  # never computed -- the write never happened
    assert store.leaderboard_standings == [{"user_id": "stale-user", "rank": 1}]
    assert store.replace_leaderboard_standings_calls == []


# --- opt-in filtering + honest inclusion of misses ---------------------------


def test_opted_out_profile_is_never_considered(make_store):
    store = make_store(
        profiles=[_profile("user-1", opt_in=False)],
        user_predictions=[_pick("user-1", 300, 0.2)],
        predictions=[_model_prediction(300, 0.5)],
    )

    counts = run(dry_run=False, store=store)

    assert counts["opted_in"] == 0
    assert store.leaderboard_standings == []


def test_opted_in_user_with_no_scored_picks_is_skipped(make_store):
    store = make_store(profiles=[_profile("user-1")], user_predictions=[])

    counts = run(dry_run=False, store=store)

    assert counts["opted_in"] == 1
    assert counts["skipped_no_scored_picks"] == 1
    assert counts["eligible"] == 0
    assert store.leaderboard_standings == []


def test_unscored_pick_is_not_counted_as_a_scored_pick(make_store):
    store = make_store(
        profiles=[_profile("user-1")],
        user_predictions=[_pick("user-1", 300, None, scored=False)],
        predictions=[_model_prediction(300, 0.5)],
    )

    counts = run(dry_run=False, store=store)

    assert counts["skipped_no_scored_picks"] == 1
    assert store.leaderboard_standings == []


def test_pick_with_no_comparable_scored_model_prediction_is_excluded_from_both_means(
    make_store,
):
    # A scored pick, but the fixture has no comparable SCORED model call yet
    # (data-availability exclusion, never a performance one -- module
    # docstring). This is honest inclusion of MISSES done right: a bad pick
    # only ever gets excluded because there's nothing to compare it against,
    # never because it did badly.
    store = make_store(
        profiles=[_profile("user-1")],
        user_predictions=[_pick("user-1", 300, 1.8)],  # a bad miss, still real
        predictions=[],  # no model prediction at all for fixture 300
    )

    counts = run(dry_run=False, store=store)

    assert counts["skipped_no_comparable_model_score"] == 1
    assert counts["eligible"] == 0
    assert store.leaderboard_standings == []


def test_a_voided_model_prediction_is_never_comparable(make_store):
    # unlocked_void/void_cancelled never reach status='scored' by construction
    # (lock_predictions.py/score_results.py) -- filtering on status='scored'
    # already excludes them; this pins that a non-scored status row present
    # in the store is correctly ignored rather than matched by accident.
    store = make_store(
        profiles=[_profile("user-1")],
        user_predictions=[_pick("user-1", 300, 0.4)],
        predictions=[_model_prediction(300, 0.9, status="unlocked_void")],
    )

    counts = run(dry_run=False, store=store)

    assert counts["skipped_no_comparable_model_score"] == 1
    assert store.leaderboard_standings == []


# --- the mean-Brier-vs-model maths -------------------------------------------


def test_beat_margin_is_model_mean_minus_user_mean(make_store):
    store = make_store(
        profiles=[_profile("user-1", display_name="Sharp Shooter")],
        user_predictions=[
            _pick("user-1", 300, 0.2),
            _pick("user-1", 301, 0.6),
        ],
        predictions=[
            _model_prediction(300, 0.5),
            _model_prediction(301, 0.5),
        ],
    )

    counts = run(dry_run=False, store=store)

    assert counts["eligible"] == 1
    row = store.leaderboard_standings[0]
    assert row["user_id"] == "user-1"
    assert row["display_name"] == "Sharp Shooter"
    assert row["picks_scored"] == 2
    user_mean = scoring.mean([0.2, 0.6])
    model_mean = scoring.mean([0.5, 0.5])
    assert row["user_mean_brier"] == pytest.approx(user_mean)
    assert row["model_mean_brier"] == pytest.approx(model_mean)
    assert row["beat_margin"] == pytest.approx(model_mean - user_mean)
    # Hand-checkable: user mean 0.4, model mean 0.5 -> beat the model by 0.1.
    assert row["beat_margin"] == pytest.approx(0.1)
    assert row["rank"] == 1


def test_only_the_fixtures_with_a_comparable_model_score_enter_either_mean(make_store):
    store = make_store(
        profiles=[_profile("user-1")],
        user_predictions=[
            _pick("user-1", 300, 0.1),  # comparable
            _pick("user-1", 301, 9.9),  # NOT comparable -- must be excluded
        ],
        predictions=[_model_prediction(300, 0.3)],  # fixture 301 has no model row
    )

    run(dry_run=False, store=store)

    row = store.leaderboard_standings[0]
    assert row["picks_scored"] == 1
    assert row["user_mean_brier"] == pytest.approx(0.1)
    assert row["model_mean_brier"] == pytest.approx(0.3)


def test_anonymous_label_fallback_when_no_display_name_is_set(make_store):
    store = make_store(
        profiles=[_profile("user-abcdefghij", display_name=None)],
        user_predictions=[_pick("user-abcdefghij", 300, 0.2)],
        predictions=[_model_prediction(300, 0.2)],
    )

    run(dry_run=False, store=store)

    row = store.leaderboard_standings[0]
    # First 8 characters of the uuid -- never an email or real name (neither
    # is ever fetched here, see module docstring).
    assert row["display_name"] == "Player user-abc"


# --- ranking + full-replace/prune --------------------------------------------


def test_standings_are_ranked_by_beat_margin_descending(make_store):
    store = make_store(
        profiles=[_profile("best"), _profile("worst"), _profile("middle")],
        user_predictions=[
            _pick("best", 300, 0.1),
            _pick("worst", 300, 0.9),
            _pick("middle", 300, 0.5),
        ],
        predictions=[_model_prediction(300, 0.5)],
    )

    run(dry_run=False, store=store)

    ranked = sorted(store.leaderboard_standings, key=lambda r: r["rank"])
    assert [r["user_id"] for r in ranked] == ["best", "middle", "worst"]
    assert [r["rank"] for r in ranked] == [1, 2, 3]
    # Monotonically decreasing beat_margin as rank increases.
    assert ranked[0]["beat_margin"] > ranked[1]["beat_margin"] > ranked[2]["beat_margin"]


def test_full_replace_prunes_a_standings_row_for_a_user_no_longer_eligible(make_store):
    store = make_store(
        profiles=[_profile("still-in")],
        user_predictions=[_pick("still-in", 300, 0.2)],
        predictions=[_model_prediction(300, 0.4)],
        leaderboard_standings=[
            {"user_id": "still-in", "rank": 2},
            {"user_id": "opted-out-since", "rank": 1},
        ],
    )

    counts = run(dry_run=False, store=store)

    assert counts["pruned"] == 1
    ids = {r["user_id"] for r in store.leaderboard_standings}
    assert ids == {"still-in"}


def test_rerun_is_idempotent(make_store):
    store = make_store(
        profiles=[_profile("user-1")],
        user_predictions=[_pick("user-1", 300, 0.2)],
        predictions=[_model_prediction(300, 0.4)],
    )

    first = run(dry_run=False, store=store)
    second = run(dry_run=False, store=store)

    assert first["eligible"] == second["eligible"] == 1
    assert len(store.leaderboard_standings) == 1
    assert store.leaderboard_standings[0]["beat_margin"] == pytest.approx(0.2)
    assert len(store.replace_leaderboard_standings_calls) == 2


# --- dry-run ------------------------------------------------------------------


def test_dry_run_computes_counts_but_writes_nothing(make_store):
    store = make_store(
        profiles=[_profile("user-1")],
        user_predictions=[_pick("user-1", 300, 0.2)],
        predictions=[_model_prediction(300, 0.4)],
    )

    counts = run(dry_run=True, store=store)

    assert counts["eligible"] == 1
    assert counts["rows_written"] == 0
    assert store.leaderboard_standings == []
    assert store.replace_leaderboard_standings_calls == []
