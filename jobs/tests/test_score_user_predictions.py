"""Tests for score_user_predictions (W5, migration 0006): "Beat the Model"
pick scoring with Brier PARITY against the model ledger's own scoring, the
lock-visibility rule on fixture_pick_aggregates (never published before a
fixture locks), idempotent re-runs, dry-run, and per-item isolation.

Same conventions as test_score_results.py / test_fetch_predictions.py: the
job takes an injectable in-memory FakeStore (conftest.py); no network, no DB.
"""

import pytest

from jobs import scoring, util
from jobs.score_results import run as run_ledger_scoring
from jobs.score_user_predictions import run
from jobs.tests.conftest import FakeStore

NOW = util.parse_iso(FakeStore.DEFAULT_NOW)  # 2026-06-11T12:00:00+00:00
PAST_KICKOFF = "2026-06-10T18:00:00+00:00"  # before NOW -> fixture is locked
FUTURE_KICKOFF = "2026-06-11T18:00:00+00:00"  # after NOW -> still open


# --- pass 1: scoring ----------------------------------------------------------


def test_scores_finished_pick_with_the_ledgers_brier(make_store, make_fixture, make_user_pick):
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=2, final_away_goals=1,
    )
    pick = make_user_pick(id="pick-1", fixture_id=300, prob_home=0.5, prob_draw=0.3, prob_away=0.2)
    store = make_store(finished=[fixture], user_predictions=[pick])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["locked_due"] == 1
    assert counts["picks_scored"] == 1
    scored = store.user_predictions[0]
    assert scored["result"] == "home"
    assert scored["brier_score"] == pytest.approx(scoring.brier_score(0.5, 0.3, 0.2, "home"))
    assert scored["scored_at"] == NOW.isoformat()
    # The game's public metric is Brier ONLY -- no log_loss is ever written.
    assert "log_loss" not in store.user_pick_scores[0]
    assert "log_loss" not in scored


def test_brier_parity_with_the_ledger_on_identical_inputs(
    make_store, make_fixture, make_prediction, make_user_pick
):
    """The one non-negotiable of the game's scoring (ARCHITECTURE.md v3 §5):
    a user pick and a model ledger row with IDENTICAL probabilities on the
    SAME finished fixture must earn the IDENTICAL Brier score -- the game
    reuses scoring.brier_score, never a second bespoke formula."""
    probs = {"prob_home": 0.62, "prob_draw": 0.23, "prob_away": 0.15}
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=0, final_away_goals=2,  # away win
    )
    ledger_row = make_prediction(id="p1", fixture_id=300, status="locked", **probs)
    pick = make_user_pick(id="pick-1", fixture_id=300, **probs)
    store = make_store(
        finished=[fixture], predictions=[ledger_row], user_predictions=[pick]
    )

    run_ledger_scoring(dry_run=False, store=store)
    run(dry_run=False, store=store, now=NOW)

    ledger_brier = store.predictions[0]["brier_score"]
    pick_brier = store.user_predictions[0]["brier_score"]
    assert store.predictions[0]["result"] == "away"
    assert store.user_predictions[0]["result"] == "away"
    assert pick_brier == ledger_brier
    # And both equal the hand-checkable formula value:
    # 0.62^2 + 0.23^2 + (0.15 - 1)^2 = 0.3844 + 0.0529 + 0.7225 = 1.1598.
    assert pick_brier == pytest.approx(1.1598)


@pytest.mark.parametrize(
    ("final_home", "final_away", "expected_result"),
    [(2, 1, "home"), (1, 1, "draw"), (0, 3, "away")],
)
def test_result_derived_from_final_score(
    make_store, make_fixture, make_user_pick, final_home, final_away, expected_result
):
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=final_home, final_away_goals=final_away,
    )
    pick = make_user_pick(id="pick-1", fixture_id=300)
    store = make_store(finished=[fixture], user_predictions=[pick])

    run(dry_run=False, store=store, now=NOW)

    assert store.user_predictions[0]["result"] == expected_result


def test_already_scored_pick_never_reappears(make_store, make_fixture, make_user_pick):
    # scored_at drives the self-draining query -- a scored pick costs nothing.
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=1, final_away_goals=1,
    )
    pick = make_user_pick(
        id="pick-1", fixture_id=300, result="draw", brier_score=0.38,
        scored_at="2026-06-10T20:00:00+00:00",
    )
    store = make_store(finished=[fixture], user_predictions=[pick])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["locked_due"] == 0
    assert counts["picks_scored"] == 0
    assert store.user_pick_scores == []


