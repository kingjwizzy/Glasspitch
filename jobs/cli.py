"""Shared command-line entry point for the scheduled jobs.

Each job exposes ``run(*, dry_run=...)`` and calls :func:`main` from its
``__main__`` block so it can be run as ``python -m jobs.<name> [--dry-run]``.
"""

from __future__ import annotations

import argparse
import logging
from typing import Any, Callable, Optional, Sequence

from jobs import util

Runner = Callable[..., dict]


def _record_job_run(
    *, job: str, started_at, finished_at, ok: bool, counts: dict, error: Optional[str]
) -> None:
    """Best-effort write of a job_runs row (migration 0003). Observability must
    never crash — or mask — the job's own outcome, so any failure here is
    logged and swallowed, never raised."""
    try:
        from jobs.db import SupabaseStore  # local import: keep cli.py import-light

        SupabaseStore().record_job_run(
            job=job,
            started_at=started_at.isoformat(),
            finished_at=finished_at.isoformat(),
            ok=ok,
            counts=counts,
            error=error,
        )
    except Exception:  # noqa: BLE001
        logging.getLogger("jobs").warning(
            "Failed to record job_runs row for %r (non-fatal).", job, exc_info=True
        )


def main(run: Runner, description: str, argv: Optional[Sequence[str]] = None) -> dict:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do everything except WRITE to the database: fetch + parse + log "
        "what would be written. Note: dry-run still calls the football API.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable debug logging."
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("jobs")

    started_at = util.now_utc()
    ok = True
    summary: dict[str, Any] = {}
    error_text: Optional[str] = None
    try:
        summary = run(dry_run=args.dry_run)
        return summary
    except Exception as exc:  # noqa: BLE001 — always summarise + record, then re-raise
        ok = False
        error_text = f"{type(exc).__name__}: {exc}"
        summary = {"error": error_text}
        raise
    finally:
        # A `finally` path so the summary is always emitted -- and the run is
        # always recorded -- even on a mid-run crash, not only on success
        # (previously a crash produced a bare stack trace and no summary at
        # all, and there was no persisted record of the run either).
        finished_at = util.now_utc()
        mode = "DRY-RUN" if args.dry_run else "LIVE"
        if ok:
            log.info("[%s] %s complete: %s", mode, description, summary)
        else:
            log.error("[%s] %s FAILED: %s", mode, description, summary)
        if not args.dry_run:
            _record_job_run(
                job=description,
                started_at=started_at,
                finished_at=finished_at,
                ok=ok,
                counts=summary,
                error=error_text,
            )
