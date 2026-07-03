"""Tests for ledger_integrity (migration 0007): the nightly private backup
export + the public SHA-256 hash chain over the scored ledger.

The hash-chain tests below deliberately REPRODUCE the documented
canonicalisation + chaining rule BY HAND (hashlib + json literals written out
in the test, not calls back into the module) for the first rows -- so a
regression in the canonical form can't hide behind itself, and the tests
double as executable documentation of what a third-party verifier must
implement. Job-level tests use the injectable in-memory FakeStore
(conftest.py) with its mocked Storage surface: no network, no DB, no bucket.
"""

import hashlib
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from storage3.exceptions import StorageApiError

from jobs import config, util
from jobs.db import SupabaseStore
from jobs.ledger_integrity import (
    BACKUP_TABLES,
    canonical_json,
    canonical_prediction_row,
    compute_chain,
    run,
)
from jobs.tests.conftest import FakeStore

NOW = util.parse_iso(FakeStore.DEFAULT_NOW)  # 2026-06-11T12:00:00+00:00
TODAY = "2026-06-11"
YESTERDAY = "2026-06-10"

GENESIS = hashlib.sha256(b"").hexdigest()


def _scored_row(**overrides):
    """One raw predictions row exactly as PostgREST would return it -- every
    column public.predictions has (the 20 documented chain columns)."""
    base = {
        "id": "pred-1",
        "fixture_id": 300,
        "model_version": "api-football-v1",
        "source": "api-football",
        "prob_home": 0.5,
        "prob_draw": 0.3,
        "prob_away": 0.2,
        "predicted_home_goals": 2,
        "predicted_away_goals": 1,
        "published_at": "2026-06-11T10:00:00+00:00",
        "locked_at": "2026-06-11T18:00:00+00:00",
        "status": "scored",
        "tier": "free",
        "final_home_goals": 2,
        "final_away_goals": 1,
        "result": "home",
        "brier_score": 0.38,
        "log_loss": 0.6931471805599453,
        "scored_at": "2026-06-11T20:05:00+00:00",
        "created_at": "2026-06-11T09:00:00+00:00",
    }
    base.update(overrides)
    return base


def _hand_canonical(raw):
    """The documented canonicalisation, implemented INDEPENDENTLY of
    jobs/ledger_integrity.py (a hand copy of the module docstring's rule):
    exactly the 20 predictions columns; timestamptz -> UTC ISO-8601 via
    parse_iso().isoformat(); numerics -> float; everything else as-is."""
    columns = (
        "id", "fixture_id", "model_version", "source",
        "prob_home", "prob_draw", "prob_away",
        "predicted_home_goals", "predicted_away_goals",
        "published_at", "locked_at", "status", "tier",
        "final_home_goals", "final_away_goals", "result",
        "brier_score", "log_loss", "scored_at", "created_at",
    )
    timestamps = {"published_at", "locked_at", "scored_at", "created_at"}
    numerics = {"prob_home", "prob_draw", "prob_away", "brier_score", "log_loss"}
    out = {}
    for key in columns:
        value = raw.get(key)
        if value is not None and key in timestamps:
            value = util.parse_iso(value).isoformat()
        elif value is not None and key in numerics:
            value = float(value)
        out[key] = value
    return out