def test_live_rerun_is_idempotent_end_to_end(make_store, make_fixture, make_user_pick):
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=2, final_away_goals=0,
    )
    pick = make_user_pick(id="pick-1", fixture_id=300)
    store = make_store(finished=[fixture], user_predictions=[pick])

    first = run(dry_run=False, store=store, now=NOW)
    second = run(dry_run=False, store=store, now=NOW)

    assert first["picks_scored"] == 1 and first["aggregates_written"] == 1
    assert second["picks_scored"] == 0 and second["aggregates_written"] == 0
    assert second["locked_due"] == 0 and second["aggregates_candidates"] == 0
    assert len(store.user_pick_scores) == 1  # exactly one score write, ever
    assert len(store.aggregate_writes) == 1  # exactly one aggregate write, ever


def test_pick_on_unfinished_fixture_is_not_scored(make_store, make_fixture, make_user_pick):
    fixture = make_fixture(id=300, status="scheduled", kickoff_utc=FUTURE_KICKOFF)
    pick = make_user_pick(id="pick-1", fixture_id=300)
    store = make_store(upcoming=[fixture], user_predictions=[pick])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["locked_due"] == 0
    assert store.user_pick_scores == []


def test_finished_fixture_missing_final_score_is_skipped_and_retried_later(
    make_store, make_fixture, make_user_pick
):
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=None, final_away_goals=None,
    )
    pick = make_user_pick(id="pick-1", fixture_id=300)
    store = make_store(finished=[fixture], user_predictions=[pick])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["skipped_no_final_score"] == 1
    assert counts["picks_scored"] == 0
    # Left unscored (scored_at still null) so the next run retries it.
    assert store.user_predictions[0]["scored_at"] is None


def test_one_bad_pick_never_aborts_everyone_elses_scoring(
    make_store, make_fixture, make_user_pick, caplog
):
    """Per-item isolation: a row with garbage probabilities (defence in depth
    -- the DB CHECK should make this impossible) is logged and skipped; the
    other user's pick on the same fixture is still scored."""
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=2, final_away_goals=1,
    )
    bad = make_user_pick(
        id="pick-bad", user_id="user-1", fixture_id=300,
        prob_home=0.9, prob_draw=0.9, prob_away=0.9,  # sums to 2.7
    )
    good = make_user_pick(id="pick-good", user_id="user-2", fixture_id=300)
    store = make_store(finished=[fixture], user_predictions=[bad, good])

    with caplog.at_level("ERROR"):
        counts = run(dry_run=False, store=store, now=NOW)

    assert counts["skipped_bad_probs"] == 1
    assert counts["picks_scored"] == 1
    assert "pick-bad" in caplog.text
    assert [s["id"] for s in store.user_pick_scores] == ["pick-good"]


def test_dry_run_writes_nothing(make_store, make_fixture, make_user_pick):
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=2, final_away_goals=1,
    )
    pick = make_user_pick(id="pick-1", fixture_id=300)
    store = make_store(finished=[fixture], user_predictions=[pick])

    counts = run(dry_run=True, store=store, now=NOW)

    assert counts["picks_scored"] == 1  # would score
    assert counts["aggregates_candidates"] == 1  # would aggregate
    assert counts["aggregates_written"] == 0
    assert store.user_pick_scores == []  # but no write anywhere
    assert store.aggregate_writes == []
    assert store.user_predictions[0]["scored_at"] is None
    assert store.pick_aggregates == []


# --- pass 2: fixture_pick_aggregates (the lock-visibility rule) ---------------


def test_aggregate_is_published_only_once_a_fixture_locks(
    make_store, make_fixture, make_user_pick
):
    """The anti-copying rule (migration 0006): a fixture that has NOT kicked
    off yet never gets an aggregate row, however many picks it has -- exactly
    mirroring "pool members see each other's picks only post-lock"."""
    locked_fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=1, final_away_goals=0,
    )
    open_fixture = make_fixture(id=301, status="scheduled", kickoff_utc=FUTURE_KICKOFF)
    picks = [
        make_user_pick(id="pick-1", user_id="user-1", fixture_id=300),
        make_user_pick(id="pick-2", user_id="user-1", fixture_id=301),
        make_user_pick(id="pick-3", user_id="user-2", fixture_id=301),
    ]
    store = make_store(
        finished=[locked_fixture], upcoming=[open_fixture], user_predictions=picks
    )

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["aggregates_candidates"] == 1
    assert counts["aggregates_written"] == 1
    assert [a["fixture_id"] for a in store.pick_aggregates] == [300]


