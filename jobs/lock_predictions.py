"""Frequent job: lock predictions at kickoff; void late ones (ARCHITECTURE.md §8.3, §10).

For every published prediction whose locked_at (= kickoff) has passed:
  * if it was published before kickoff, set status='locked' (the §7 trigger then
    makes the prediction immutable);
  * if it was published AFTER kickoff (never a valid pre-kickoff prediction),
    set status='unlocked_void' so it is excluded from the scored record —
    integrity over coverage (§5, §10).
"""

from __future__ import annotations

import logging
from typing import Optional

from jobs import util
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def run(*, dry_run: bool = False, store: Optional[SupabaseStore] = None, now=None) -> dict:
    store = store if store is not None else SupabaseStore()
    now = now or util.now_utc()

    due = store.published_predictions_due(now.isoformat())
    counts = {"due": len(due), "locked": 0, "voided": 0}

    for pred in due:
        published_at = util.parse_iso(pred["published_at"])
        locked_at = util.parse_iso(pred["locked_at"])
        valid = published_at <= locked_at
        if valid:
            counts["locked"] += 1
            if dry_run:
                log.info("[dry-run] would lock prediction %s.", pred["id"])
            else:
                store.mark_locked(pred["id"])
        else:
            counts["voided"] += 1
            log.warning(
                "Prediction %s was published (%s) after kickoff (%s); marking "
                "unlocked_void.",
                pred["id"], pred["published_at"], pred["locked_at"],
            )
            if not dry_run:
                store.mark_unlocked_void(pred["id"])

    return counts


if __name__ == "__main__":
    main(run, "Lock predictions")
