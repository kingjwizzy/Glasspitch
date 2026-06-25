"""Shared command-line entry point for the scheduled jobs.

Each job exposes ``run(*, dry_run=...)`` and calls :func:`main` from its
``__main__`` block so it can be run as ``python -m jobs.<name> [--dry-run]``.
"""

from __future__ import annotations

import argparse
import logging
from typing import Any, Callable, Optional, Sequence

Runner = Callable[..., dict]


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

    summary = run(dry_run=args.dry_run)
    mode = "DRY-RUN" if args.dry_run else "LIVE"
    logging.getLogger("jobs").info("[%s] %s complete: %s", mode, description, summary)
    return summary
