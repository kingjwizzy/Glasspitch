"""Nightly job: per-team Elo-derived probability snapshots for upcoming
fixtures -- powers the free Gameweek Board + Fixture Ticker (ARCHITECTURE.md
v3 §5, ROADMAP.md §2/§4, migration 0006).

For every fixture kicking off within ``config.SNAPSHOT_FIXTURE_WINDOW_HOURS``
(default 14 days -- wider than the ledger's own 72h prediction-fetch window,
since the board/ticker are meant to show several gameweeks of upcoming
fixture difficulty): derive both sides' current Elo ratings (the SAME replay
``jobs/fetch_predictions.py`` already runs -- ``jobs.elo.ratings_from_results``,
scoped to the tracked league(s) + season) and compute
``jobs.elo.team_snapshot_metrics()`` -- three-way win/draw/loss, a clean-sheet
estimate, and continuous expected goals for/against, all derived from one
mutually-consistent rating pair (see that function's docstring for the
maths). Writes TWO rows per fixture (one per side) into
``team_probability_snapshots``, keyed on ``(snapshot_date, team_id,
fixture_id)`` -- idempotent, safe to re-run the same day.

Day-over-day deltas (``delta_elo_rating``, ``delta_prob_win``) are computed
ONCE, at write time, against YESTERDAY's snapshot for the SAME
``(team_id, fixture_id)`` pair -- fetched as a single bulk read per run
(``jobs/db.py``'s ``team_probability_snapshots_for_date``), not one query per
pair. Null on that pair's first-ever snapshot (nothing to diff against yet).

DB-only: makes NO football-API call, so this job spends nothing against the
100/day budget no matter how many fixtures it snapshots.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Optional

from jobs import config, elo, util
from jobs.cli import main
from jobs.db import SupabaseStore

log = logging.getLogger(__name__)


def _derived_ratings(store: SupabaseStore) -> dict:
    """Current Elo ratings, replayed from finished fixtures -- the same
    method as ``jobs/fetch_predictions.py``'s own ``_derived_ratings`` (kept
    as a separate copy, not a shared import, so each job's replay stays
    self-contained; both call the same public ``jobs.elo.ratings_from_results``),
    scoped to the tracked league(s) + season so results from other
    seasons/competitions never leak into the replayed ratings pool (§9).
    """
    finished = store.finished_fixtures_for_replay(
        api_league_ids=config.TRACKED_LEAGUE_IDS, season=config.SEASON,
    )
    results = [
        (f["home_team_id"], f["away_team_id"], f["final_home_goals"], f["final_away_goals"])
        for f in finished
        if f.get("final_home_goals") is not None and f.get("final_away_goals") is not None
    ]
    return elo.ratings_from_results(results)


def build_snapshot_rows(
    fixture: dict,
    *,
    ratings: dict,
    snapshot_date: str,
    prior_by_team: dict[int, dict],
) -> list[dict]:
    """Build the two ``team_probability_snapshots`` rows (home + away) for
    one fixture. ``prior_by_team`` maps ``team_id -> yesterday's row`` for
    THIS fixture only (the caller looks it up per-fixture from a single bulk
    read of the whole prior day -- see :func:`run`), used to compute the
    day-over-day deltas; a team with no entry gets ``None`` deltas (its
    first-ever snapshot for this fixture).
    """
    home_id = fixture["home_team_id"]
    away_id = fixture["away_team_id"]
    home_rating = ratings.get(home_id, elo.DEFAULT_RATING)
    away_rating = ratings.get(away_id, elo.DEFAULT_RATING)
    metrics = elo.team_snapshot_metrics(home_rating, away_rating)

    rows = []
    for team_id, opponent_id, is_home, rating, side in (
        (home_id, away_id, True, home_rating, "home"),
        (away_id, home_id, False, away_rating, "away"),
    ):
        side_metrics = metrics[side]
        prior = prior_by_team.get(team_id)
        delta_elo_rating = (rating - prior["elo_rating"]) if prior else None
        delta_prob_win = (
            (side_metrics["prob_win"] - prior["prob_win"]) if prior else None
        )
        rows.append(
            {
                "snapshot_date": snapshot_date,
                "team_id": team_id,
                "fixture_id": fixture["id"],
                "opponent_team_id": opponent_id,
                "is_home": is_home,
                "elo_rating": rating,
                "prob_win": side_metrics["prob_win"],
                "prob_draw": side_metrics["prob_draw"],
                "prob_loss": side_metrics["prob_loss"],
                "prob_clean_sheet": side_metrics["prob_clean_sheet"],
                "expected_goals_for": side_metrics["expected_goals_for"],
                "expected_goals_against": side_metrics["expected_goals_against"],
                "delta_elo_rating": delta_elo_rating,
                "delta_prob_win": delta_prob_win,
            }
        )
    return rows


def run(
    *, dry_run: bool = False, store: Optional[SupabaseStore] = None, now=None,
) -> dict:
    store = store if store is not None else SupabaseStore()
    now = now or util.now_utc()
    snapshot_date = now.date().isoformat()
    yesterday = (now - timedelta(days=1)).date().isoformat()

    upcoming = store.upcoming_fixtures_within(config.SNAPSHOT_FIXTURE_WINDOW_HOURS)
    ratings = _derived_ratings(store)

    # One bulk read of YESTERDAY's full snapshot set -- never one query per
    # team/fixture pair -- keyed for O(1) per-fixture lookup below.
    prior_rows = store.team_probability_snapshots_for_date(yesterday)
    prior_by_key: dict[tuple[int, int], dict] = {
        (row["team_id"], row["fixture_id"]): row for row in prior_rows
    }

    counts = {
        "fixtures_seen": len(upcoming),
        "snapshots_candidates": 0,
        "snapshots_written": 0,
    }

    all_rows: list[dict] = []
    for fixture in upcoming:
        home_id = fixture["home_team_id"]
        away_id = fixture["away_team_id"]
        prior_by_team = {
            team_id: prior_by_key[(team_id, fixture["id"])]
            for team_id in (home_id, away_id)
            if (team_id, fixture["id"]) in prior_by_key
        }
        rows = build_snapshot_rows(
            fixture, ratings=ratings, snapshot_date=snapshot_date,
            prior_by_team=prior_by_team,
        )
        all_rows.extend(rows)

        if dry_run:
            for row in rows:
                log.info(
                    "[dry-run] would snapshot team %s vs fixture %s: "
                    "win=%.3f draw=%.3f loss=%.3f clean_sheet=%.3f "
                    "xg_for=%.2f xg_against=%.2f (delta_elo=%s delta_win=%s)",
                    row["team_id"], row["fixture_id"], row["prob_win"],
                    row["prob_draw"], row["prob_loss"], row["prob_clean_sheet"],
                    row["expected_goals_for"], row["expected_goals_against"],
                    row["delta_elo_rating"], row["delta_prob_win"],
                )

    counts["snapshots_candidates"] = len(all_rows)
    if not dry_run and all_rows:
        counts["snapshots_written"] = store.upsert_team_probability_snapshots(all_rows)

    return counts


if __name__ == "__main__":
    main(run, "Snapshot probabilities")
