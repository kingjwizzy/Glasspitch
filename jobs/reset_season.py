"""Dev tooling: tear down ALL data for a season (ARCHITECTURE.md §5, §7; docs/SEEDING.md).

Deletes predictions -> fixtures -> teams -> leagues for the given season, in
FK-safe order, idempotently. Used to wipe disposable dev seed data (e.g. the 2022
Qatar World Cup) so the switch to live data is one clean teardown — no manual DB
surgery. Runs as the service role, via the server-side ``teardown_season()``
SECURITY DEFINER RPC (supabase/migrations/0003_harden_db.sql): a migration-0003
BEFORE DELETE guard now rejects a direct client-side DELETE on any
locked/scored prediction, so the RPC — which sets
``glasspitch.allow_ledger_teardown='on'`` transaction-locally before deleting —
is the only sanctioned way to remove those rows. NOT part of normal operation.

    python -m jobs.reset_season --season 2022 --dry-run   # report counts only
    python -m jobs.reset_season --season 2022             # delete
"""

from __future__ import annotations

import argparse
import logging
from typing import Optional, Sequence

from jobs import config
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def run(
    *,
    season: int,
    dry_run: bool = False,
    store: Optional[SupabaseStore] = None,
    allow_live: bool = False,
) -> dict:
    # Safety interlock: refuse to delete the LIVE production season. The cutover wipes
    # the disposable dev season (e.g. 2022), never the real 2026 ledger; a fat-fingered
    # --season 2026 must not nuke live data. Override deliberately with --allow-live-season.
    if season == config.LIVE_SEASON and not allow_live:
        raise SystemExit(
            f"refusing to delete the LIVE season {season}: this would wipe the real "
            f"prediction ledger (see docs/SEEDING.md). Pass --allow-live-season to override."
        )

    store = store if store is not None else SupabaseStore()

    if dry_run:
        would_delete = store.count_season_rows(season)
        log.info("[dry-run] would delete for season %s: %s", season, would_delete)
        return {"season": season, "dry_run": True, "would_delete": would_delete}

    deleted = store.teardown_season(season)
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
    parser.add_argument(
        "--allow-live-season",
        action="store_true",
        help=f"Override the safety interlock and delete even the live default season "
        f"({config.LIVE_SEASON}). Dev tooling only — this wipes the real ledger.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    summary = run(season=args.season, dry_run=args.dry_run, allow_live=args.allow_live_season)
    mode = "DRY-RUN" if args.dry_run else "LIVE"
    logging.getLogger("jobs").info("[%s] Reset season complete: %s", mode, summary)
    return summary


if __name__ == "__main__":
    main()