def test_locked_but_unfinished_fixture_gets_its_aggregate_before_any_scoring(
    make_store, make_fixture, make_user_pick
):
    """Lock (kickoff passed) is the aggregate's publication gate, not
    full-time: an in-play fixture's crowd average appears as soon as picks
    can no longer change, while scoring still waits for the final score."""
    in_play = make_fixture(id=300, status="live", kickoff_utc=PAST_KICKOFF)
    pick = make_user_pick(id="pick-1", fixture_id=300)
    store = make_store(finished=[in_play], user_predictions=[pick])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["picks_scored"] == 0  # not finished -> nothing to score yet
    assert counts["aggregates_written"] == 1  # but locked -> aggregate is live
    assert store.user_predictions[0]["scored_at"] is None


def test_aggregate_averages_are_the_mean_of_the_picks(
    make_store, make_fixture, make_user_pick
):
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=2, final_away_goals=2,
    )
    picks = [
        make_user_pick(id="pick-1", user_id="user-1", fixture_id=300,
                       prob_home=0.5, prob_draw=0.3, prob_away=0.2),
        make_user_pick(id="pick-2", user_id="user-2", fixture_id=300,
                       prob_home=0.7, prob_draw=0.2, prob_away=0.1),
        make_user_pick(id="pick-3", user_id="user-3", fixture_id=300,
                       prob_home=0.3, prob_draw=0.4, prob_away=0.3),
    ]
    store = make_store(finished=[fixture], user_predictions=picks)

    run(dry_run=False, store=store, now=NOW)

    agg = store.pick_aggregates[0]
    assert agg["fixture_id"] == 300
    assert agg["n_picks"] == 3
    # Hand-computed: (0.5+0.7+0.3)/3, (0.3+0.2+0.4)/3, (0.2+0.1+0.3)/3.
    assert agg["avg_prob_home"] == pytest.approx(0.5)
    assert agg["avg_prob_draw"] == pytest.approx(0.3)
    assert agg["avg_prob_away"] == pytest.approx(0.2)
    # The average of normalised picks is itself normalised (DB CHECK holds).
    assert agg["avg_prob_home"] + agg["avg_prob_draw"] + agg["avg_prob_away"] == pytest.approx(1.0)


def test_fixture_with_an_existing_aggregate_is_never_recomputed(
    make_store, make_fixture, make_user_pick
):
    # Once locked, a fixture's pick set is frozen (write-window trigger), so
    # its aggregate row is correct forever -- the set difference must drain.
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=1, final_away_goals=0,
    )
    pick = make_user_pick(
        id="pick-1", fixture_id=300, result="home", brier_score=0.38,
        scored_at="2026-06-10T20:00:00+00:00",
    )
    existing = {
        "fixture_id": 300, "n_picks": 1,
        "avg_prob_home": 0.5, "avg_prob_draw": 0.3, "avg_prob_away": 0.2,
    }
    store = make_store(
        finished=[fixture], user_predictions=[pick], pick_aggregates=[existing]
    )

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["aggregates_candidates"] == 0
    assert counts["aggregates_written"] == 0
    assert store.aggregate_writes == []


def test_race_between_the_two_aggregate_reads_is_guarded_not_trusted(
    make_store, make_fixture, make_user_pick
):
    """If the candidate set says a fixture has picks but the per-fixture read
    then returns none (a mid-run race), the job must skip it cleanly -- never
    divide by zero (scoring.mean raises on empty) or write a bogus row."""
    fixture = make_fixture(
        id=300, status="finished", kickoff_utc=PAST_KICKOFF,
        final_home_goals=1, final_away_goals=0,
    )
    pick = make_user_pick(
        id="pick-1", fixture_id=300, result="home", brier_score=0.38,
        scored_at="2026-06-10T20:00:00+00:00",
    )

    class RacyStore(FakeStore):
        def user_prediction_probs_for_fixture(self, fixture_id):
            return []  # the picks "vanished" between the two reads

    store = RacyStore(finished=[fixture], user_predictions=[pick])

    counts = run(dry_run=False, store=store, now=NOW)

    assert counts["aggregates_candidates"] == 1
    assert counts["aggregates_written"] == 0
    assert store.aggregate_writes == []
