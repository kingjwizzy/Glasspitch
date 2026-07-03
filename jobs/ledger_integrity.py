"""Nightly job: ledger integrity ops -- private full-table backup snapshots +
a publicly-verifiable SHA-256 hash chain over the scored ledger
(ARCHITECTURE.md v3 "Ledger integrity ops" amendment, ROADMAP.md §4 item 5,
migration 0007). Two independent, DB-only passes (no football-API call):

## 1. Backup export (private, disaster-recovery only -- NOT the proof)

Full-table JSON snapshots of every football-data + ledger-adjacent table
(``BACKUP_TABLES`` below) are written to a PRIVATE Supabase Storage bucket
(``config.LEDGER_BACKUPS_BUCKET``, default ``'ledger-backups'``), created
idempotently (get-or-create) and verified non-public on every run
(``jobs.db.SupabaseStore.ensure_private_backup_bucket``) -- this job refuses
to upload into a bucket that turns out public rather than silently doing it.
One JSON file per table per day, at ``{table}/{snapshot_date}.json``,
overwritten (upsert) on a same-day re-run.

Scope note: ``BACKUP_TABLES`` covers football data + the public/game-derived
ledger surface (leagues/teams/fixtures/predictions plus top_scorers,
user_predictions, fixture_pick_aggregates, team_probability_snapshots,
tournament_chances). It deliberately EXCLUDES the personal/billing tables
(profiles, subscriptions, stripe_events, pools, pool_members) -- those already
have their own systems of record (Supabase Auth, Stripe) and there's no
reason to duplicate personal data into a second store, even a private one.

## 2. Hash chain (public, the actual verification artifact)

Every ``status='scored'`` prediction, ordered by ``(scored_at, id)`` -- a
STABLE order because a scored prediction is frozen by the migration
0001/0003 immutability trigger, so a re-run only ever appends new rows to
the tail -- is folded into a SHA-256 hash chain:

    chain_hash_0 = sha256(b"").hexdigest()          # genesis
    chain_hash_i = sha256(
        chain_hash_{i-1}.encode("ascii") + canonical_json(row_i)
    ).hexdigest()

The chain is recomputed FRESH from the FULL scored set on every run (never
incremental) -- safe and deterministic precisely because scored rows never
change once written. Today's checkpoint (``public.ledger_checkpoints``,
keyed on ``day``) records the chain's current tip (``chain_hash``), the
CUMULATIVE ``scored_rows`` count folded into it, and ``prev_hash`` --
YESTERDAY's checkpoint's ``chain_hash`` (a quick day-over-day continuity
link; the actual proof is re-deriving ``chain_hash`` from the public,
anon-readable ``predictions`` table directly, not trusting this column).

### Canonicalisation (so a third party can reproduce ``chain_hash`` exactly)

For each scored prediction row, exactly the columns in
``_PREDICTION_CHAIN_COLUMNS`` (below -- every column ``public.predictions``
has) are read into a plain dict, in that fixed order (order doesn't actually
matter for the hash, since ``json.dumps`` sorts keys -- it matters only for
readability here). Within that dict:

* every ``timestamptz`` field (``published_at``, ``locked_at``, ``scored_at``,
  ``created_at``) is rendered as its UTC ISO-8601 string via
  ``jobs.util.parse_iso(value).isoformat()`` -- the exact same normalisation
  ``jobs.util.to_utc_iso`` performs when a value is first stored, so a value
  read back from PostgREST (which may format offsets slightly differently)
  still canonicalises identically;
* every numeric field (``prob_home``, ``prob_draw``, ``prob_away``,
  ``brier_score``, ``log_loss``) is coerced to a Python ``float`` (or stays
  ``None``);
* everything else (``id``, ``fixture_id``, ``model_version``, ``source``,
  ``predicted_home_goals``, ``predicted_away_goals``, ``status``, ``tier``,
  ``final_home_goals``, ``final_away_goals``, ``result``) is passed through
  as-is (already JSON-safe scalars from PostgREST: str/int/bool/None).

That dict is then serialised with
``json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=True)``
-- sorted keys, no extra whitespace, ASCII-safe -- and UTF-8 encoded. A third
party can reproduce this exactly from ``GET /rest/v1/predictions?status=eq.scored&order=scored_at,id``
(the SAME public, anon-readable ledger endpoint the website itself reads).
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import timedelta
from typing import Iterable, Optional

from jobs import config, util
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)

# Tables exported to the private backup bucket -- see the module docstring's
# scope note for what's deliberately excluded (personal/billing data).
BACKUP_TABLES: tuple[str, ...] = (
    "leagues",
    "teams",
    "fixtures",
    "predictions",
    "top_scorers",
    "user_predictions",
    "fixture_pick_aggregates",
    "team_probability_snapshots",
    "tournament_chances",
)

# Exactly the columns of public.predictions (migration 0001/0003) -- see the
# module docstring's canonicalisation section. A FIXED, documented list so a
# third party can reproduce chain_hash independently.
_PREDICTION_CHAIN_COLUMNS: tuple[str, ...] = (
    "id", "fixture_id", "model_version", "source",
    "prob_home", "prob_draw", "prob_away",
    "predicted_home_goals", "predicted_away_goals",
    "published_at", "locked_at", "status", "tier",
    "final_home_goals", "final_away_goals", "result",
    "brier_score", "log_loss", "scored_at", "created_at",
)
_TIMESTAMP_FIELDS = frozenset({"published_at", "locked_at", "scored_at", "created_at"})
_NUMERIC_FIELDS = frozenset({"prob_home", "prob_draw", "prob_away", "brier_score", "log_loss"})

# sha256 of the empty byte string -- the chain's genesis hash (row 0's
# "previous hash").
_GENESIS_HASH = hashlib.sha256(b"").hexdigest()


def canonical_prediction_row(row: dict) -> dict:
    """Reduce one raw ``predictions`` row to its canonical, JSON-safe dict
    (see module docstring's canonicalisation section)."""
    canonical: dict = {}
    for key in _PREDICTION_CHAIN_COLUMNS:
        value = row.get(key)
        if value is not None and key in _TIMESTAMP_FIELDS:
            value = util.parse_iso(value).isoformat()
        elif value is not None and key in _NUMERIC_FIELDS:
            value = float(value)
        canonical[key] = value
    return canonical


def canonical_json(row: dict) -> bytes:
    """UTF-8 canonical JSON bytes for one already-canonical dict: sorted
    keys, no whitespace, ASCII-safe (see module docstring)."""
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode(
        "utf-8"
    )


def compute_chain(rows: Iterable[dict]) -> str:
    """Fold already-canonical ``rows`` (in canonical order) into a SHA-256
    hash chain, returning the final (tip) hash. See module docstring for the
    exact rule."""
    chain_hash = _GENESIS_HASH
    for row in rows:
        payload = chain_hash.encode("ascii") + canonical_json(row)
        chain_hash = hashlib.sha256(payload).hexdigest()
    return chain_hash


def run(
    *, dry_run: bool = False, store: Optional[SupabaseStore] = None, now=None
) -> dict:
    store = store if store is not None else SupabaseStore()
    now = now or util.now_utc()
    today = now.date().isoformat()
    yesterday = (now - timedelta(days=1)).date().isoformat()

    counts = {
        "tables_exported": 0,
        "rows_exported": 0,
        "scored_predictions": 0,
        "chain_hash": None,
    }

    if not dry_run:
        store.ensure_private_backup_bucket(config.LEDGER_BACKUPS_BUCKET)

    for table in BACKUP_TABLES:
        rows = store.dump_table(table)
        counts["tables_exported"] += 1
        counts["rows_exported"] += len(rows)
        path = f"{table}/{today}.json"
        if dry_run:
            log.info(
                "[dry-run] would export table %r (%d rows) to %s/%s",
                table, len(rows), config.LEDGER_BACKUPS_BUCKET, path,
            )
        else:
            payload = json.dumps(rows, sort_keys=True, indent=2, default=str).encode("utf-8")
            store.upload_backup(config.LEDGER_BACKUPS_BUCKET, path, payload)

    scored = store.scored_predictions_ordered()
    counts["scored_predictions"] = len(scored)
    chain_hash = compute_chain(canonical_prediction_row(row) for row in scored)
    counts["chain_hash"] = chain_hash

    prior_checkpoint = store.ledger_checkpoint_for_day(yesterday)
    prev_hash = prior_checkpoint["chain_hash"] if prior_checkpoint else None

    if dry_run:
        log.info(
            "[dry-run] would upsert ledger_checkpoints for %s: scored_rows=%d "
            "chain_hash=%s prev_hash=%s",
            today, len(scored), chain_hash, prev_hash,
        )
    else:
        store.upsert_ledger_checkpoint(
            day=today, scored_rows=len(scored), chain_hash=chain_hash, prev_hash=prev_hash,
        )

    return counts


if __name__ == "__main__":
    main(run, "Ledger integrity ops (backups + hash chain)")
