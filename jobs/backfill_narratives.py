"""One-off backfill: free "what's driving this call" narrative for EXISTING
ledger rows (improvement #6, migration 0009).

DB-only -- ZERO football-API calls. Derives ``predictions.narrative``
(``jobs.narrative.build_free_narrative``) for every existing
``source='api-football'`` prediction that predates the narrative column,
PURELY from data already stored: this fixture's team names (joined from
``fixtures``/``teams``) plus its stored
``fixture_insights(kind='prediction_detail')`` payload, if any (older
fixtures often lack one -- the narrative simply degrades to the one-sentence
probability read in that case, same as jobs/fetch_predictions.py's own
going-forward logic).

Idempotent + self-draining: only targets ``predictions.narrative IS NULL``
rows (``jobs.db.SupabaseStore.predictions_missing_narrative``), so a re-run
only ever processes whatever wasn't already written -- safe to run at any
time, including alongside the live scheduler, and safe to run more than
once. Not part of ``scheduler.yml`` (it is a ONE-OFF catch-up, not a
recurring job) -- run it manually once after this migration lands:

    python -m jobs.backfill_narratives --dry-run   # preview, no writes
    python -m jobs.backfill_narratives             # write

Going forward, jobs/fetch_predictions.py derives + stores the SAME narrative
inline for every NEWLY-inserted api-football prediction (from the SAME
/predictions response, never a second fetch) -- this script exists only to
catch up whatever was written before that logic landed.
"""

from __future__ import annotations

import logging
from typing import Optional

from jobs import config
from jobs.cli import main
from jobs.db import SupabaseStore
from jobs.narrative import build_free_narrative

log = logging.getLogger(__name__)


def run(*, dry_run: bool = False, store: Optional[SupabaseStore] = None) -> dict:
    store = store if store is not None else SupabaseStore()

    counts = {"candidates": 0, "narrative_written": 0, "skipped_missing_teams": 0}

    candidates = store.predictions_missing_narrative(source=config.THIRD_PARTY_SOURCE)
    counts["candidates"] = len(candidates)
    if not candidates:
        return counts

    fixture_ids = [row["fixture_id"] for row in candidates]
    insights = store.insight_payloads_for_fixtures(fixture_ids, kind="prediction_detail")

    for row in candidates:
        fixture = row.get("fixture") or {}
        home_team = fixture.get("home_team") or {}
        away_team = fixture.get("away_team") or {}
        home_name = home_team.get("name")
        away_name = away_team.get("name")
        if not home_name or not away_name:
            # Shouldn't happen for a real fixture (both team FKs are
            # NOT NULL) -- guards against a malformed/partial row rather
            # than trusting the join blindly; one bad row is skipped, never
            # aborts the whole backfill.
            counts["skipped_missing_teams"] += 1
            log.warning(
                "backfill_narratives: prediction %s (fixture %s) has no "
                "team name(s) on record; skipping.",
                row["id"], row["fixture_id"],
            )
            continue

        insight = insights.get(row["fixture_id"]) or {}
        narrative = build_free_narrative(
            home_name=home_name,
            away_name=away_name,
            prob_home=row["prob_home"],
            prob_draw=row["prob_draw"],
            prob_away=row["prob_away"],
            comparison=insight.get("comparison"),
            h2h_summary=insight.get("h2h_summary"),
        )

        if dry_run:
            log.info(
                "[dry-run] would write narrative for prediction %s "
                "(fixture %s): %r",
                row["id"], row["fixture_id"], narrative,
            )
        else:
            store.write_prediction_narrative(row["id"], narrative=narrative)
            counts["narrative_written"] += 1

    return counts


if __name__ == "__main__":
    main(run, "Backfill free narratives")