def _hand_json(canonical):
    return json.dumps(
        canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")


def _hand_chain(canonical_rows):
    chain = hashlib.sha256(b"").hexdigest()
    for row in canonical_rows:
        chain = hashlib.sha256(chain.encode("ascii") + _hand_json(row)).hexdigest()
    return chain


# --- canonicalisation ----------------------------------------------------------


def test_canonical_row_keeps_exactly_the_documented_columns():
    raw = _scored_row()
    raw["fixture"] = {"id": 300, "status": "finished"}  # an embedded join
    raw["some_future_column"] = "must not enter the chain"

    canonical = canonical_prediction_row(raw)

    assert canonical == _hand_canonical(_scored_row())
    assert "fixture" not in canonical and "some_future_column" not in canonical
    assert len(canonical) == 20


def test_equivalent_timestamp_and_numeric_formats_canonicalise_identically():
    plain = _scored_row()
    # The same instants/numbers as PostgREST might ALSO render them: a 'Z'
    # suffix, a non-UTC offset, and numerics serialised as strings.
    variant = _scored_row(
        published_at="2026-06-11T10:00:00Z",
        locked_at="2026-06-11T20:00:00+02:00",
        scored_at="2026-06-11T15:05:00-05:00",
        prob_home="0.5",
        brier_score="0.38",
    )

    assert canonical_prediction_row(variant) == canonical_prediction_row(plain)
    assert canonical_json(canonical_prediction_row(variant)) == canonical_json(
        canonical_prediction_row(plain)
    )
    # Nulls stay null (a scoring field that genuinely never got a value).
    nulled = canonical_prediction_row(_scored_row(log_loss=None))
    assert nulled["log_loss"] is None


# --- the chain, reproduced by hand ----------------------------------------------


def test_chain_matches_a_fully_hand_computed_sha256_fold():
    raw1 = _scored_row()
    raw2 = _scored_row(
        id="pred-2", fixture_id=301, result="away", brier_score=1.62,
        prob_home=0.2, prob_draw=0.3, prob_away=0.5,
        final_home_goals=0, final_away_goals=2,
        scored_at="2026-06-11T21:00:00+00:00",
    )

    c1, c2 = _hand_canonical(raw1), _hand_canonical(raw2)
    hand_h1 = hashlib.sha256(GENESIS.encode("ascii") + _hand_json(c1)).hexdigest()
    hand_h2 = hashlib.sha256(hand_h1.encode("ascii") + _hand_json(c2)).hexdigest()

    assert compute_chain([]) == GENESIS
    assert compute_chain([canonical_prediction_row(raw1)]) == hand_h1
    assert (
        compute_chain(canonical_prediction_row(r) for r in (raw1, raw2)) == hand_h2
    )
    # And the independent hand fold agrees end-to-end.
    assert _hand_chain([c1, c2]) == hand_h2


def test_chain_extends_from_the_previous_tip_append_only():
    rows = [
        canonical_prediction_row(_scored_row(id=f"pred-{i}", fixture_id=300 + i))
        for i in range(3)
    ]
    tip_after_two = compute_chain(rows[:2])
    extended = hashlib.sha256(
        tip_after_two.encode("ascii") + canonical_json(rows[2])
    ).hexdigest()
    assert compute_chain(rows) == extended


def test_tampering_reordering_or_truncating_rows_changes_the_chain_hash():
    raws = [
        _scored_row(id="pred-1"),
        _scored_row(id="pred-2", fixture_id=301, result="away"),
        _scored_row(id="pred-3", fixture_id=302, result="draw"),
    ]
    baseline = compute_chain(canonical_prediction_row(r) for r in raws)

    # Tamper: flip one scored result after the fact.
    tampered = [dict(r) for r in raws]
    tampered[1]["result"] = "home"
    assert compute_chain(canonical_prediction_row(r) for r in tampered) != baseline

    # Tamper: nudge one probability by a hair.
    nudged = [dict(r) for r in raws]
    nudged[0]["prob_home"] = 0.5000001
    assert compute_chain(canonical_prediction_row(r) for r in nudged) != baseline

    # Reorder two rows.
    reordered = [raws[1], raws[0], raws[2]]
    assert compute_chain(canonical_prediction_row(r) for r in reordered) != baseline

    # Truncate the tail.
    assert compute_chain(canonical_prediction_row(r) for r in raws[:2]) != baseline


# --- the job: export + checkpoint ------------------------------------------------


def test_backup_tables_never_include_personal_or_billing_data():
    assert set(BACKUP_TABLES).isdisjoint(
        {
            "profiles", "subscriptions", "stripe_events",
            "pools", "pool_members", "email_subscribers",
        }
    )


def _seeded_store(**extra):
    """Two SCORED predictions (seeded out of chain order to prove the
    (scored_at, id) sort), one still-published one (in the backup dump but
    NEVER in the chain), plus a top-scorers row so rows_exported counts more
    than one table."""
    p_late = _scored_row(id="pred-late", fixture_id=301,
                         scored_at="2026-06-11T21:00:00+00:00")
    p_early = _scored_row(id="pred-early", fixture_id=300,
                          scored_at="2026-06-11T20:05:00+00:00")
    p_open = _scored_row(
        id="pred-open", fixture_id=302, status="published", result=None,
        brier_score=None, log_loss=None, scored_at=None,
        final_home_goals=None, final_away_goals=None,
    )
    return FakeStore(
        predictions=[p_late, p_early, p_open],
        top_scorers=[{"league_id": 100, "api_player_id": 1, "player_name": "A",
                      "team_name": "B", "goals": 3, "rank": 1}],
        **extra,
    )


def test_run_exports_every_backup_table_and_writes_todays_checkpoint():
    store = _seeded_store()

    counts = run(dry_run=False, store=store, now=NOW)

    # Storage: the private bucket is ensured, then one file per table per day.
    assert store.ensured_buckets == [config.LEDGER_BACKUPS_BUCKET]
    assert {path for _bucket, path, _payload in store.uploads} == {
        f"{table}/{TODAY}.json" for table in BACKUP_TABLES
    }
    assert all(bucket == config.LEDGER_BACKUPS_BUCKET for bucket, _p, _b in store.uploads)

    # The predictions dump is the FULL table (open rows included -- backups
    # are disaster recovery, not the chain).
    dumped = json.loads(store.backup_files[(config.LEDGER_BACKUPS_BUCKET,
                                            f"predictions/{TODAY}.json")])
    assert {r["id"] for r in dumped} == {"pred-late", "pred-early", "pred-open"}

    # The chain folds ONLY the scored rows, in (scored_at, id) order --
    # pred-early first even though it was seeded second.
    expected_chain = compute_chain(
        canonical_prediction_row(r)
        for r in sorted(
            (p for p in store.predictions if p["status"] == "scored"),
            key=lambda p: (p["scored_at"], p["id"]),
        )
    )
    assert counts == {
        "tables_exported": len(BACKUP_TABLES),
        "rows_exported": 4,  # 3 predictions + 1 top_scorers row
        "scored_predictions": 2,
        "chain_hash": expected_chain,
    }
    assert store.checkpoint_writes == [
        {
            "day": TODAY,
            "scored_rows": 2,
            "chain_hash": expected_chain,
            "prev_hash": None,  # first checkpoint ever -- no yesterday
        }
    ]


def test_prev_hash_links_to_yesterdays_checkpoint():
    yesterday_tip = "f" * 64
    store = _seeded_store(
        ledger_checkpoints=[
            {"day": YESTERDAY, "scored_rows": 1, "chain_hash": yesterday_tip,
             "prev_hash": None},
        ]
    )

    run(dry_run=False, store=store, now=NOW)

    today_row = store.ledger_checkpoint_for_day(TODAY)
    assert today_row["prev_hash"] == yesterday_tip


def test_dry_run_computes_everything_but_touches_nothing():
    store = _seeded_store()

    counts = run(dry_run=True, store=store, now=NOW)

    assert counts["tables_exported"] == len(BACKUP_TABLES)
    assert counts["scored_predictions"] == 2
    assert counts["chain_hash"] is not None
    assert store.ensured_buckets == []
    assert store.uploads == []
    assert store.backup_files == {}
    assert store.checkpoint_writes == []
    assert store.ledger_checkpoints == []


def test_same_day_rerun_overwrites_the_same_files_and_checkpoint():
    store = _seeded_store()

    first = run(dry_run=False, store=store, now=NOW)
    second = run(dry_run=False, store=store, now=NOW)

    # Scored rows are frozen -> the recomputed chain is bit-identical.
    assert second["chain_hash"] == first["chain_hash"]
    # Two upload passes, but the SAME file paths -- upsert-overwrite, never
    # a second copy of the same day.
    assert len(store.uploads) == 2 * len(BACKUP_TABLES)
    assert len(store.backup_files) == len(BACKUP_TABLES)
    # One checkpoint row for the day, written twice with identical values.
    assert store.checkpoint_writes[0] == store.checkpoint_writes[1]
    assert [c["day"] for c in store.ledger_checkpoints] == [TODAY]


def test_newly_scored_row_extends_the_chain_and_links_the_next_day():
    store = _seeded_store()
    day1 = run(dry_run=False, store=store, now=NOW)

    # Overnight, score_results scores the open prediction (append-only tail).
    newly_scored = next(p for p in store.predictions if p["id"] == "pred-open")
    newly_scored.update(
        {
            "status": "scored", "result": "home", "brier_score": 0.38,
            "log_loss": 0.69, "final_home_goals": 2, "final_away_goals": 1,
            "scored_at": "2026-06-12T01:00:00+00:00",
        }
    )
    day2 = run(dry_run=False, store=store, now=NOW + timedelta(days=1))

    # The new tip is EXACTLY the old tip folded with the one new row.
    expected_tip = hashlib.sha256(
        day1["chain_hash"].encode("ascii")
        + canonical_json(canonical_prediction_row(newly_scored))
    ).hexdigest()
    assert day2["chain_hash"] == expected_tip
    assert day2["scored_predictions"] == 3

    day2_row = store.ledger_checkpoint_for_day("2026-06-12")
    assert day2_row["prev_hash"] == day1["chain_hash"]
    assert day2_row["scored_rows"] == 3
    assert [c["day"] for c in store.ledger_checkpoints] == [TODAY, "2026-06-12"]


# --- SupabaseStore.ensure_private_backup_bucket (stubbed Storage client) ---------


class _StubStorage:
    def __init__(self, bucket=None, missing=False):
        self._bucket = bucket
        self._missing = missing
        self.created = []

    def get_bucket(self, bucket_id):
        if self._missing:
            raise StorageApiError("Bucket not found", "404", 404)
        return self._bucket

    def create_bucket(self, bucket_id, options=None):
        self.created.append((bucket_id, options))
        self._missing = False
        self._bucket = SimpleNamespace(public=(options or {}).get("public", True))


def _store_with_storage(storage):
    return SupabaseStore(client=SimpleNamespace(storage=storage))


def test_ensure_private_backup_bucket_accepts_an_existing_private_bucket():
    storage = _StubStorage(bucket=SimpleNamespace(public=False))
    _store_with_storage(storage).ensure_private_backup_bucket("ledger-backups")
    assert storage.created == []  # get-or-create: no re-create of an existing bucket


def test_ensure_private_backup_bucket_creates_a_missing_bucket_as_private():
    storage = _StubStorage(missing=True)
    _store_with_storage(storage).ensure_private_backup_bucket("ledger-backups")
    assert storage.created == [("ledger-backups", {"public": False})]


def test_ensure_private_backup_bucket_refuses_a_public_bucket():
    storage = _StubStorage(bucket=SimpleNamespace(public=True))
    with pytest.raises(RuntimeError, match="PUBLIC"):
        _store_with_storage(storage).ensure_private_backup_bucket("ledger-backups")
