"""Dev tooling: tear down ALL data for a season (ARCHITECTURE.md §5, §7; docs/SEEDING.md).

Deletes predictions -> fixtures -> teams -> leagues for the given season, in
FK-safe order, idempotently. Used to wipe disposable dev seed data (e.g. the 2022
Qatar World Cup) so the switch to live data is one clean teardown — no manual DB
surgery. Runs as the service role (the §7 immutability trigger is UPDATE-only and
does not block DELETE). NOT part of normal operation.

    python -m jobs.reset_season --season 2022 --dry-run   # report counts only
    python -m jobs.reset_season --season 2022             # delete
"""

from __future__ import annotations

import argparse
import logging
from typing import Optional, Sequence

from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def run(
    *, season: int, dry_run: bool = False, store: Optional[SupabaseStore] = None
) -> dict:
    store = store if store is not None else SupabaseStore()

    if dry_run:
        would_delete = store.count_season_rows(season)
        log.info("[dry-run] would delete for season %s: %s", season, would_delete)
        return {"season": season, "dry_run": True, "would_delete": would_delete}

    deleted = store.delete_season(season)
    remaining = store.count_season_rows(season)  # expect all zero
    log.info("Deleted for season %s: %s; remaining: %s", season, deleted, remaining)
    return {"season": season, "dry_run": False, "deleted": deleted, "remaining": remaining}


def main(argv: Optional[Sequence[str]] = None) -> dict:
    parser = argparse.ArgumentParser(description="Tear down all data for a season (dev only)")
    parser.add_argument(
        "--season", type=int, required=True, help="Season to delete (e.g. 2022)."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report counts only; delete nothing."
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    summary = run(season=args.season, dry_run=args.dry_run)
    mode = "DRY-RUN" if args.dry_run else "LIVE"
    logging.getLogger("jobs").info("[%s] Reset season complete: %s", mode, summary)
    return summary


if __name__ == "__main__":
    main()
